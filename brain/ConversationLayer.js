// ===== brain/ConversationLayer.js =====

import { runReasoner } from "../config/models.js";
import {
  appendMemory,
  readMemory,
} from "../modules/MemoryEngine.js";

/**
 * ConversationLayer
 * ----------------------------------------------
 * Kullanıcı mesajını analiz eder ve:
 *  - intent: "chat" | "plan" | "task" | "mixed"
 *  - projekt: hangi proje ile ilgili
 *  - semantic domain: teknik mi, stratejik mi, sosyal mi
 *  - possible triggers: planlama tetikleyicileri, task tetikleyicileri
 *
 *  Amaç: Interpreter'a doğru modda mesaj yollamak.
 *  Eğer yanlış mod seçilirse AION beyninin tamamı yanlış çalışır.
 */

export class ConversationLayer {
  constructor() {}

  /**
   * Kullanıcının mesajını alır → AI reasoning ile mod ve intent çıkarır.
   */
  async processUserMessage(userMessage, options = {}) {
    const projectIdHint = await this.detectRelatedProject(userMessage);

    // 1) Ön analiz (hızlı regex + keyword tarama)
    const pre = this.quickIntentCheck(userMessage);

    // “Kesin plan” veya “kesin task” gibi net bir durumda reasoning’e bile gerek yok
    if (pre.forceMode) {
      return {
        raw: userMessage,
        intent: pre.forceMode,
        isChat: pre.forceMode === "chat",
        isPlan: pre.forceMode === "plan",
        isTask: pre.forceMode === "task",
        projectIdHint,
        meta: { preAnalysis: pre },
      };
    }

    // 2) Derin analiz (DeepSeek Reasoner)
    const deep = await this.reasonIntent(userMessage);

    // Deep çıkışını normalize et
    const intent = this.normalizeIntent(deep.intent);

    return {
      raw: userMessage,
      intent,
      isChat: intent === "chat",
      isPlan: intent === "plan",
      isTask: intent === "task",
      projectIdHint,
      meta: {
        preAnalysis: pre,
        deepAnalysis: deep,
      },
    };
  }

  /* ------------------------------------------------------------
   * 1) QUICK INTENT CHECK — çok hızlı tetikleyiciler
   * ----------------------------------------------------------*/
  quickIntentCheck(text) {
    const lowered = text.toLowerCase();

    // Task tetikleyicileri
    const taskTriggers = [
      "oluştur",
      "yaz",
      "kodla",
      "generate",
      "oluşturur musun",
      "çalıştır",
      "çıktı üret",
      "patch",
      "agent yap",
      "pipeline oluştur",
      "dosya yaz",
      "compile et",
      "uygula",
    ];

    for (const t of taskTriggers) {
      if (lowered.includes(t)) {
        return { forceMode: "task", reason: `Trigger: ${t}` };
      }
    }

    // Plan tetikleyicileri
    const planTriggers = [
      "bunu planlayalım",
      "beyin fırtınası yapalım",
      "mantığını oturtalım",
      "nasıl yaparız",
      "nasıl işler",
      "adımlara bölelim",
      "konuşalım",
      "yol haritası",
      "architecture",
      "mimari",
      "tasarım planı",
      "önce plan",
      "önce anlamamız lazım",
    ];

    for (const p of planTriggers) {
      if (lowered.includes(p)) {
        return { forceMode: "plan", reason: `Trigger: ${p}` };
      }
    }

    // Chat tetikleyicileri
    const chatTriggers = [
      "nasılsın",
      "iyi misin",
      "sohbet",
      "sence",
      "ne düşünüyorsun",
    ];

    for (const c of chatTriggers) {
      if (lowered.includes(c)) {
        return { forceMode: "chat", reason: `Trigger: ${c}` };
      }
    }

    return { forceMode: null }; // belirsiz → reasoning’e gidilecek
  }

  /* ------------------------------------------------------------
   * 2) DEEP INTENT REASONING — gerçek beyin
   * ----------------------------------------------------------*/
  async reasonIntent(message) {
    const systemPrompt = `
Sen AION'un NİYET BEYNİSİN.

Görevin:
Kullanıcının mesajından hangi modun gerektiğini bulmak:
- "chat": sohbet, açıklama, Q&A
- "plan": mimari, konsept, düşünme, beyin fırtınası, strateji, yol haritası
- "task": somut iş, kod üretme, dosya düzenleme, pipeline yürütme

Kesin kurallar:
- Yeni fikir, sistem tasarımı, mimari konuşmaları → plan
- Teknik açıklama, soru-cevap, bilgi → chat
- Kodlama, dosya, pipeline, ajan, task istekleri → task
- Eğer kullanıcı “önce konuşalım, planlayalım” diyorsa → plan
- Eğer kullanıcı ne istediğini tam söylemiyorsa ama teknik bir iş ima ediyorsa → plan
- Belirsizse → "mixed"

Sadece şu JSON formatında yanıt ver:

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
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const jsonStr = text.slice(start, end + 1);
        const parsed = JSON.parse(jsonStr);

        return {
          intent: this.normalizeIntent(parsed.intent),
          confidence: parsed.confidence ?? 0.5,
          summary: parsed.summary || "",
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
   * 3) PROJECT DETECTION — hangi projeye ait?
   * ----------------------------------------------------------*/
  async detectRelatedProject(message) {
    // Eğer hiç proje yoksa null döndür.
    const projects = readMemory("projects.json") || [];
    if (!Array.isArray(projects) || projects.length === 0) {
      return null;
    }

    const systemPrompt = `
Sen AION'un proje eşleştirme modülüsün.

Görevin:
Kullanıcının mesajını aşağıdaki projelerden biriyle eşleştirmek.
Sadece semantic yakınlığa bak:
- İsim
- Amaç
- Teknoloji
- Bağlam

ÇIKTI FORMAT:
{
  "projectId": "id" | null,
  "reason": "kısa açıklama",
  "confidence": 0.0-1.0
}

Eğer hiçbir proje ile %60 üzeri eşleşme yoksa projectId = null döndür.
`.trim();

    const userPrompt = `
Kullanıcı mesajı:
${message}

Projeler:
${JSON.stringify(projects, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const json = JSON.parse(raw.slice(start, end + 1));

      if (json.confidence >= 0.6) {
        return json.projectId;
      }
    } catch {}

    return null;
  }
}
