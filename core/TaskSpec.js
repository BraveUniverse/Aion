// ===== core/TaskSpec.js =====

import { appendMemory } from "../modules/MemoryEngine.js";

function generateId(prefix = "task") {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * TaskSpec
 * -------------------------------------------------------
 * AION içinde tek bir görevin resmi temsili.
 *
 * Zorunlu alanlar:
 *  - id        : benzersiz string
 *  - type      : "generate_code", "create_agent", ...
 *  - goal      : insan okunabilir hedef cümlesi
 *
 * Opsiyonel:
 *  - details   : type'a özel ek bilgiler (object)
 *  - metadata  : UI, priority, tags vs.
 *  - createdAt : ISO tarih
 *  - source    : "user", "system", "pipeline" vs.
 */
export class TaskSpec {
  constructor({
    id,
    type,
    goal,
    details = {},
    metadata = {},
    createdAt,
    source = "user",
  }) {
    if (!type) throw new Error("TaskSpec: 'type' zorunlu.");
    if (!goal) throw new Error("TaskSpec: 'goal' zorunlu.");

    this.id = id || generateId();
    this.type = type;
    this.goal = goal;
    this.details = details || {};
    this.metadata = metadata || {};
    this.source = source || "user";
    this.createdAt = createdAt || new Date().toISOString();
  }

  /* ---------- Yardımcı oluşturucular ---------- */

  /**
   * InterpreterLayer çıktısından TaskSpec oluşturur.
   * Expected shape:
   * {
   *   type: "generate_code",
   *   goal: "Gridotto V3 için yeni çekiliş fonksiyonu yaz",
   *   details: {...},
   *   metadata: {...}
   * }
   */
  static fromInterpreterOutput(raw, extra = {}) {
    if (!raw || typeof raw !== "object") {
      throw new Error("TaskSpec.fromInterpreterOutput: geçersiz raw.");
    }

    const {
      type,
      goal,
      details = {},
      metadata = {},
      source = "user",
    } = raw;

    const task = new TaskSpec({
      type,
      goal,
      details,
      metadata,
      source,
      ...extra,
    });

    appendMemory("tasks_created.json", {
      id: task.id,
      type: task.type,
      goal: task.goal,
      createdAt: task.createdAt,
      source: task.source,
    });

    return task;
  }

  /**
   * JSON seri hale getirme
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      goal: this.goal,
      details: this.details,
      metadata: this.metadata,
      source: this.source,
      createdAt: this.createdAt,
    };
  }

  /**
   * Log / debug için kısa özet.
   */
  summary() {
    return `[${this.type}] (${this.id}) ${this.goal}`;
  }
}
