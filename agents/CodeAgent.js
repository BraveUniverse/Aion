// ===== agents/CodeAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * CodeAgent
 * -------------------------------------------------------
 * Kod üretme, kod tamamlama, refactor, örnek proje iskeleti üretme gibi
 * işleri yapar. Şu an DeepSeek Reasoner ile çalışıyor.
 *
 * input yapısı örnek:
 * {
 *   taskGoal: "...",
 *   taskDetails: {
 *     language: "js",
 *     framework: "nextjs",
 *     operation: "generate" | "refactor" | "add_feature",
 *     filePath: "src/app/page.tsx",
 *     existingCode: "..."
 *   },
 *   contextSnapshot: {...},
 *   stepId: "step_1",
 *   stepTitle: "Generate skeleton"
 * }
 */

export class CodeAgent {
  async run(input, context = {}) {
    const { taskGoal, taskDetails = {} } = input;
    const {
      language = "javascript",
      framework,
      operation = "generate",
      filePath,
      existingCode,
      notes,
    } = taskDetails;

    const systemPrompt = `
Sen AION'un CodeAgent'ısın.
Görevin: Kullanıcının hedefi doğrultusunda temiz, çalışabilir ve mümkün olduğunca
üretime yakın kod üretmek veya mevcut kodu iyileştirmektir.

Kurallar:
- Dil: ${language}
- Framework: ${framework || "belirtilmemiş, gerekiyorsa öner"}
- Eğer operation = "generate" ise sıfırdan kod üret.
- Eğer operation = "refactor" veya "add_feature" ise existingCode'a göre hareket et.
- Mümkünse tek, bütünlüklü bir dosya içeriği üret.
- Kod dışında açıklama yazma, sadece kısa yorum satırları ve kod üret.
`.trim();

    const userPrompt = `
Görev Hedefi:
${taskGoal}

Detaylar:
${JSON.stringify(taskDetails, null, 2)}

Context (önceki adımlar):
${JSON.stringify(context, null, 2)}

${existingCode ? `Mevcut Kod:\n${existingCode}\n` : ""}
`;

    const rawCode = await runReasoner(systemPrompt, userPrompt);

    const result = {
      type: "code",
      language,
      framework: framework || null,
      filePath: filePath || null,
      operation,
      code: rawCode,
      meta: {
        notes: notes || null,
      },
    };

    appendMemory("code_agent_outputs.json", {
      input: { taskGoal, taskDetailsSummary: taskDetails },
      resultSummary: {
        language,
        framework: framework || null,
        filePath: filePath || null,
        operation,
      },
      createdAt: new Date().toISOString(),
    });

    return result;
  }
}
