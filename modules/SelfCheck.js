// ===== modules/SelfCheck.js =====

/**
 * SelfCheck
 * -------------------------------------------------------
 * Ortak self-check fonksiyonları:
 *  - step çıktısı
 *  - pipeline sonucu
 *  - plan / blueprint
 */

import { runReasoner } from "../config/models.js";
import { appendMemory } from "./MemoryEngine.js";

export class SelfCheck {
  /* ---------- Step level ---------- */

  async checkStep({ taskSpec, step, input, output }) {
    const systemPrompt = `
Sen AION'un STEP SELF-CHECK modülüsün.

Görev:
- Bir pipeline adımının çıktısının mantıklı olup olmadığını kontrol et.

Çıkış JSON:
{
  "ok": true/false,
  "reason": "kısa açıklama"
}
`.trim();

    const userPrompt = `
Task:
${JSON.stringify(taskSpec, null, 2)}

Step:
${JSON.stringify(step, null, 2)}

Input:
${JSON.stringify(input, null, 2)}

Output:
${JSON.stringify(output, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed;
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed = { ok: true, reason: "parse fallback" };
    }

    appendMemory("selfcheck_step.json", {
      taskId: taskSpec.id,
      stepId: step.id,
      result: parsed,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }

  /* ---------- Pipeline level ---------- */

  async checkPipeline({ taskSpec, pipelineSpec, context, logs, status }) {
    const systemPrompt = `
Sen AION'un PIPELINE SELF-CHECK beynisin.

Görev:
- Pipeline çalışmasının genel durumunu değerlendir.

Çıkış JSON:
{
  "ok": true/false,
  "summary": "kısa özet",
  "hints": ["...", "..."]
}
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

PipelineSpec:
${JSON.stringify(pipelineSpec, null, 2)}

Status: ${status}

Context:
${JSON.stringify(context, null, 2)}

Logs:
${JSON.stringify(logs, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed;
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed = {
        ok: status === "success",
        summary: "parse fallback",
        hints: [],
      };
    }

    appendMemory("selfcheck_pipeline.json", {
      taskId: taskSpec.id,
      status,
      result: parsed,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }

  /* ---------- Plan / Blueprint level ---------- */

  async checkPlan(rawPlanText, extra = {}) {
    const systemPrompt = `
Sen AION'un PLAN SELF-CHECK beynisin.

Görev:
- Verilen plan veya blueprint metnini hızlıca değerlendir.
- Bariz eksiklikleri yakala.

Çıkış JSON:
{
  "ok": true/false,
  "summary": "kısa açıklama",
  "issues": ["...", "..."]
}
`.trim();

    const userPrompt = `
Ek bilgi:
${JSON.stringify(extra, null, 2)}

Plan / Blueprint:
${rawPlanText}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed;
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed = { ok: true, summary: "parse fallback", issues: [] };
    }

    appendMemory("selfcheck_plan.json", {
      extra,
      result: parsed,
      createdAt: new Date().toISOString(),
    });

    return parsed;
  }
}
