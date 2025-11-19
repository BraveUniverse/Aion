// ===== core/PipelineSpec.js =====

import { appendMemory } from "../modules/MemoryEngine.js";

function genStepId(index) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `step_${index}_${rand}`;
}

/**
 * PipelineSpec
 * -------------------------------------------------------
 * Tek bir TaskSpec için yürütülecek adımların resmi temsili.
 *
 * Yapı:
 * {
 *   taskId: "task_...",
 *   steps: [
 *     {
 *       id: "step_1",
 *       title: "Proje iskeletini oluştur",
 *       agent: "CodeAgent",
 *       input: { ... },
 *       dependsOn: ["step_0"],
 *       retry: 1
 *     }
 *   ],
 *   createdAt: ...
 * }
 */

export class PipelineSpec {
  constructor({ taskId, steps = [], createdAt } = {}) {
    if (!taskId) throw new Error("PipelineSpec: 'taskId' zorunlu.");

    this.taskId = taskId;
    this.steps = steps.map((s, i) => this._normalizeStep(s, i));
    this.createdAt = createdAt || new Date().toISOString();

    this._validate();
  }

  _normalizeStep(step, index) {
    if (!step || typeof step !== "object") {
      throw new Error(`PipelineSpec: step[${index}] geçersiz.`);
    }

    return {
      id: step.id || genStepId(index),
      title: step.title || `Step #${index + 1}`,
      agent: step.agent || "CodeAgent",
      input: step.input || {},
      dependsOn: step.dependsOn || [],
      retry: typeof step.retry === "number" ? step.retry : 0,
      metadata: step.metadata || {},
    };
  }

  _validate() {
    const ids = new Set();
    for (const st of this.steps) {
      if (ids.has(st.id)) {
        throw new Error(`PipelineSpec: step id çakışması: ${st.id}`);
      }
      ids.add(st.id);
    }
  }

  /**
   * Yeni step ekler.
   */
  addStep(step) {
    const idx = this.steps.length;
    const normalized = this._normalizeStep(step, idx);
    this.steps.push(normalized);
    this._validate();
    return normalized;
  }

  /**
   * Step'i id ile bul.
   */
  getStep(stepId) {
    return this.steps.find((s) => s.id === stepId) || null;
  }

  /**
   * Çalıştırılabilir formda JSON döndür.
   */
  toJSON() {
    return {
      taskId: this.taskId,
      steps: this.steps,
      createdAt: this.createdAt,
    };
  }

  /**
   * Oluşturma log'u
   */
  logCreation(extra = {}) {
    appendMemory("pipelines_created.json", {
      taskId: this.taskId,
      stepsCount: this.steps.length,
      createdAt: this.createdAt,
      ...extra,
    });
  }

  /**
   * ExecutionLayer için basit "topolojik sıra" çıkarmak istersen
   * (şu an sadece düz sıra döndürüyoruz; bağımlılık çözümü sonra eklenebilir).
   */
  orderedSteps() {
    return [...this.steps];
  }
}
