// ===== modules/ReasoningCompression.js =====

/**
 * ReasoningCompression (Advanced)
 * -------------------------------------------------------
 * Görev:
 *  - Uzun reasoning / log / plan / pipeline çıktısını
 *    daha kısa ama anlamı korunmuş hale getirmek.
 *
 * Kullanım:
 *  compress(text, { kind, taskSpec, pipelineSpec, maxCharsOverride })
 *
 * kind:
 *  - "reasoning"   : düşünme metni
 *  - "plan"        : plan JSON + açıklama
 *  - "log"         : pipeline log'ları
 *  - "summary"     : genel özet
 */

import { runReasoner } from "../config/models.js";
import { appendMemory } from "./MemoryEngine.js";

export class ReasoningCompression {
  constructor(defaultMaxChars = 2000) {
    this.defaultMaxChars = defaultMaxChars;
  }

  async compress(text, options = {}) {
    if (!text) return "";

    const maxChars = options.maxCharsOverride || this.defaultMaxChars;

    if (text.length <= maxChars) return text;

    const kind = options.kind || "reasoning";

    const systemPrompt = this._buildSystemPrompt(kind);

    const userPrompt = this._buildUserPrompt(text, options);

    const summary = await runReasoner(systemPrompt, userPrompt);

    appendMemory("reasoning_compression.json", {
      kind,
      originalLength: text.length,
      compressedLength: summary.length,
      meta: {
        taskId: options.taskSpec?.id || null,
        pipelineTaskId: options.pipelineSpec?.taskId || null,
      },
      createdAt: new Date().toISOString(),
    });

    return summary;
  }

  async compressIfLong(text, options = {}) {
    const maxChars = options.maxCharsOverride || this.defaultMaxChars;
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return this.compress(text, options);
  }

  _buildSystemPrompt(kind) {
    if (kind === "plan") {
      return `
Sen AION'un PLAN KISALTMA modülüsün.

Görevin:
- Uzun plan / blueprint metnini
- ana fikirleri kaybetmeden
- daha kısa bir plan halinde özetlemek.

Kurallar:
- Madde madde yazabilirsin.
- Teknik doğruluğu koru.
- Gereksiz tekrarları at.
`.trim();
    }

    if (kind === "log") {
      return `
Sen AION'un LOG KISALTMA modülüsün.

Görevin:
- Uzun pipeline loglarını,
- hata mesajlarını,
- step output'larını
daha kısa ama anlamlı bir döküm haline getirmek.

Kurallar:
- Önemli hataları, uyarıları ve kritik adımları kaybetme.
- Spam benzeri tekrarları kaldır.
`.trim();
    }

    if (kind === "summary") {
      return `
Sen AION'un ÖZET modülüsün.

Görevin:
- Verilen metni anlaşılır ve kısa bir özet haline getirmek.
- Teknik detayları kısmen koru ama gereksiz ayrıntıyı azalt.
`.trim();
    }

    // default: reasoning
    return `
Sen AION'un REASONING KISALTMA modülüsün.

Görevin:
- Uzun düşünme metnini,
- mantıksal zinciri bozmadan,
- daha kısa bir formata indirgemek.

Kurallar:
- Çıkarım adımlarını koru ama tekrar eden kalıpları sil.
- Sonuç kısmını net bırak.
`.trim();
  }

  _buildUserPrompt(text, options) {
    const meta = {
      taskSpec: options.taskSpec ? options.taskSpec : undefined,
      pipelineSpec: options.pipelineSpec ? options.pipelineSpec : undefined,
    };

    return `
Ek bağlam (opsiyonel):
${JSON.stringify(meta, null, 2)}

Kısaltılacak metin:
${text}
`;
  }
}
