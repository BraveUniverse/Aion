// ===== modules/ToolArbitration.js =====

/**
 * ToolArbitration
 * -------------------------------------------------------
 * Görev:
 *  - Gelen task için hangi agent/tool kombinasyonunun kullanılacağını
 *    LLM yardımıyla seçmek.
 *
 * Not:
 *  - Şu an sadece "öneri" döner; zorunlu kılmaz.
 *  - Planner veya Controller isterse bu öneriyi kullanabilir.
 */

import { runReasoner } from "../config/models.js";
import { appendMemory } from "./MemoryEngine.js";

export class ToolArbitration {
  constructor() {
    this.defaultAgents = [
      "CodeAgent",
      "FileAgent",
      "FixAgent",
      "ResearchAgent",
      "PlanAgent",
      "PipelineCreatorAgent",
      "AgentCreatorAgent",
    ];
  }

  /**
   * @param {object} taskSpec
   * @param {Array<string>} availableAgents
   * @returns {Promise<{primary: string, secondary: string[], reason: string}>}
   */
  async decide(taskSpec, availableAgents = []) {
    const agents =
      availableAgents.length > 0 ? availableAgents : this.defaultAgents;

    const systemPrompt = `
Sen AION'un ToolArbitration beynisin.

Görev:
- Verilen task için en uygun agent'ı seç.
- Ayrıca alternatif olabilecek ikincil agent listesini de ver.

Kurallar:
- Sadece verilen listeden agent seçebilirsin.
- Çıkış JSON olsun:
{
  "primary": "AgentName",
  "secondary": ["AgentName1", "AgentName2"],
  "reason": "kısa açıklama"
}
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

Mevcut agent'lar:
${JSON.stringify(agents)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed;
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      parsed = {
        primary: "CodeAgent",
        secondary: [],
        reason: "Parse fallback",
      };
    }

    appendMemory("tool_arbitration.json", {
      taskId: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      decision: parsed,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }
}
