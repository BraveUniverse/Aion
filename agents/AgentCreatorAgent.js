// ===== agents/AgentCreatorAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export default class AgentCreatorAgent {
  constructor() {
    this.name = "AgentCreatorAgent";
  }

  /**
   * Input:
   * {
   *   agentName: "MySpecialAgent",
   *   description: "File analiz yapıp özet çıkaracak"
   * }
   *
   * Output:
   * {
   *   filename: "MySpecialAgent.js",
   *   content: "class ..."
   * }
   */
  async execute({ agentName = "", description = "" }) {
    const systemPrompt = `
Sen AION'un AgentCreatorAgent modülüsün.

Görevin:
- Yeni bir agent için tam çalışan bir JS sınıf dosyası üretmek.
- Agent API:
  class AgentName {
    constructor() { this.name = "AgentName"; }
    async execute(input) { ... }
  }
- Mutlaka default export kullanılmalı.

Çıkış JSON:
{
  "filename": "AgentName.js",
  "content": "class AgentName {...}"
}
`.trim();

    const userPrompt = `
Yeni agent adı: ${agentName}

Görev tanımı:
${description}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed = { filename: "", content: "" };
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed.filename = `${agentName}.js`;
      parsed.content = raw.trim();
    }

    appendMemory("agent_creator_runs.json", {
      agent: agentName,
      description,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }
}
