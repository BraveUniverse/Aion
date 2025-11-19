// ===== agents/FixAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * FixAgent
 * -------------------------------------------------------
 * Hata loglarına ve mevcut koda bakıp patch önerisi üretir.
 * Genelde CodeAgent + FileAgent ile birlikte kullanılır.
 *
 * input örnek:
 * {
 *   taskGoal: "...",
 *   taskDetails: {
 *     errorLog: "...",
 *     filePath: "src/app/page.tsx",
 *     existingCode: "..."
 *   }
 * }
 */

export class FixAgent {
  async run(input, context = {}) {
    const { taskGoal, taskDetails = {} } = input;
    const { errorLog, filePath, existingCode } = taskDetails;

    const systemPrompt = `
Sen AION'un FixAgent'ısın.
Görevin: Hata logu ve mevcut kodu inceleyip sorunu bulmak ve
gerekirse PATCH önermek.

Kurallar:
- Önce hatanın kök sebebini kısaca analiz et.
- Sonra tam düzeltilmiş kodu üret.
- Çıkışta mutlaka JSON döndür:
{
  "rootCause": "kısa açıklama",
  "explanation": "daha detay açıklama",
  "fixedCode": "tam kod (mümkünse tüm dosya)",
  "filePath": "..."
}
`.trim();

    const userPrompt = `
Görev:
${taskGoal}

Hata Logu:
${errorLog}

Dosya Yolu:
${filePath || "bilinmiyor"}

Mevcut Kod:
${existingCode || "verilmedi"}

Context:
${JSON.stringify(context, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);
    const parsed = this.safeParseFixResult(raw, filePath);

    appendMemory("fix_agent_outputs.json", {
      taskGoal,
      filePath: parsed.filePath,
      rootCause: parsed.rootCause,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }

  safeParseFixResult(text, fallbackPath) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const json = JSON.parse(text.slice(start, end + 1));
      return {
        rootCause: json.rootCause || "",
        explanation: json.explanation || "",
        fixedCode: json.fixedCode || "",
        filePath: json.filePath || fallbackPath || null,
      };
    } catch {
      return {
        rootCause: "Parse fallback",
        explanation: text,
        fixedCode: "",
        filePath: fallbackPath || null,
      };
    }
  }
}
