// ===== brain/ControllerLayer.js =====

import { runReasoner } from "../config/models.js";
import { ExecutionEngine } from "../engine/ExecutionEngine.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * ControllerLayer
 * -------------------------------------------------------
 * Görev: PlannerLayer'dan gelen PipelineSpec'i,
 * ExecutionEngine ve agent'lar üzerinden adım adım çalıştırmak.
 *
 * Özellikler:
 *  - Sıralı step yürütme
 *  - step.retry desteği
 *  - step bazlı self-check (LLM ile)
 *  - pipeline bazlı self-check
 *  - detaylı log ve context kaydı
 */

export class ControllerLayer {
  constructor() {
    this.executionEngine = new ExecutionEngine();
  }

  /**
   * Ana fonksiyon:
   * TaskSpec + PipelineSpec alır → pipelineResult döner.
   */
  async runPipeline(taskSpec, pipelineSpec) {
    const startedAt = new Date().toISOString();

    const context = {}; // step çıktıları burada birikir
    const logs = [];
    let status = "running";
    let failedStep = null;

    // Adımları sırayla çalıştır
    for (const step of pipelineSpec.steps) {
      const stepLog = {
        id: step.id,
        title: step.title,
        agent: step.agent,
        startedAt: new Date().toISOString(),
        attempts: [],
      };

      const maxRetry = step.retry ?? 1;
      let success = false;
      let lastOutput = null;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetry; attempt++) {
        const attemptLog = {
          attempt,
          startedAt: new Date().toISOString(),
        };

        try {
          const input = this.buildStepInput(step, taskSpec, context);

          // Agent çalıştır
          const output = await this.executionEngine.runAgent(
            step.agent,
            input,
            context
          );

          attemptLog.rawOutput = output;

          // Step self-check
          const selfCheck = await this.selfCheckStep(
            taskSpec,
            pipelineSpec,
            step,
            input,
            output
          );

          attemptLog.selfCheck = selfCheck;

          // Self-check başarısızsa bir daha dene
          if (!selfCheck.ok && attempt < maxRetry) {
            attemptLog.result = "selfcheck_failed_retrying";
          } else if (!selfCheck.ok && attempt >= maxRetry) {
            attemptLog.result = "selfcheck_failed_giveup";
            lastOutput = output;
            lastError = new Error("Self-check başarısız.");
          } else {
            // Başarılı
            success = true;
            lastOutput = output;
            attemptLog.result = "success";
          }
        } catch (err) {
          lastError = err;
          attemptLog.error = String(err?.message || err);
          attemptLog.result = attempt < maxRetry ? "error_retrying" : "error_giveup";
        }

        attemptLog.finishedAt = new Date().toISOString();
        stepLog.attempts.push(attemptLog);

        if (success) break;
      }

      stepLog.finishedAt = new Date().toISOString();
      stepLog.success = success;
      logs.push(stepLog);

      // context'e step sonucu kaydet
      context[step.id] = {
        success,
        output: lastOutput,
        error: lastError ? String(lastError?.message || lastError) : null,
      };

      if (!success) {
        status = "error";
        failedStep = step.id;
        break;
      }
    }

    // Eğer hata yoksa status'i success/done olarak işaretle
    if (status !== "error") {
      status = "success";
    }

    // Pipeline-level self-check
    const pipelineSelfCheck = await this.selfCheckPipeline(
      taskSpec,
      pipelineSpec,
      context,
      logs,
      status,
      failedStep
    );

    const finishedAt = new Date().toISOString();

    const result = {
      status,
      failedStep,
      context,
      logs,
      selfCheck: pipelineSelfCheck,
      startedAt,
      finishedAt,
    };

    // Memory log
    appendMemory("pipeline_runs.json", {
      taskId: taskSpec.id,
      pipelineTaskId: pipelineSpec.taskId,
      status,
      failedStep,
      startedAt,
      finishedAt,
      selfCheck: {
        ok: pipelineSelfCheck.ok,
        summary: pipelineSelfCheck.summary,
      },
    });

    return result;
  }

  /**
   * Step input'unu üretmek:
   * - pipeline'dan gelen inputTemplate
   * - taskSpec.details
   * - context (önceki stepler)
   */
  buildStepInput(step, taskSpec, context) {
    return {
      ...step.input,
      taskGoal: taskSpec.goal,
      taskDetails: taskSpec.details,
      contextSnapshot: { ...context },
      stepId: step.id,
      stepTitle: step.title,
      stepAgent: step.agent,
    };
  }

  /* ------------------------------------------------------------
   * STEP SELF-CHECK
   * ----------------------------------------------------------*/
  async selfCheckStep(taskSpec, pipelineSpec, step, input, output) {
    const systemPrompt = `
Sen AION'un STEP SELF-CHECK modülüsün.

Görevin:
Bir pipeline adımının çıktısının mantıklı olup olmadığını hızlıca kontrol etmek.

Kurallar:
- "ok": true/false alanı olacak.
- Eğer ok=false ise "reason" alanında kısa ve net açıklama olacak.
- Teknik doğruluğu MÜKEMMEL kontrol edemezsin ama bariz saçmalıkları yakalamaya çalış.

Örnek durumlar:
- Kod istendi, ama kod bloğu yoksa → ok=false
- Dosya path'i istendi ama output sadece "tamam" yazıyorsa → ok=false
- Çok kısa / belirsiz cevaplar ama step kritik bir iş yapıyorsa → ok=false
- Küçük stil/tarz kusurları → ok=true
`.trim();

    const userPrompt = `
Task goal:
${taskSpec.goal}

Step info:
${JSON.stringify(
  {
    id: step.id,
    title: step.title,
    agent: step.agent,
  },
  null,
  2
)}

Input:
${JSON.stringify(input, null, 2)}

Output:
${JSON.stringify(output, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);
    const parsed = this.safeParseSelfCheckStep(raw);

    return parsed;
  }

  safeParseSelfCheckStep(text) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const json = JSON.parse(text.slice(start, end + 1));

      return {
        ok: Boolean(json.ok),
        reason: json.reason || "",
      };
    } catch {
      return {
        ok: true,
        reason: "Self-check parse fallback: geçerli sayıldı.",
      };
    }
  }

  /* ------------------------------------------------------------
   * PIPELINE SELF-CHECK
   * ----------------------------------------------------------*/
  async selfCheckPipeline(
    taskSpec,
    pipelineSpec,
    context,
    logs,
    status,
    failedStep
  ) {
    const systemPrompt = `
Sen AION'un PIPELINE SELF-CHECK beynisin.

Görevin:
Bütün pipeline çalışmasının son durumunu değerlendirip kısa bir değerlendirme yapmak.

Kurallar:
- "ok": true/false
- "summary": kısa Türkçe özet
- Görev başarıyla bittiyse ok=true
- Eğer bazı adımlar hata verdiyse ama kısmi sonuç işe yarıyorsa ok=true olabilir ama summary'de dürüstçe belirt
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

PipelineSpec:
${JSON.stringify(pipelineSpec, null, 2)}

Status: ${status}
FailedStep: ${failedStep || "none"}

Context:
${JSON.stringify(context, null, 2)}

Logs:
${JSON.stringify(logs, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);
    const parsed = this.safeParseSelfCheckPipeline(raw, status);

    return parsed;
  }

  safeParseSelfCheckPipeline(text, status) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const json = JSON.parse(text.slice(start, end + 1));

      return {
        ok: typeof json.ok === "boolean" ? json.ok : status === "success",
        summary: json.summary || "",
      };
    } catch {
      return {
        ok: status === "success",
        summary: "Pipeline self-check parse fallback.",
      };
    }
  }
}
