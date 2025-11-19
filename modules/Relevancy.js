// ===== modules/Relevancy.js =====

/**
 * RelevancyEngine (Advanced)
 * -------------------------------------------------------
 * 3 ana işi var:
 * 1) Mesaj tipini anlamak:
 *    - "planning" | "coding" | "research" | "chat" | "file_edit" | "agent" | "pipeline" | "other"
 * 2) Mod önermek:
 *    - "chat" | "plan" | "task" | "mixed"
 * 3) LLM'e gidecek en anlamlı context'i derlemek:
 *    - konuşma geçmişi
 *    - benzer eski task'ler
 *    - profil / preferences
 */

import { readMemory } from "./MemoryEngine.js";

export class RelevancyEngine {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 10;
    this.maxTasks = options.maxTasks || 15;
    this.maxChars = options.maxChars || 8000;
  }

  /**
   * Ana giriş noktası:
   * @param {Object} params
   *  - history: [{role, content}]
   *  - currentInput: string
   *  - preferences: object
   *  - profile: object
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

    const relevantTasks = await this._getRelevantTasks(currentInput, messageType);

    const contextText = this._buildFullContextText({
      convoContext,
      relevantTasks,
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
        preferences,
        profile,
      },
      // ileride relevancy skoru kullanmak istersek:
      score: this._estimateScore(messageType, currentInput, relevantTasks),
    };
  }

  /* ------------------------------------------------------------
   * 1) Mesaj Tipini Tahmin Et
   * ------------------------------------------------------------ */

  _classifyMessageType(text) {
    const t = (text || "").toLowerCase();

    if (!t.trim()) return "other";

    // Kod odaklı
    if (
      t.includes("kod") ||
      t.includes("code") ||
      t.includes("react") ||
      t.includes("solidity") ||
      t.includes("hardhat") ||
      t.includes("remix") ||
      t.includes("typescript") ||
      t.includes("js ") ||
      t.includes("javascript")
    ) {
      return "coding";
    }

    // Planlama / mimari
    if (
      t.includes("mimari") ||
      t.includes("architecture") ||
      t.includes("planla") ||
      t.includes("roadmap") ||
      t.includes("pipeline") ||
      t.includes("multi agent") ||
      t.includes("agent yapısı") ||
      t.includes("tasarlayalım")
    ) {
      return "planning";
    }

    // Araştırma
    if (
      t.includes("araştır") ||
      t.includes("research") ||
      t.includes("karşılaştır") ||
      t.includes("piyasa") ||
      t.includes("talep ne durumda") ||
      t.includes("fiverr") ||
      t.includes("upwork")
    ) {
      return "research";
    }

    // Agent / pipeline oluşturma
    if (
      t.includes("agent yaz") ||
      t.includes("yeni agent") ||
      t.includes("pipeline oluştur") ||
      t.includes("pipeline yaz") ||
      t.includes("agent oluştur")
    ) {
      return "agent";
    }

    // Dosya / repo / patch
    if (
      t.includes("dosya") ||
      t.includes("file") ||
      t.includes("repo") ||
      t.includes("patch") ||
      t.includes("şu dosyayı değiştir") ||
      t.includes("şu satırı düzelt")
    ) {
      return "file_edit";
    }

    // Sıradan sohbet
    if (
      t.includes("nasılsın") ||
      t.includes("konuşalım") ||
      t.includes("muhabbet") ||
      t.includes("dostum") ||
      t.includes("ne düşünüyorsun")
    ) {
      return "chat";
    }

    return "other";
  }

  _suggestMode(messageType, text) {
    const t = (text || "").toLowerCase();

    if (messageType === "planning") return "plan";
    if (messageType === "coding" || messageType === "file_edit" || messageType === "agent")
      return "task";
    if (messageType === "research") return "task"; // araştırma da somut iş
    if (messageType === "chat") return "chat";

    // "beyin fırtınası" tadında ise mixed:
    if (
      t.includes("konuşarak geliştirelim") ||
      t.includes("beraber planlayalım") ||
      t.includes("sonra kodlarız") ||
      t.includes("önce konuşalım")
    ) {
      return "mixed";
    }

    // default:
    return "mixed";
  }

  /* ------------------------------------------------------------
   * 2) Konuşma Geçmişine Göre Context Üret
   * ------------------------------------------------------------ */

  _buildConversationContext(history = [], currentInput = "") {
    const trimmed = [...history].slice(-this.maxMessages);

    // gürültü sayılabilecek mesajları eleyelim
    const noisePatterns = [
      "geçelim",
      "geç",
      "tamam",
      "sende haklısın",
      "haha",
      "jajaja",
      "sjkd",
      "😂",
      "😅",
      "ok",
      "okey",
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

    if (buf.length > this.maxChars) {
      buf = buf.slice(-this.maxChars);
    }

    return buf;
  }

  /* ------------------------------------------------------------
   * 3) Task Hafızasından Benzerleri Seç
   * ------------------------------------------------------------ */

  async _getRelevantTasks(currentGoal = "", messageType = "other") {
    const raw = await readMemory("tasks_history.json");
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const lastTasks = raw.slice(-this.maxTasks * 3); // biraz geniş havuz

    const query = (currentGoal || "").toLowerCase();

    const scored = lastTasks.map((t) => {
      const goal = (t.goal || "").toLowerCase();
      const type = (t.type || "").toLowerCase();

      let score = 0;

      // keyword match
      query.split(/\s+/).forEach((q) => {
        if (!q) return;
        if (goal.includes(q)) score += 1;
      });

      // type uyumu
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
   * 4) Full Context Metni
   * ------------------------------------------------------------ */

  _buildFullContextText({
    convoContext,
    relevantTasks,
    preferences,
    profile,
    currentInput,
  }) {
    let buf = "";

    buf += "=== Profil ===\n";
    if (Object.keys(profile || {}).length > 0) {
      buf += JSON.stringify(profile, null, 2) + "\n";
    } else {
      buf += "(profil bilgisi yok)\n";
    }

    buf += "\n=== Tercihler ===\n";
    if (Object.keys(preferences || {}).length > 0) {
      buf += JSON.stringify(preferences, null, 2) + "\n";
    } else {
      buf += "(kayıtlı tercih yok)\n";
    }

    buf += "\n=== Konuşma Geçmişi ===\n";
    buf += convoContext + "\n";

    buf += "\n=== Benzer Görevler ===\n";
    if (relevantTasks.length === 0) {
      buf += "(benzer görev bulunamadı)\n";
    } else {
      for (const t of relevantTasks) {
        buf += `- [${t.type}] ${t.goal} (id: ${t.id})\n`;
      }
    }

    buf += "\n=== Şu Anki İstek ===\n";
    buf += currentInput + "\n";

    if (buf.length > this.maxChars) {
      buf = buf.slice(-this.maxChars);
    }

    return buf;
  }

  _estimateScore(messageType, currentInput, relevantTasks) {
    let score = 0;
    if (messageType !== "other") score += 0.3;
    if ((currentInput || "").length > 40) score += 0.2;
    if (relevantTasks.length > 0) score += 0.3;
    if (relevantTasks.length > 3) score += 0.1;
    if (score > 1) score = 1;
    return score;
  }
}
