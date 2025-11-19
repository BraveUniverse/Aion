// ===== brain/ConversationLayer.js =====

import { reasonerManager } from "../engine/ReasonerManager.js";
import { appendMemory, readMemory } from "../modules/MemoryEngine.js";
import { RelevancyEngine } from "../modules/Relevancy.js";   

/**
 * ConversationLayer (with ReasonerManager Integration)
 */

export class ConversationLayer {
  constructor() {
    this.relevancy = new RelevancyEngine({
      maxMessages: 12,
      maxTasks: 20,
      maxChars: 9000,
    });
  }

  async processUserMessage(userMessage, options = {}) {
    const projectIdHint = await this.detectRelatedProject(userMessage);

    const history = await this._getRecentMessages();

    const pre = this.quickIntentCheck(userMessage);

    const rel = await this.relevancy.analyze({
      history,
      currentInput: userMessage,
      preferences: {},
      profile: {},
    });

    if (pre.forceMode) {
      return this._buildOutput({
        userMessage,
        intent: pre.forceMode,
        projectIdHint,
        pre,
        rel,
        deep: null,
      });
    }

    if (rel.suggestedMode !== "mixed") {
      return this._buildOutput({
        userMessage,
        intent: rel.suggestedMode,
        projectIdHint,
        pre,
        rel,
        deep: null,
      });
    }

    // 🔥 runReasoner → ReasonerManager.run
    const deep = await this.reasonIntent(userMessage);

    const finalIntent = this._mergeIntent(pre, rel, deep);

    return this._buildOutput({
      userMessage,
      intent: finalIntent,
      projectIdHint,
      pre,
      rel,
      deep,
    });
  }

  _buildOutput({ userMessage, intent, projectIdHint, pre, rel, deep }) {
    const norm = this.normalizeIntent(intent);

    return {
      raw: userMessage,
      intent: norm,
      isChat: norm === "chat",
      isPlan: norm === "plan",
      isTask: norm === "task",
      projectIdHint,
      contextText: rel.contextText,
      relevancy: rel,
      meta: {
        preAnalysis: pre,
        relevancyAnalysis: rel,
        deepAnalysis: deep,
      },
    };
  }

  _mergeIntent(pre, rel, deep) {
    if (pre.forceMode) return pre.forceMode;
    if (rel.suggestedMode !== "mixed") return rel.suggestedMode;
    if (deep?.intent && deep.intent !== "mixed") return deep.intent;
    return "mixed";
  }

  quickIntentCheck(text) {
    const lowered = text.toLowerCase();

    const taskTriggers = [
      "oluştur","yaz","kodla","generate",
      "çalıştır","çıktı üret","patch","agent yap",
      "pipeline oluştur","dosya yaz","compile et","uygula"
    ];

    for (const t of taskTriggers) {
      if (lowered.includes(t)) {
        return { forceMode: "task", reason: `Trigger: ${t}` };
      }
    }

    const planTriggers = [
      "bunu planlayalım","beyin fırtınası","mantığını oturtalım",
      "nasıl yaparız","nasıl işler","adımlara bölelim",
      "yol haritası","architecture","mimari","tasarım planı"
    ];

    for (const p of planTriggers) {
      if (lowered.includes(p)) {
        return { forceMode: "plan", reason: `Trigger: ${p}` };
      }
    }

    const chatTriggers = [
      "nasılsın","iyi misin","sohbet","sence","ne düşünüyorsun"
    ];

    for (const c of chatTriggers) {
      if (lowered.includes(c)) {
        return { forceMode: "chat", reason: `Trigger: ${c}` };
      }
    }

    return { forceMode: null };
  }

  /* ------------------------------------------------------------
   * ReasonIntent — NOW USING REASONER MANAGER
   * ------------------------------------------------------------ */
  async reasonIntent(message) {
    const systemPrompt = `
Sen AION'un NİYET BEYNİSİN.

Görevin:
Kullanıcının mesajından hangi modun gerektiğini bulmak:
- "chat"
- "plan"
- "task"
Belirsizse "mixed".

JSON döndür:
{
  "intent": "...",
  "confidence": 0.0-1.0,
  "summary": "..."
}
`.trim();

    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt: message,
      mode: "classification",
      maxTokens: 450,
      temperature: 0.2,
    });

    return this.safeParseIntent(raw);
  }

  safeParseIntent(text) {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s >= 0 && e > s) {
        const json = JSON.parse(text.slice(s, e + 1));
        return {
          intent: this.normalizeIntent(json.intent),
          confidence: json.confidence ?? 0.5,
          summary: json.summary || "",
        };
      }
    } catch {}

    return {
      intent: "mixed",
      confidence: 0.3,
      summary: "",
    };
  }

  normalizeIntent(i) {
    if (!i) return "mixed";
    const x = i.toLowerCase();
    if (["chat", "plan", "task"].includes(x)) return x;
    return "mixed";
  }

  /* ------------------------------------------------------------
   * PROJECT DETECTION — ALSO MIGRATED TO REASONER MANAGER
   * ------------------------------------------------------------ */
  async detectRelatedProject(message) {
    const projects = readMemory("projects.json") || [];
    if (!Array.isArray(projects) || projects.length === 0) return null;

    const systemPrompt = `
Sen AION'un proje eşleştirme modüsün.
JSON formatında cevap ver.

{
  "projectId": "id" | null,
  "reason": "...",
  "confidence": 0.0-1.0
}
`.trim();

    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt: `
Mesaj: ${message}
Projeler: ${JSON.stringify(projects, null, 2)}
      `,
      mode: "matching",
      temperature: 0.1,
      maxTokens: 500,
    });

    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      const json = JSON.parse(raw.slice(s, e + 1));
      if (json.confidence >= 0.6) return json.projectId;
    } catch {}

    return null;
  }

  /* ------------------------------------------------------------
   * Recency history
   * ------------------------------------------------------------ */
  async _getRecentMessages() {
    try {
      const msgs = await readMemory("messages.json");
      if (!Array.isArray(msgs)) return [];
      return msgs.slice(-30).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text,
      }));
    } catch {
      return [];
    }
  }
}
