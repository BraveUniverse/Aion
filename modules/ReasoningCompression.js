// ===== modules/ReasoningCompression.js =====

/**
 * ReasoningCompression
 * -------------------------------------------------------
 * Görev:
 *  - Çok uzun reasoning metinlerini, pipeline loglarını ve output'ları
 *    daha kısa ama anlamı koruyan formatlara sıkıştırmak.
 */

import { runReasoner } from "../config/models.js";
import { appendMemory } from "./MemoryEngine.js";

export class ReasoningCompression {
  constructor(maxChars = 2000) {
    this.maxChars = maxChars;
  }

  async compress(text, contextInfo = {}) {
    if (!text) return "";

    // Çok kısaysa zaten direk döndür
    if (text.length <= this.maxChars) return text;

    const systemPrompt = `
Sen AION'un ReasoningCompression modülüsün.

Görevin:
- Verilen uzun reasoning / log metnini
- Önemli noktalar kaybolmayacak şekilde
- Daha kısa bir metne dönüştürmek.

Kurallar:
- Kısa ama teknik doğruluğu koru.
- Gereksiz tekrarları, "düşünme" kalıplarını at.
`.trim();

    const userPrompt = `
Context:
${JSON.stringify(contextInfo, null, 2)}

Orijinal metin (kısaltılacak):
${text}
`;

    const summary = await runReasoner(systemPrompt, userPrompt);

    appendMemory("reasoning_compression.json", {
      originalLength: text.length,
      compressedLength: summary.length,
      contextInfo,
      createdAt: new Date().toISOString(),
    });

    return summary;
  }
}
