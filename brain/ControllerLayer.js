// ===== brain/ControllerLayer.js =====

import { reasonerManager } from "../engine/ReasonerManager.js";
import { ExecutionEngine } from "../engine/ExecutionEngine.js";
import { appendMemory } from "../modules/MemoryEngine.js";
import { ReasoningCompression } from "../modules/ReasoningCompression.js";

export class ControllerLayer {
  constructor() {
    this.executionEngine = new ExecutionEngine();
    this.compressor = new ReasoningCompression(2000);
  }

  async runPipeline(taskSpec, pipelineSpec) {
    const startedAt = new Date().toISOString();

    const context = {};
    const logs = [];
    let status = "running";
    let failedStep = null;

    // -----------------------------------------
    // 1) STEPLERI SIRAYLA ÇALIŞTIR
    // -----------------------------------------
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

          const output = await this.executionEngine.runAgent(
            step.agent,
            input,
            context
          );

          attemptLog.rawOutput = output;

          const selfCheck = await this.selfCheckStep(
            taskSpec,
            pipelineSpec,
            step,
            input,
            output
          );

          attemptLog.selfCheck = selfCheck;

          if (!selfCheck.ok && attempt < maxRetry) {
            attemptLog.result = "selfcheck_failed_retrying";
          } else if (!selfCheck.ok && attempt >= maxRetry) {
            attemptLog.result = "selfcheck_failed_giveup";
            lastOutput = output;
            lastError = new Error("Self-check başarısız.");
          } else {
            success = true;
            lastOutput = output;
            attemptLog.result = "success";
          }
        } catch (err) {
          lastError = err;
          attemptLog.error = String(err?.message || err);
          attemptLog.result =
            attempt < maxRetry ? "error_retrying" : "error_giveup";
        }

        attemptLog.finishedAt = new Date().toISOString();
        stepLog.attempts.push(attemptLog);

        if (success) break;
      }

      stepLog.finishedAt = new Date().toISOString();
      stepLog.success = success;
      logs.push(stepLog);

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

    if (status !== "error") status = "success";

    // -----------------------------------------
    // 2) PIPELINE SELF-CHECK
    // -----------------------------------------
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

    // -----------------------------------------
    // 3) PIPELINE MEMORY AGENT
    // -----------------------------------------
    try {
      await this.executionEngine.runAgent(
        "MemoryPipelineAgent",
        {
          pipeline: result,
          taskSpec,
        },
        context
      );
    } catch (err) {
      appendMemory("memory_pipeline_errors.json", {
        error: String(err),
        taskId: taskSpec.id,
        createdAt: new Date().toISOString(),
      });
    }

    // -----------------------------------------
    // 4) LOG KAYDI
    // -----------------------------------------
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

  /* -------------------------------------------------------
   * STEP SELF-CHECK
   * -----------------------------------------------------*/
  async selfCheckStep(taskSpec, pipelineSpec, step, input, output) {
    const systemPrompt = `
Sen AION'un STEP SELF-CHECK modülüsün.
Kurallar:
- ok: boolean
- reason: kısa açıklama
`;

    const userPrompt = `
Task goal:
${taskSpec.goal}

Step:
${JSON.stringify(step, null, 2)}

Input:
${JSON.stringify(input, null, 2)}

Output:
${JSON.stringify(output, null, 2)}
`;

    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt,
      mode: "step_selfcheck",
      temperature: 0.0,
      maxTokens: 750,
    });

    const cleaned = await this.compressor.compressIfLong(raw, {
      kind: "log",
      maxCharsOverride: 1500,
    });

    return this.safeParseSelfCheckStep(cleaned);
  }

  safeParseSelfCheckStep(text) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const json = JSON.parse(text.slice(start, end + 1));
      return { ok: Boolean(json.ok), reason: json.reason || "" };
    } catch {
      return { ok: true, reason: "parse fallback" };
    }
  }

  /* -------------------------------------------------------
   * PIPELINE SELF-CHECK
   * -----------------------------------------------------*/
  async selfCheckPipeline(taskSpec, pipelineSpec, context, logs, status, failedStep) {
    const systemPrompt = `
Sen AION'un PIPELINE SELF-CHECK beynisin.
Kurallar:
- ok: boolean
- summary: kısa açıklama
`;

    const userPrompt = `
Task:
${JSON.stringify(taskSpec, null, 2)}

Pipeline:
${JSON.stringify(pipelineSpec, null, 2)}

Status: ${status}
FailedStep: ${failedStep}

Context:
${JSON.stringify(context, null, 2)}

Logs:
${JSON.stringify(logs, null, 2)}
`;

    const raw = await reasonerManager.run({
      systemPrompt,
      userPrompt,
      mode: "pipeline_selfcheck",
      temperature: 0.1,
      maxTokens: 1000,
    });

    const cleaned = await this.compressor.compressIfLong(raw, {
      kind: "summary",
      maxCharsOverride: 2000,
    });

    return this.safeParseSelfCheckPipeline(cleaned, status);
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
        summary: "self-check fallback",
      };
    }
  }
}
