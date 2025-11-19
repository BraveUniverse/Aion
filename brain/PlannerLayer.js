// ===== brain/PlannerLayer.js =====

import { runReasoner } from "../config/models.js";
import {
  appendMemory,
  readMemory,
  writeMemory,
} from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

/**
 * PipelineSpec formatı:
 *
 * {
 *   "taskId": "...",
 *   "projectId": "...",
 *   "steps": [
 *      {
 *        "id": "step1",
 *        "title": "string",
 *        "agent": "CodeAgent | FileAgent | FixAgent | ResearchAgent | CustomAgent",
 *        "input": {...},
 *        "retry": 1
 *      }
 *   ],
 *   "meta": {...}
 * }
 */

export class PlannerLayer {
  constructor() {
    this.registry = new TaskTypeRegistry();
    this.fileName = "pipeline_blueprints.json";
    this.blueprints = this._loadBlueprints();
  }

  _loadBlueprints() {
    const data = readMemory(this.fileName);
    if (!data) return {};
    return data;
  }

  _saveBlueprints() {
    writeMemory(this.fileName, this.blueprints);
  }

  /**
   * Ana planlama fonksiyonu.
   * Task type biliniyor → PipelineSpec üretilecek.
   */
  async plan(taskSpec) {
    const { type } = taskSpec;

    // 1) Blueprint var mı?
    if (this.blueprints[type]) {
      return this.generatePipelineFromBlueprint(taskSpec, this.blueprints[type]);
    }

    // 2) Blueprint yok → yeni type → dynamic pipeline construction
    const newBlueprint = await this.createBlueprintForNewType(taskSpec);

    // kayıt et
    this.blueprints[type] = newBlueprint;
    this._saveBlueprints();

    // blueprint'ten pipeline üret
    return this.generatePipelineFromBlueprint(taskSpec, newBlueprint);
  }

  /* ------------------------------------------------------------
   * 1) Pipeline blueprint'ten PipelineSpec üret
   * ----------------------------------------------------------*/
  generatePipelineFromBlueprint(taskSpec, blueprint) {
    const steps = blueprint.steps.map((step, index) => ({
      id: `step_${index + 1}`,
      title: step.title,
      agent: step.agent,
      input: {
        ...step.inputTemplate,
        taskGoal: taskSpec.goal,
        taskDetails: taskSpec.details,
      },
      retry: step.retry ?? 1,
    }));

    const pipelineSpec = {
      taskId: taskSpec.id,
      projectId: taskSpec.projectId,
      steps,
      meta: {
        blueprintSource: blueprint.source,
        createdAt: new Date().toISOString(),
        type: taskSpec.type,
      },
    };

    // memory'ye kaydet
    appendMemory("pipelines_raw.json", {
      pipelineSpec,
      createdAt: new Date().toISOString(),
    });

    return pipelineSpec;
  }

  /* ------------------------------------------------------------
   * 2) Yeni task tipi için dynamic blueprint oluşturma
   * ----------------------------------------------------------*/
  async createBlueprintForNewType(taskSpec) {
    const allowedAgents = [
      "CodeAgent",
      "FileAgent",
      "FixAgent",
      "ResearchAgent",
      "CustomAgent"
    ];

    const systemPrompt = `
Sen AION'un PIPELINE BEYNİsin.

Görev:
Yeni bir görev tipi tespit ettik: "${taskSpec.type}"

Bu görev tipi için ideal bir "pipeline blueprint" oluştur.
Her blueprint:
- 2-5 arası net adım içerir
- Her adımda 1 agent kullanılır
- agent sadece şu listeden biri olur:
  ${allowedAgents.join(" | ")}

Her adım şu formatı takip etmeli:
{
  "title": "kısa başlık",
  "agent": "CodeAgent",
  "inputTemplate": { "..." },
  "retry": 1
}

Çıkış JSON formatı:

{
  "source": "auto_generated",
  "type": "${taskSpec.type}",
  "steps": [ ... ]
}
`;

    const userPrompt = `
Görev Detayı:
${JSON.stringify(taskSpec, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);
    const parsed = this.safeParseBlueprint(raw, taskSpec.type);

    // Self-check uygulayalım
    const validated = await this.selfCheckBlueprint(parsed, taskSpec.type);

    return validated;
  }

  safeParseBlueprint(text, typeName) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const json = JSON.parse(text.slice(start, end + 1));
      return json;
    } catch (e) {
      console.error("Blueprint parse error:", e);
    }

    // fallback blueprint (en temel pipeline)
    return {
      source: "fallback",
      type: typeName,
      steps: [
        {
          title: "Research task goal",
          agent: "ResearchAgent",
          inputTemplate: {},
          retry: 1,
        },
        {
          title: "Generate output",
          agent: "CodeAgent",
          inputTemplate: {},
          retry: 1,
        },
      ],
    };
  }

  /* ------------------------------------------------------------
   * 3) SELF-CHECK — Blueprint doğrulama
   * ----------------------------------------------------------*/
  async selfCheckBlueprint(blueprint, typeName) {
    const systemPrompt = `
Sen AION'un PIPELINE SELF-CHECK beynisin.

Görevin:
Verilen blueprint'in geçerli olup olmadığını kontrol etmek.

Kurallar:
- "steps" array olmalı ve 1-8 adım arasında olmalı
- Her adım için:
    - title string olmalı
    - agent geçerli olmalı
    - inputTemplate bir obje olmalı
- Eğer sorun varsa düzeltme öner ve JSON olarak düzelt
- Eğer büyük mantık hatası yoksa blueprint'i aynen döndür

Format:
{
  "valid": true/false,
  "blueprint": { ... }
}
`;

    const raw = await runReasoner(systemPrompt, JSON.stringify(blueprint));
    const parsed = this.safeParseSelfCheck(raw, blueprint);

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
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      return {
        valid: true,
        blueprint: original,
      };
    }
  }
}
