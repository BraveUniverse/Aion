// ===== brain/PlannerLayer.js =====

import { runReasoner } from "../config/models.js";
import {
  appendMemory,
  readMemory,
  writeMemory,
} from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

// ★ Yeni gelişmiş katmanlar:
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
   * Ana planlama fonksiyonu
   * PipelineSpec üretir
   */
  async plan(taskSpec, convMeta = {}) {
    const { type } = taskSpec;
    const blueprintExists = this.blueprints[type];

    // Eğer blueprint varsa → doğrudan pipeline üret
    if (blueprintExists) {
      return this.generatePipelineFromBlueprint(taskSpec, blueprintExists, convMeta);
    }

    // Yeni type → dynamic blueprint
    const newBlueprint = await this.createBlueprintForNewType(taskSpec, convMeta);

    // kaydet
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

      // ★ ToolArbitration: blueprint'teki agent doğru mu?
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
        agent: decision.primary, // ★ seçilen agent
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
   * YENİ TYPE İÇİN DİNAMİK BLUEPRINT
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
Bu görev tipi için net, kısa, verimli, mantıklı bir "pipeline blueprint" oluştur.

Kurallar:
- Adım sayısı 2–5 arasında olmalı
- Her adımda sadece 1 agent kullanılmalı
- agent sadece şu listeden biri olacak:
  ${allowedAgents.join(" | ")}

Çıkış YALNIZCA JSON olacak:
{
  "source": "auto_generated",
  "type": "${taskSpec.type}",
  "steps": [
    {
      "title": "...",
      "agent": "CodeAgent",
      "inputTemplate": {},
      "retry": 1
    }
  ]
}
`.trim();

    const userPrompt = `
Görev Detayı:
${JSON.stringify(taskSpec, null, 2)}

Bağlam:
${JSON.stringify(convMeta, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    // ★ Reasoning compression
    const cleaned = await this.compressor.compressIfLong(raw, {
      kind: "blueprint",
      maxCharsOverride: 2200,
      taskSpec,
    });

    const parsed = this.safeParseBlueprint(cleaned, taskSpec.type);

    // Self-check & düzeltme
    const validated = await this.selfCheckBlueprint(parsed, taskSpec.type);

    return validated;
  }

  safeParseBlueprint(text, typeName) {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      return JSON.parse(text.slice(s, e + 1));
    } catch {
      // fallback
      return {
        source: "fallback",
        type: typeName,
        steps: [
          {
            title: "Research underlying task",
            agent: "ResearchAgent",
            inputTemplate: {},
            retry: 1
          },
          {
            title: "Generate final output",
            agent: "CodeAgent",
            inputTemplate: {},
            retry: 1
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

Blueprint doğrulama kuralları:
- steps bir array olmalı
- uzunluk 1–8 arasında olmalı
- title string olmalı
- agent geçerli olmalı
- inputTemplate obje olmalı

Hatalıysa düzelt.
ÇIKTI SADECE JSON:

{
  "valid": true/false,
  "blueprint": { ... }
}
`;

    const raw = await runReasoner(systemPrompt, JSON.stringify(blueprint, null, 2));

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
