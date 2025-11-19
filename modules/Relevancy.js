// ===== modules/Relevancy.js =====

/**
 * RelevancyEngine (Hybrid Memory)
 * -------------------------------------------------------
 * 4 ana işi var:
 * 1) Mesaj tipini anlamak
 * 2) Mod önermek
 * 3) Konuşma + task + long-term memory + semantic memory → context derlemek
 * 4) Hybrid Memory entegrasyonu:
 *      - CategoricalMemory recall
 *      - EmbeddingStore semantic recall
 */

import { readMemory } from "./MemoryEngine.js";
import CategoricalMemory from "./CategoricalMemory.js";
import { EmbeddingStore } from "../memory/EmbeddingStore.js";

export class RelevancyEngine {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 10;
    this.maxTasks = options.maxTasks || 15;
    this.maxChars = options.maxChars || 8000;

    this.categoricalMemory = new CategoricalMemory();
  }

  /**
   * Ana giriş noktası
   */
  async analyze(params = {}) {
    const {
      history = [],
      currentInput = "",
      preferences = {},
      profile = {},
    } = params;

    const messageType = this._classifyMessageType(currentInput);
    const suggestedMode = this._suggestMode(messageType, currentInput);

    const convoContext = this._buildConversationContext(history, currentInput);

    // eski görevlerden recall
    const relevantTasks = await this._getRelevantTasks(
      currentInput, 
      messageType
    );

    // HYBRID MEMORY EKLENDİ ↓↓↓↓↓↓↓↓↓↓↓↓↓↓
    const semanticMemory = await this._semanticRecall(currentInput);
    const categoricalMemory = await this._categoricalRecall(currentInput);
    // ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑

    const contextText = this._buildFullContextText({
      convoContext,
      relevantTasks,
      semanticMemory,
      categoricalMemory,
      preferences,
      profile,
      currentInput,
    });

    return {
      messageType,
      suggestedMode,
      contextText,
      contextSlices: {
        convoContext,
        relevantTasks,
        semanticMemory,
        categoricalMemory,
        preferences,
        profile,
      },
      score: this._estimateScore(
        messageType,
        currentInput,
        relevantTasks,
        semanticMemory,
        categoricalMemory
      ),
    };
  }

  /* ------------------------------------------------------------
   * SEMANTIC RECALL (EmbeddingStore)
   * ------------------------------------------------------------ */

  async _semanticRecall(query) {
    try {
      return await EmbeddingStore.recall(query, 5);
    } catch {
      return [];
    }
  }

  /* ------------------------------------------------------------
   * CATEGORICAL MEMORY RECALL
   * ------------------------------------------------------------ */

  async _categoricalRecall(query) {
    try {
      return await this.categoricalMemory.recallAll(query, 5);
    } catch (err) {
      return [];
    }
  }

  /* ------------------------------------------------------------
   * 1) Mesaj Tipini Tahmin Et
   * ------------------------------------------------------------ */

  _classifyMessageType(text) {
    const t = (text || "").toLowerCase();
    if (!t.trim()) return "other";

    if (
      t.includes("kod") || t.includes("code") || t.includes("react") ||
      t.includes("solidity") || t.includes("hardhat") || t.includes("typescript")
    ) return "coding";

    if (
      t.includes("mimari") || t.includes("architecture") ||
      t.includes("roadmap") || t.includes("pipeline")
    ) return "planning";

    if (
      t.includes("araştır") || t.includes("research") ||
      t.includes("piyasa") || t.includes("fiverr")
    ) return "research";

    if (t.includes("agent yaz") || t.includes("pipeline yaz"))
      return "agent";

    if (
      t.includes("dosya") || t.includes("file") ||
      t.includes("patch") || t.includes("repo")
    ) return "file_edit";

    if (
      t.includes("nasılsın") || t.includes("dostum") ||
      t.includes("konuşalım")
    ) return "chat";

    return "other";
  }

  _suggestMode(messageType, text) {
    const t = (text || "").toLowerCase();

    if (messageType === "planning") return "plan";
    if (
      messageType === "coding" ||
      messageType === "file_edit" ||
      messageType === "agent"
    ) return "task";
    if (messageType === "research") return "task";
    if (messageType === "chat") return "chat";

    if (
      t.includes("konuşarak") ||
      t.includes("beraber planlayalım") ||
      t.includes("önce konuşalım")
    ) return "mixed";

    return "mixed";
  }

  /* ------------------------------------------------------------
   * Konuşma Geçmişi
   * ------------------------------------------------------------ */

  _buildConversationContext(history = [], currentInput = "") {
    const trimmed = [...history].slice(-this.maxMessages);

    const noisePatterns = [
      "geçelim", "geç", "tamam", "haha", "😂", "ok",
    ];

    const isNoise = (txt) => {
      const low = (txt || "").toLowerCase();
      return noisePatterns.some((n) => low.includes(n));
    };

    let buf = "";
    for (const msg of trimmed) {
      if (!msg || !msg.content) continue;
      if (isNoise(msg.content)) continue;

      const prefix = msg.role === "user" ? "User" : "AION";
      buf += `[${prefix}] ${msg.content}\n`;
    }

    buf += `\n[Current] ${currentInput}\n`;
    if (buf.length > this.maxChars) buf = buf.slice(-this.maxChars);

    return buf;
  }

  /* ------------------------------------------------------------
   * Görev Hafızası
   * ------------------------------------------------------------ */

  async _getRelevantTasks(currentGoal = "", messageType = "other") {
    const raw = await readMemory("tasks_history.json");
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const lastTasks = raw.slice(-this.maxTasks * 3);
    const query = (currentGoal || "").toLowerCase();

    const scored = lastTasks.map((t) => {
      const goal = (t.goal || "").toLowerCase();
      const type = (t.type || "").toLowerCase();
      let score = 0;

      query.split(/\s+/).forEach((q) => {
        if (q && goal.includes(q)) score += 1;
      });

      if (messageType === "coding" && type.includes("code")) score += 2;
      if (messageType === "planning" && type.includes("design")) score += 2;
      if (messageType === "agent" && type.includes("create_agent")) score += 2;

      return { task: t, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter((x) => x.score > 0)
      .slice(0, this.maxTasks)
      .map((x) => x.task);
  }

  /* ------------------------------------------------------------
   * Full Context Text (HYBRID MEMORY ekli)
   * ------------------------------------------------------------ */

  _buildFullContextText({
    convoContext,
    relevantTasks,
    semanticMemory,
    categoricalMemory,
    preferences,
    profile,
    currentInput,
  }) {
    let buf = "";

    buf += "=== Profil ===\n";
    buf += Object.keys(profile).length
      ? JSON.stringify(profile, null, 2)
      : "(profil yok)";
    buf += "\n\n";

    buf += "=== Tercihler ===\n";
    buf += Object.keys(preferences).length
      ? JSON.stringify(preferences, null, 2)
      : "(tercih yok)";
    buf += "\n\n";

    buf += "=== Konuşma Geçmişi ===\n";
    buf += convoContext + "\n\n";

    buf += "=== Benzer Görevler ===\n";
    if (!relevantTasks.length) buf += "(yok)\n";
    else relevantTasks.forEach((t) => (buf += `- ${t.goal}\n`));
    buf += "\n";

    // 🔥 HYBRID MEMORY BURADA DEVREYE GİRİYOR
    buf += "=== Semantic Memory (EmbeddingStore) ===\n";
    if (!semanticMemory?.length) buf += "(yok)\n";
    else semanticMemory.forEach((m) => buf += `• ${m.text}\n`);
    buf += "\n";

    buf += "=== Categorical Memory (Long-term Knowledge) ===\n";
    if (!categoricalMemory?.length) buf += "(yok)\n";
    else categoricalMemory.forEach((m) =>
      buf += `• [${m.category}] ${m.text}\n`
    );
    buf += "\n";

    buf += "=== Şu Anki İstek ===\n";
    buf += currentInput + "\n";

    if (buf.length > this.maxChars) buf = buf.slice(-this.maxChars);

    return buf;
  }

  /* ------------------------------------------------------------
   * Hybrid Memory Score
   * ------------------------------------------------------------ */

  _estimateScore(messageType, currentInput, tasks, semantic, categorical) {
    let score = 0;

    if (messageType !== "other") score += 0.3;
    if ((currentInput || "").length > 40) score += 0.2;

    if (tasks?.length) score += 0.2;
    if (semantic?.length) score += 0.2;
    if (categorical?.length) score += 0.2;

    if (score > 1) score = 1;
    return score;
  }
}
