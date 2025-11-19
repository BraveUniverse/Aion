// ===== modules/agents/MemoryPipelineAgent.js =====

import { LongTermMemoryEngine } from "../../memory/LongTermMemoryEngine.js";
import { CategoricalMemory } from "../../memory/CategoricalMemory.js";
import { SummaryModel } from "../../models/SummaryModel.js";
import { runReasoner } from "../../config/models.js";

/**
 * MemoryPipelineAgent
 * ---------------------------------------------------------
 * Pipeline çalıştıktan sonra:
 *  - episodic memory
 *  - semantic memory
 *  - structured memory
 *  - categorical memory
 * 
 * hepsini güncelleyen master hafıza agent'ıdır.
 */

export class MemoryPipelineAgent {
  constructor() {
    this.ltm = new LongTermMemoryEngine();
    this.cat = new CategoricalMemory();
    this.summaryModel = new SummaryModel();
  }

  /**
   * Agent API
   */
  async run(input, context) {
    const { pipeline, taskSpec } = input;

    if (!pipeline || !taskSpec) {
      throw new Error("MemoryPipelineAgent: pipeline ve taskSpec eksik.");
    }

    // 1) Episodic
    await this._storeEpisodic(pipeline, taskSpec);

    // 2) Semantic
    await this._storeSemantic(pipeline, taskSpec);

    // 3) Structured
    await this._storeStructured(pipeline, taskSpec);

    // 4) Categorical
    await this._storeCategorical(pipeline, taskSpec);

    return {
      ok: true,
      msg: "Pipeline hafıza güncellemesi tamamlandı.",
      stored: {
        episodic: true,
        semantic: true,
        structured: true,
        categorical: true
      }
    };
  }

  /* -----------------------------------------------------
   * 1) EPISODIC MEMORY
   * ---------------------------------------------------*/
  async _storeEpisodic(pipeline, taskSpec) {
    const entry = {
      role: "pipeline",
      text: `Pipeline bitti → status: ${pipeline.status} | task: ${taskSpec.goal}`,
      pipeline,
      taskSpec
    };

    await this.ltm.store("episodic", entry);
  }

  /* -----------------------------------------------------
   * 2) SEMANTIC MEMORY
   * ---------------------------------------------------*/
  async _storeSemantic(pipeline, taskSpec) {
    const text = `
TASK: ${taskSpec.goal}
TYPE: ${taskSpec.type}
STATUS: ${pipeline.status}
STEPS: ${pipeline.logs.map(l => l.title).join(", ")}
OUTPUTS: ${Object.values(pipeline.context)
      .map(c => c?.output)
      .join("\n")}
    `.trim();

    const summary = await this.summaryModel.generate(text);

    const semanticEntry = {
      summary,
      text,
      source: "pipeline",
      importance: 0.7,
      tags: ["pipeline", taskSpec.type],
    };

    await this.ltm.store("semantic", semanticEntry);
  }

  /* -----------------------------------------------------
   * 3) STRUCTURED MEMORY
   * ---------------------------------------------------*/
  async _storeStructured(pipeline, taskSpec) {
    // task tipi ile ilgili bir davranış paterni kaydediyoruz
    const structuredPatch = {
      lastPipeline: {
        task: taskSpec.goal,
        type: taskSpec.type,
        status: pipeline.status,
        updatedAt: new Date().toISOString()
      }
    };

    await this.ltm.store("structured", structuredPatch);
  }

  /* -----------------------------------------------------
   * 4) CATEGORICAL MEMORY
   * ---------------------------------------------------*/
  async _storeCategorical(pipeline, taskSpec) {
    const prompt = `
Pipeline sonuçlarını kategorilere ayır.

TASK: ${taskSpec.goal}
TYPE: ${taskSpec.type}
STATUS: ${pipeline.status}

CATEGORIES:
- coding
- planning
- agent-design
- bugfix
- research
- file-edit
- meta

Sadece kategori ismini döndür.
`;

    const raw = await runReasoner(prompt);

    const category = this._extractCategory(raw);

    this.cat.addMemory(category, {
      task: taskSpec.goal,
      status: pipeline.status,
      summary: pipeline.selfCheck?.summary,
      date: new Date().toISOString()
    });
  }

  _extractCategory(text) {
    const cats = [
      "coding",
      "planning",
      "agent-design",
      "bugfix",
      "research",
      "file-edit",
      "meta"
    ];

    const low = text.toLowerCase();

    for (const c of cats) {
      if (low.includes(c)) return c;
    }

    return "meta";
  }
}
