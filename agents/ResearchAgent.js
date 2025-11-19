// ===== agents/ResearchAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * ResearchAgent
 * -------------------------------------------------------
 * Derin açıklama, kavram analizi, tasarım opsiyonları, artı/eksi
 * değerlendirmesi gibi "düşünme" odaklı işleri yapar.
 *
 * input örnek:
 * {
 *   taskGoal: "...",
 *   taskDetails: {
 *     focus: "architecture | performance | security | ux | general",
 *     questions: ["...", "..."]
 *   }
 * }
 */

export class ResearchAgent {
  async run(input, context = {}) {
    const { taskGoal, taskDetails = {}, mode } = input;
    const { focus = "general", questions = [] } = taskDetails;

    const systemPrompt = `
Sen AION'un ResearchAgent'ısın.
Görevin: Verilen hedef ve sorular doğrultusunda derin ama sindirilebilir
bir analiz yapmak.

Mod: ${mode || "research"}

Odak: ${focus}

Kurallar:
- Gereksiz süs yok, net ve teknik ağırlıklı ama anlaşılır Türkçe.
- Mümkünse maddeli anlat, ama JSON istemiyoruz, düz metin istiyoruz.
- Eğer kullanıcı mimari istiyorsa: alternatifleri karşılaştır.
- Eğer kullanıcı performans istiyorsa: bottleneck ve çözüm öner.
`.trim();

    const userPrompt = `
Görev Hedefi:
${taskGoal}

Sorular:
${JSON.stringify(questions, null, 2)}

Context:
${JSON.stringify(context, null, 2)}
`;

    const answer = await runReasoner(systemPrompt, userPrompt);

    const result = {
      type: "research",
      focus,
      answer,
    };

    appendMemory("research_agent_outputs.json", {
      taskGoal,
      focus,
      createdAt: new Date().toISOString(),
    });

    return result;
  }
}
