// ===== modules/Relevancy.js =====

/**
 * RelevancyEngine
 * -------------------------------------------------------
 * Amaç:
 *  - Konuşma geçmişinden, task geçmişinden ve loglardan
 *    "şu anki istekle en alakalı" olanları seçmek.
 *
 * Şu an token bazlı gerçek hesap yapmıyoruz, basit heuristics:
 *  - En son mesajlar daha ağır basar
 *  - Aynı type / benzer goal içeren eski TaskSpec'ler
 *  - maxItems ve maxChars limitleri ile sınırlama
 */

import { readMemory } from "./MemoryEngine.js";

export class RelevancyEngine {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 8;     // max kaç chat mesajı
    this.maxTasks = options.maxTasks || 10;          // max kaç eski task
    this.maxChars = options.maxChars || 6000;        // LLM'e gidecek toplam char limiti
  }

  /**
   * Konuşma geçmişine göre relevancy penceresi oluşturur.
   * @param {Array<{role:string, content:string}>} history
   * @param {string} currentInput
   */
  buildConversationContext(history = [], currentInput = "") {
    const trimmed = [...history].slice(-this.maxMessages);
    let buf = "";

    for (const msg of trimmed) {
      const prefix = msg.role === "user" ? "User" : "AION";
      buf += `[${prefix}] ${msg.content}\n`;
    }

    buf += `\n[Current] ${currentInput}\n`;

    if (buf.length > this.maxChars) {
      buf = buf.slice(-this.maxChars);
    }

    return buf;
  }

  /**
   * Eski TaskSpec kayıtlarından alakalı olanları döndürür.
   * Şimdilik basit: en son N kaydı getiriyoruz.
   * İleride semantic search eklenebilir.
   */
  async getRelevantTasks(currentGoal = "") {
    const raw = await readMemory("tasks_history.json");
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const lastTasks = raw.slice(-this.maxTasks);

    // Basit keyword match
    const scored = lastTasks.map((t) => {
      const goal = (t.goal || "").toLowerCase();
      const score = currentGoal
        ? this.simpleScore(goal, currentGoal.toLowerCase())
        : 1;
      return { task: t, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter((x) => x.score > 0)
      .slice(0, this.maxTasks)
      .map((x) => x.task);
  }

  simpleScore(text, query) {
    if (!text || !query) return 0;
    let score = 0;
    query.split(/\s+/).forEach((q) => {
      if (!q) return;
      if (text.includes(q)) score += 1;
    });
    return score;
  }

  /**
   * Şu an için birleşik bir "context blob" döner.
   */
  async buildFullContext({ history = [], currentInput = "" } = {}) {
    const conv = this.buildConversationContext(history, currentInput);
    const tasks = await this.getRelevantTasks(currentInput);

    let buf = "=== Konuşma Geçmişi ===\n";
    buf += conv;
    buf += "\n\n=== Benzer Görevler (TaskSpec özetleri) ===\n";
    for (const t of tasks) {
      buf += `- [${t.type || "unknown"}] ${t.goal || ""} (id=${t.id || "?"})\n`;
    }

    if (buf.length > this.maxChars) {
      buf = buf.slice(-this.maxChars);
    }

    return buf;
  }
}
