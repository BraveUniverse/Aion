// ===== brain/PlannerLayer.js =====

import { reasonerManager } from "../engine/ReasonerManager.js";
import {
  appendMemory,
  readMemory,
  writeMemory,
} from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

import { ToolArbitration } from "../modules/ToolArbitration.js";
import { ReasoningCompression } from "../modules/ReasoningCompression.js";

export class PlannerLayer {
  constructor() {
    this.registry = new TaskTypeRegistry();
    this.fileName = "pipeline_blueprints.json";
    this.blueprints = this._loadBlueprints();

    this.toolArbiter = new ToolArbitration();
    this.compressor = new ReasoningCompression(2500);
  }

  _loadBlueprints() {
    return readMemory(this.fileName) || {};
  }

  _saveBlueprints() {
    writeMemory(this.fileName, this.blueprints);
  }

  /**
   * Ana planlama fonksiyonu (PipelineSpec üretir)
   */
  async plan(taskSpec, convMeta = {}) {
    const { type } = taskSpec;
    const blueprintExists = this.blueprints[type];

    if (blueprintExists) {
      return this.generatePipelineFromBlueprint(taskSpec, blueprintExists, convMeta);
    }

    const newBlueprint = await this.createBlueprintForNewType(taskSpec, convMeta);

    this.blueprints[type] = newBlueprint;
    this._saveBlueprints();

    return this.generatePipelineFromBlueprint(taskSpec, newBlueprint, convMeta);
  }

  /* ------------------------------------------------------------
   * PIPELINE ÜRETİMİ
   * ----------------------------------------------------------*/
  async generatePipelineFromBlueprint(taskSpec, blueprint, convMeta) {
    const { suggestedMode, messageType } = convMeta;
    const finalSteps = [];

    for (let i = 0; i < blueprint.steps.length; i++) {
      const step = blueprint.steps[i];

      const decision = await this.toolArbiter.decide(
        {
          goal: taskSpec.goal,
          type: taskSpec.type,
          details: taskSpec.details,
        },
        [],
        {
          suggestedMode,
          messageType,
          blueprintAgent: step.agent,
          taskPreferredAgent: taskSpec.agent || null,
        }
      );

      finalSteps.push({
        id: `step_${i + 1}`,
        title: step.title,
        agent: decision.primary,
        input: {
          ...step.inputTemplate,
          taskGoal: taskSpec.goal,
          taskDetails: taskSpec.details,
          blueprintAgent: step.agent,
          arbitration: decision,
        },
        retry: step.retry ?? 1,
      });
    }

    const pipelineSpec = {
      taskId: taskSpec.id,
      projectId: taskSpec.projectId,
      steps: finalSteps,
      meta: {
        blueprintSource: blueprint.source,
        createdAt: new Date().toISOString(),
        type: taskSpec.type,
      },
    };

    appendMemory("pipelines_raw.json", {
      pipelineSpec,
      createdAt: new Date().toISOString(),
    });

    return pipelineSpec;
  }

  /* ------------------------------------------------------------
   * YENİ TYPE → Dinamik Blueprint
   * ----------------------------------------------------------*/
  async createBlueprintForNewType(taskSpec, convMeta) {
    const allowedAgents = [
      "CodeAgent",
      "FileAgent",
      "FixAgent",
      "ResearchAgent",
      "CustomAgent"
    ];

    const systemPrompt = `
Sen AION'un PIPELINE BEYNİSIN.

Yeni görev tipi: "${taskSpec.type}"

Görevin:
Bu görev tipi için verimli bir pipeline blueprint üret.

Kurallar:
- Adım sayısı 2–5
- Her adımda tek agent
- Agent sadece şu listeden biri:
  ${allowedAgents.join(" | ")}

SADECE JSON:
{
  "source": "auto_generated",
  "type": "${taskSpec.type}",
  "steps": [
    { "title": "...", "agent": "CodeAgent", "inputTemplate": {}, "retry": 1 }
  ]
}
`.trim();

    const userPrompt = `
Görev Detayı:
${JSON.stringify(taskSpec, null, 2)}

Bağlam:
${JSON.stringify(convMeta, null, 2)}
`;

    // 🔥 ReasonerManager çağrısı
    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt,
      mode: "blueprint_generation",
      temperature: 0.3,
      maxTokens: 1100,
    });

    const cleaned = await this.compressor.compressIfLong(raw, {
      kind: "blueprint",
      maxCharsOverride: 2200,
      taskSpec,
    });

    const parsed = this.safeParseBlueprint(cleaned, taskSpec.type);

    const validated = await this.selfCheckBlueprint(parsed, taskSpec.type);

    return validated;
  }

  safeParseBlueprint(text, typeName) {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      return JSON.parse(text.slice(s, e + 1));
    } catch {
      return {
        source: "fallback",
        type: typeName,
        steps: [
          {
            title: "Research underlying task",
            agent: "ResearchAgent",
            inputTemplate: {},
            retry: 1,
          },
          {
            title: "Generate final output",
            agent: "CodeAgent",
            inputTemplate: {},
            retry: 1,
          }
        ]
      };
    }
  }

  /* ------------------------------------------------------------
   * SELF-CHECK
   * ----------------------------------------------------------*/
  async selfCheckBlueprint(blueprint, typeName) {
    const systemPrompt = `
Sen AION Pipeline Self-Check Beynisisin.

Kurallar:
- steps array olmalı
- uzunluk 1–8
- title string
- agent geçerli
- inputTemplate obje

Hataları düzelt.
ÇIKTI JSON:
{
  "valid": true/false,
  "blueprint": { ... }
}
`;

    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt: JSON.stringify(blueprint, null, 2),
      mode: "blueprint_validation",
      temperature: 0.1,
      maxTokens: 900,
    });

    const cleaned = await this.compressor.compressIfLong(raw, {
      kind: "blueprint_check",
      maxCharsOverride: 1500,
    });

    const parsed = this.safeParseSelfCheck(cleaned, blueprint);

    appendMemory("pipeline_self_check.json", {
      typeName,
      input: blueprint,
      output: parsed,
      createdAt: new Date().toISOString(),
    });

    return parsed.blueprint;
  }

  safeParseSelfCheck(text, original) {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      return JSON.parse(text.slice(s, e + 1));
    } catch {
      return {
        valid: true,
        blueprint: original,
      };
    }
  }
}
