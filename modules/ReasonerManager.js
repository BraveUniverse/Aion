// ===== modules/ReasonerManager.js =====

/**
 * ReasonerManager
 * -------------------------------------------------------
 * AION'un LLM + Hafıza + Relevancy beyni.
 *
 * Amaç:
 *  - runReasoner çağrılarını tek yerden yönetmek
 *  - Hybrid Memory + RelevancyEngine çıktısını sisteme enjekte etmek
 *  - Çok uzun LLM cevaplarını ReasoningCompression ile kısaltmak
 *
 * Yani:
 *    systemPrompt + userPrompt
 *  + memoryPack.contextPack
 *  + relevancy.contextText
 *  -> tek bir "fullSystemPrompt" haline getiriliyor.
 */

import { runReasoner } from "../config/models.js";
import { RelevancyEngine } from "./Relevancy.js";
import { ReasoningCompression } from "./ReasoningCompression.js";
import { MemoryOrchestrator } from "../memory/MemoryOrchestrator.js";
import { MemoryIntegrationLayer } from "./MemoryIntegrationLayer.js";

export class ReasonerManager {
  constructor(options = {}) {
    this.relevancy = new RelevancyEngine(options.relevancy || {});
    this.memoryOrchestrator = new MemoryOrchestrator(options.memory || {});
    this.compressor = new ReasoningCompression(
      options.maxChars || 3200 // global default
    );
    this.memoryIntegration = new MemoryIntegrationLayer();
  }

  /**
   * Ana API
   * -----------------------------------------------------
   * @param {object} opts
   *   - systemPrompt: string (zorunlu)
   *   - userPrompt: string  (zorunlu)
   *
   *   - mode?: "chat" | "plan" | "task" | "mixed"
   *   - convInfo?: {}     → ConversationLayer'dan gelen yapı
   *   - taskContext?: { taskSpec?, pipelineSpec?, step? }
   *
   *   - history?: [{role, content}] → RelevancyEngine için
   *   - preferences?: object        → RelevancyEngine için
   *   - profile?: object            → RelevancyEngine için
   *
   *   - compress?: boolean          → çıktı çok uzunsa kısalt
   *   - maxChars?: number           → isteğe göre override
   *   - compressionKind?: string    → "generic" | "log" | "summary" vs.
   *
   * @returns {Promise<{
   *   text: string,         // kullanacağın final cevap
   *   raw: string,          // modelden gelen ham cevap
   *   fullSystemPrompt: string, // inject edilmiş prompt
   *   memoryPack: object,   // MemoryOrchestrator çıktısı
   *   relevancy: object     // RelevancyEngine çıktısı
   * }>}
   */
  async call(opts = {}) {
    const {
      systemPrompt,
      userPrompt,
      mode = "chat",
      convInfo = null,
      taskContext = null,
      history = [],
      preferences = {},
      profile = {},
      compress = true,
      maxChars,
      compressionKind = "generic",
    } = opts;

    if (!systemPrompt || !userPrompt) {
      throw new Error("ReasonerManager.call: systemPrompt ve userPrompt zorunludur.");
    }

    // 1) Hybrid Memory context üret (episodic + semantic + structured + long-term)
    const memoryPack = await this.memoryOrchestrator.buildContextPack(userPrompt);

    // 2) RelevancyEngine ile konuşma geçmişi + tercihleri anlamlandır
    const relevancy = await this.relevancy.analyze({
      history,
      currentInput: userPrompt,
      preferences,
      profile,
    });

    // 3) Final system prompt'u oluştur
    const fullSystemPrompt = this._buildFullSystemPrompt({
      baseSystemPrompt: systemPrompt,
      mode,
      convInfo,
      taskContext,
      memoryPack,
      relevancy,
    });

    // 4) LLM çağrısı (DeepSeek / runReasoner)
    const raw = await runReasoner(fullSystemPrompt, userPrompt);

    // 5) Gerekirse compression (çok uzun cevapları kısaltma)
    const text = compress
      ? await this.compressor.compressIfLong(raw, {
          kind: compressionKind,
          maxCharsOverride: maxChars,
        })
      : raw;

    // 6) MemoryIntegrationLayer ile uzun vadeli hafızaya işaret bırak
    try {
      await this.memoryIntegration.onReasonerCall({
        mode,
        convInfo,
        taskContext,
        systemPrompt: fullSystemPrompt,
        userPrompt,
        rawOutput: raw,
        finalText: text,
        memoryPack,
        relevancy,
      });
    } catch (err) {
      // Hafıza yazımı başarısız olursa sistemi bozmasın
      console.error("ReasonerManager: MemoryIntegration hata:", err);
    }

    return {
      text,
      raw,
      fullSystemPrompt,
      memoryPack,
      relevancy,
    };
  }

  /* --------------------------------------------------------
   * INTERNAL: fullSystemPrompt inşası
   * ------------------------------------------------------*/

  _buildFullSystemPrompt({
    baseSystemPrompt,
    mode,
    convInfo,
    taskContext,
    memoryPack,
    relevancy,
  }) {
    const lines = [];

    // 1) Orijinal systemPrompt
    lines.push(baseSystemPrompt.trim());
    lines.push("\n\n--- AION GLOBAL KURALLAR ---");
    lines.push(
      `
- Sen AION'sun: çok katmanlı, multi-agent bir beyin.
- Gelen contextPack ve relevancy bilgisi, bu oturuma özel hafıza özetidir.
- Kullanıcı mesajını yanıtlarken:
  - Bu context'i tamamen görmezden gelme.
  - Ama eski ve alakasız detaylara da takılma.
  - Güncel isteği merkezde tut, hafızayı sadece destek için kullan.
- Gerekiyorsa, eski planlardan veya görevlerden bahsedebilirsin ama "tarihi bilgi" olduğunu belirt.
`.trim()
    );

    // 2) Mod / intent bilgisi
    lines.push("\n--- AION MODE / INTENT ---");
    lines.push(
      JSON.stringify(
        {
          mode,
          intent: convInfo?.intent || null,
          meta: convInfo?.meta || null,
        },
        null,
        2
      )
    );

    // 3) Task context (eğer varsa)
    if (taskContext) {
      lines.push("\n--- TASK CONTEXT ---");
      lines.push(
        JSON.stringify(
          {
            taskId: taskContext.taskSpec?.id || null,
            taskType: taskContext.taskSpec?.type || null,
            pipelineTaskId: taskContext.pipelineSpec?.taskId || null,
            step: taskContext.step
              ? {
                  id: taskContext.step.id,
                  title: taskContext.step.title,
                  agent: taskContext.step.agent,
                }
              : null,
          },
          null,
          2
        )
      );
    }

    // 4) MemoryOrchestrator contextPack
    lines.push("\n--- HYBRID MEMORY CONTEXT PACK ---");
    lines.push(memoryPack?.contextPack || "(boş)");

    // 5) RelevancyEngine contextText
    lines.push("\n--- RELEVANCY CONTEXT ---");
    lines.push(
      JSON.stringify(
        {
          messageType: relevancy?.messageType || null,
          suggestedMode: relevancy?.suggestedMode || null,
          score: relevancy?.score || 0,
        },
        null,
        2
      )
    );

    lines.push("\n--- RELEVANCY RAW CONTEXT TEXT ---");
    lines.push(relevancy?.contextText || "(yok)");

    return lines.join("\n");
  }
}

// Tekil instance (isteğe bağlı)
// Diğer dosyalarda:
//   import { reasonerManager } from "../modules/ReasonerManager.js";
//   const { text } = await reasonerManager.call({ ... });
export const reasonerManager = new ReasonerManager();
