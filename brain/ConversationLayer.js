// ===== brain/ConversationLayer.js =====

import { runReasoner } from "../config/models.js";
import {
  appendMemory,
  readMemory,
} from "../modules/MemoryEngine.js";

import { RelevancyEngine } from "../modules/Relevancy.js";   // ★ Yeni gelişmiş katman

/**
 * ConversationLayer (Advanced + Relevancy Integration)
 * ----------------------------------------------------
 * 1) quickIntentCheck → hızlı tetikleyici
 * 2) relevancyEngine.analyze → bağlam + mesaj tipi + mode önerisi
 * 3) deepIntentReasoner → reasoning tabanlı mod seçimi
 *
 * Çıkış: {
 *   raw,
 *   intent,
 *   isChat,
 *   isPlan,
 *   isTask,
 *   projectIdHint,
 *   relevancy: {...},
 *   meta: { preAnalysis, relevancyAnalysis, deepAnalysis }
 * }
 */

export class ConversationLayer {
  constructor() {
    this.relevancy = new RelevancyEngine({
      maxMessages: 12,
      maxTasks: 20,
      maxChars: 9000,
    });
  }

  /**
   * Kullanıcı mesajını alır → intent + context + projectId çıkartır.
   */
  async processUserMessage(userMessage, options = {}) {
    const projectIdHint = await this.detectRelatedProject(userMessage);

    // 0) Hafıza + konuşma geçmişini al
    const history = await this._getRecentMessages();

    // 1) Quick intent (trigger bazlı)
    const pre = this.quickIntentCheck(userMessage);

    // 2) RelevancyEngine analizi
    const rel = await this.relevancy.analyze({
      history,
      currentInput: userMessage,
      preferences: {}, // ileride doldurulabilir
      profile: {},     // ileride doldurulabilir
    });

    // Eğer quickIntent kesin sonuç verdiyse reasoning’e gitmeden döner
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

    // Eğer relevancyEngine net bir mod önerdiyse (çok yüksek sinyal)
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

    // 3) Derin reasoning → intent çıkarılır
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

  /* ------------------------------------------------------------
   * Internal: çıktı inşası
   * ------------------------------------------------------------ */
  _buildOutput({ userMessage, intent, projectIdHint, pre, rel, deep }) {
    const norm = this.normalizeIntent(intent);

    return {
      raw: userMessage,
      intent: norm,
      isChat: norm === "chat",
      isPlan: norm === "plan",
      isTask: norm === "task",
      projectIdHint,
      contextText: rel.contextText,   // ★ AION.js'e direkt paslanır
      relevancy: rel,                 // ★ Plan / Task / Chat tüm sistemde kullanılabilir
      meta: {
        preAnalysis: pre,
        relevancyAnalysis: rel,
        deepAnalysis: deep,
      },
    };
  }

  /* ------------------------------------------------------------
   * Intent Merge (pre + relevancy + deep)
   * ------------------------------------------------------------ */
  _mergeIntent(pre, rel, deep) {
    // 1) Quick intent en güçlü sinyal → override eder
    if (pre.forceMode) return pre.forceMode;

    // 2) RelevancyEngine önerisi (strong)
    if (rel.suggestedMode !== "mixed") return rel.suggestedMode;

    // 3) Deep intent
    if (deep?.intent && deep.intent !== "mixed") return deep.intent;

    return "mixed";
  }

  /* ------------------------------------------------------------
   * 1) QUICK INTENT CHECK
   * ------------------------------------------------------------ */
  quickIntentCheck(text) {
    const lowered = text.toLowerCase();

    // Task tetikleyicileri
    const taskTriggers = [
      "oluştur", "yaz", "kodla", "generate",
      "çalıştır", "çıktı üret", "patch", "agent yap",
      "pipeline oluştur", "dosya yaz", "compile et", "uygula"
    ];

    for (const t of taskTriggers) {
      if (lowered.includes(t)) {
        return { forceMode: "task", reason: `Trigger: ${t}` };
      }
    }

    // Plan tetikleyicileri
    const planTriggers = [
      "bunu planlayalım", "beyin fırtınası", "mantığını oturtalım",
      "nasıl yaparız", "nasıl işler", "adımlara bölelim",
      "yol haritası", "architecture", "mimari", "tasarım planı"
    ];

    for (const p of planTriggers) {
      if (lowered.includes(p)) {
        return { forceMode: "plan", reason: `Trigger: ${p}` };
      }
    }

    // Chat tetikleyicileri
    const chatTriggers = [
      "nasılsın", "iyi misin", "sohbet", "sence", "ne düşünüyorsun"
    ];

    for (const c of chatTriggers) {
      if (lowered.includes(c)) {
        return { forceMode: "chat", reason: `Trigger: ${c}` };
      }
    }

    return { forceMode: null };
  }

  /* ------------------------------------------------------------
   * 2) DEEP INTENT REASONING
   * ------------------------------------------------------------ */
  async reasonIntent(message) {
    const systemPrompt = `
Sen AION'un NİYET BEYNİSİN.

Görevin:
Kullanıcının mesajından hangi modun gerektiğini bulmak:
- "chat": sohbet, açıklama
- "plan": mimari, strateji
- "task": somut iş (kod, dosya, pipeline)

Belirsizse → "mixed"

Sadece JSON üret:
{
  "intent": "chat | plan | task | mixed",
  "confidence": 0.0-1.0,
  "summary": "kısa açıklama"
}
`.trim();

    const raw = await runReasoner(systemPrompt, message);

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
   * PROJECT DETECTION
   * ------------------------------------------------------------ */
  async detectRelatedProject(message) {
    const projects = readMemory("projects.json") || [];
    if (!Array.isArray(projects) || projects.length === 0) return null;

    const systemPrompt = `
Sen AION'un proje eşleştirme modüsün.
%60 üzeri semantic uyum varsa projectId döndür.
Sadece JSON döndür.

{
  "projectId": "id" | null,
  "reason": "...",
  "confidence": 0.0-1.0
}
`.trim();

    const raw = await runReasoner(systemPrompt, `
Mesaj: ${message}
Projeler: ${JSON.stringify(projects, null, 2)}
`);

    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      const json = JSON.parse(raw.slice(s, e + 1));

      if (json.confidence >= 0.6) return json.projectId;
    } catch {}

    return null;
  }

  /* ------------------------------------------------------------
   * Konuşma geçmişini getir (MemoryEngine)
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
