// ===== agents/PlanAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export default class PlanAgent {
  constructor() {
    this.name = "PlanAgent";
  }

  /**
   * Ajan giriş formatı:
   * {
   *   taskSpec: {...},
   *   preferences: {...}
   * }
   *
   * Çıkış:
   * {
   *   plan: "metinsel plan"
   * }
   */
  async execute({ taskSpec = {}, preferences = {} }) {
    const systemPrompt = `
Sen AION'un PlanAgent modülüsün.

Görevin:
- Verilen taskSpec'e göre mantıklı, kısa, uygulanabilir bir plan üretmek.
- Plan bir "pipeline" değildir; konsept plandır.
- Kullanıcıya gösterilebilecek şekilde sade olmalı.

Çıkış:
{
  "plan": "..."
}
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

Preferences:
${JSON.stringify(preferences, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed = { plan: "" };
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed.plan = raw.trim();
    }

    appendMemory("plan_agent_runs.json", {
      type: taskSpec.type,
      goal: taskSpec.goal,
      plan: parsed.plan,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }
}
