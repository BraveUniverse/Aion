// ===== agents/PipelineCreatorAgent.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export default class PipelineCreatorAgent {
  constructor() {
    this.name = "PipelineCreatorAgent";
  }

  /**
   * Input:
   *  {
   *    taskSpec: {...},
   *    plan: "..."
   *  }
   *
   * Output (PipelineSpec):
   *  {
   *    steps: [
   *      { id, agent, input },
   *      ...
   *    ]
   *  }
   */
  async execute({ taskSpec = {}, plan = "" }) {
    const systemPrompt = `
Sen AION'un PipelineCreatorAgent modülüsün.

Görevin:
- Verilen task + plan'a göre yürütülebilir bir pipeline JSON üretmek.
- Her step mutlaka:
  - id
  - agent (string)
  - input (object)
içermeli.

ÇIKTI ÖRNEĞİ:
{
  "steps": [
    {
      "id": "step1",
      "agent": "CodeAgent",
      "input": {
        "operation": "create_file",
        "path": "src/index.js",
        "content": "..."
      }
    }
  ]
}
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

Plan:
${plan}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed = { steps: [] };
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      // fallback: plan'ı tek step olarak koy
      parsed.steps = [
        {
          id: "fallback-step",
          agent: "ResearchAgent",
          input: { text: raw },
        },
      ];
    }

    appendMemory("pipeline_creator_runs.json", {
      taskId: taskSpec.id,
      steps: parsed.steps,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }
}
