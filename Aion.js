// ===== AION.js =====

/**
 * AION Ana Beyin Giriş Noktası (NEW FULL VERSION)
 * ---------------------------------------------------
 * Modlar:
 *  - "chat"
 *  - "plan"
 *  - "task"
 *
 * Tüm LLM çağrıları artık ReasonerManager üzerinden geçer:
 *    reasonerManager.call({ systemPrompt, userPrompt, ... })
 *
 * Böylece:
 *  - Hybrid Memory
 *  - Semantic Memory
 *  - Relevancy Engine
 *  - Long-term Memory
 *  - Reasoning Compression
 * otomatik olarak devrede.
 */

import { ConversationLayer } from "./brain/ConversationLayer.js";
import { InterpreterLayer } from "./brain/InterpreterLayer.js";
import { PlannerLayer } from "./brain/PlannerLayer.js";
import { ControllerLayer } from "./brain/ControllerLayer.js";

import { appendMemory } from "./modules/MemoryEngine.js";
import { MemoryIntegrationLayer } from "./brain/MemoryIntegrationLayer.js";

// 🔵 Yeni AION Reasoner
import { reasonerManager } from "./modules/ReasonerManager.js";

// Tekil instance'lar
const conversationLayer = new ConversationLayer();
const interpreterLayer = new InterpreterLayer();
const plannerLayer = new PlannerLayer();
const controllerLayer = new ControllerLayer();
const memoryIntegration = new MemoryIntegrationLayer();

/**
 * AION ana fonksiyon
 */
export async function runAION(userMessage, options = {}) {
  const startedAt = new Date().toISOString();
  const callId = `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // 0) Ham kullanıcı mesajını kaydet (legacy)
  appendMemory("messages.json", {
    id: callId,
    role: "user",
    text: userMessage,
    createdAt: startedAt,
  });

  // 🔵 Long-term memory → kullanıcı mesajını hafızaya at
  await memoryIntegration.storeUserMessage(userMessage, { callId });

  try {
    // 1) ConversationLayer → intent
    const convInfo = await conversationLayer.processUserMessage(
      userMessage,
      options
    );

    const modeHint = options.forceMode || null;
    const intent = convInfo.intent || "mixed";

    const mode =
      modeHint ||
      (convInfo.isPlan && "plan") ||
      (convInfo.isTask && "task") ||
      (convInfo.isChat && "chat") ||
      intent;

    if (mode === "plan") {
      const planResult = await runPlanningFlow(callId, convInfo);

      await memoryIntegration.storeAssistantMessage(planResult.naturalSummary, {
        callId,
        mode: "plan",
      });

      return { mode: "plan", callId, startedAt, ...planResult };
    }

    if (mode === "task") {
      const taskResult = await runTaskFlow(callId, convInfo);

      await memoryIntegration.recordTaskRun(
        taskResult.taskSpec,
        taskResult.pipelineSpec,
        taskResult.pipelineResult
      );

      await memoryIntegration.storeAssistantMessage(taskResult.summary, {
        callId,
        mode: "task",
      });

      return { mode: "task", callId, startedAt, ...taskResult };
    }

    if (mode === "chat") {
      const chatResult = await runChatFlow(callId, convInfo);

      await memoryIntegration.storeAssistantMessage(chatResult.answer, {
        callId,
        mode: "chat",
      });

      return { mode: "chat", callId, startedAt, ...chatResult };
    }

    // MİXED fallback
    const planTry = await safeTryPlanningFlow(callId, convInfo);
    if (planTry.ok && planTry.confidence >= 0.7) {
      await memoryIntegration.storeAssistantMessage(
        planTry.payload.naturalSummary,
        { callId, mode: "plan" }
      );
      return { mode: "plan", callId, startedAt, ...planTry.payload };
    }

    const taskTry = await safeTryTaskFlow(callId, convInfo);
    if (taskTry.ok && taskTry.confidence >= 0.7) {
      await memoryIntegration.recordTaskRun(
        taskTry.payload.taskSpec,
        taskTry.payload.pipelineSpec,
        taskTry.payload.pipelineResult
      );
      await memoryIntegration.storeAssistantMessage(taskTry.payload.summary, {
        callId,
        mode: "task",
      });

      return { mode: "task", callId, startedAt, ...taskTry.payload };
    }

    const chatResult = await runChatFlow(callId, convInfo);
    await memoryIntegration.storeAssistantMessage(chatResult.answer, {
      callId,
      mode: "chat",
    });

    return { mode: "chat", callId, startedAt, ...chatResult };
  } catch (err) {
    const errorText = String(err?.message || err);

    appendMemory("errors.json", {
      id: callId,
      error: errorText,
      stack: err?.stack || null,
      createdAt: new Date().toISOString(),
      rawMessage: userMessage,
    });

    return { mode: "error", callId, startedAt, error: errorText };
  }
}

/* -------------------------------------------------------
 * PLAN MODU
 * ------------------------------------------------------*/
async function runPlanningFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  const systemPrompt = `
Sen AION'un PLANLAMA beynisin.
Görevin: Kullanıcının fikrini düzgün bir plana çevir.
JSON formatında döndür.
  `.trim();

  const userPrompt = convInfo.raw;

  const { text: raw } = await reasonerManager.call({
    systemPrompt,
    userPrompt,
    mode: "plan",
    convInfo,
  });

  const parsed = safeJsonFromText(raw, {
    planTitle: "Genel Plan",
    goal: userPrompt,
    contextSummary: userPrompt,
    steps: [],
    pros: [],
    cons: [],
    suggestedTasks: [],
  });

  const finishedAt = new Date().toISOString();

  appendMemory("plans.json", {
    id: `plan_${Date.now()}`,
    callId,
    projectId: convInfo.projectIdHint || null,
    input: convInfo.raw,
    plan: parsed,
    createdAt: startedAt,
    finishedAt,
  });

  const naturalSummary = await summarizePlanForUser(parsed);

  appendMemory("messages.json", {
    id: `${callId}_assistant_plan`,
    role: "assistant",
    mode: "plan",
    text: naturalSummary,
    createdAt: finishedAt,
  });

  return {
    ok: true,
    plan: parsed,
    naturalSummary,
    finishedAt,
  };
}

/* -------------------------------------------------------
 * SAFE TRY PLAN
 * ------------------------------------------------------*/
async function safeTryPlanningFlow(callId, convInfo) {
  try {
    const res = await runPlanningFlow(callId, convInfo);
    const hasSteps =
      Array.isArray(res.plan?.steps) && res.plan.steps.length > 0;
    const confidence = hasSteps ? 0.8 : 0.4;

    return { ok: true, confidence, payload: res };
  } catch {
    return { ok: false, confidence: 0, payload: null };
  }
}

/* -------------------------------------------------------
 * PLAN ÖZETİ
 * ------------------------------------------------------*/
async function summarizePlanForUser(planJson) {
  const systemPrompt = `
Sen AION'un plan özetleme modülüsün.
Kısa ve net Türkçe özet üret.
  `.trim();

  const userPrompt = JSON.stringify(planJson, null, 2);

  const { text } = await reasonerManager.call({
    systemPrompt,
    userPrompt,
    mode: "plan",
  });

  return text;
}

/* -------------------------------------------------------
 * TASK MODU
 * ------------------------------------------------------*/
async function runTaskFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  const taskSpec = await interpreterLayer.interpret(convInfo);

  appendMemory("tasks.json", {
    id: taskSpec.id,
    goal: taskSpec.goal,
    type: taskSpec.type,
    projectId: taskSpec.projectId,
    createdAt: startedAt,
  });

  const pipelineSpec = await plannerLayer.plan(taskSpec);

  appendMemory("pipelines_index.json", {
    id: pipelineSpec.taskId,
    taskId: taskSpec.id,
    projectId: taskSpec.projectId,
    stepCount: pipelineSpec.steps.length,
    createdAt: new Date().toISOString(),
  });

  const pipelineResult = await controllerLayer.runPipeline(
    taskSpec,
    pipelineSpec
  );

  const finishedAt = new Date().toISOString();

  appendMemory("completed_runs.json", {
    callId,
    taskId: taskSpec.id,
    taskType: taskSpec.type,
    pipelineTaskId: pipelineSpec.taskId,
    status: pipelineResult.status,
    contextKeys: Object.keys(pipelineResult.context || {}),
    createdAt: startedAt,
    finishedAt,
  });

  const summary = await summarizeTaskRun(
    taskSpec,
    pipelineSpec,
    pipelineResult
  );

  appendMemory("messages.json", {
    id: `${callId}_assistant_task`,
    role: "assistant",
    mode: "task",
    text: summary,
    createdAt: finishedAt,
  });

  const ok =
    pipelineResult.status === "done" ||
    pipelineResult.status === "success";

  return {
    ok,
    taskSpec,
    pipelineSpec,
    pipelineResult,
    summary,
    finishedAt,
  };
}

/* -------------------------------------------------------
 * SAFE TRY TASK
 * ------------------------------------------------------*/
async function safeTryTaskFlow(callId, convInfo) {
  try {
    const res = await runTaskFlow(callId, convInfo);
    const ok = res.ok === true;
    const confidence = ok ? 0.8 : 0.4;
    return { ok: true, confidence, payload: res };
  } catch {
    return { ok: false, confidence: 0, payload: null };
  }
}

/* -------------------------------------------------------
 * TASK ÖZETLEYİCİ
 * ------------------------------------------------------*/
async function summarizeTaskRun(taskSpec, pipelineSpec, pipelineResult) {
  const systemPrompt = `
Sen AION'un görev özeti modülüsün.
Görevi kısa bir özetle anlat.
  `.trim();

  const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

PipelineSpec:
${JSON.stringify(pipelineSpec, null, 2)}

PipelineResult:
${JSON.stringify(pipelineResult, null, 2)}
`;

  const { text } = await reasonerManager.call({
    systemPrompt,
    userPrompt,
    mode: "task",
  });

  appendMemory("summaries.json", {
    taskId: taskSpec.id,
    summary: text,
    createdAt: new Date().toISOString(),
  });

  return text;
}

/* -------------------------------------------------------
 * CHAT MODU
 * ------------------------------------------------------*/
async function runChatFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  const systemPrompt = `
Sen AION'sun — çok katmanlı bir multi-agent beyin.
Türkçe konuşan kullanıcıya doğal cevap ver.
  `.trim();

  const userPrompt = convInfo.raw;

  const { text: answer } = await reasonerManager.call({
    systemPrompt,
    userPrompt,
    mode: "chat",
    convInfo,
  });

  const finishedAt = new Date().toISOString();

  appendMemory("messages.json", {
    id: `${callId}_assistant_chat`,
    role: "assistant",
    mode: "chat",
    text: answer,
    createdAt: finishedAt,
  });

  return { ok: true, answer, finishedAt };
}

/* -------------------------------------------------------
 * SAFELY PARSE JSON
 * ------------------------------------------------------*/
function safeJsonFromText(text, fallback) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch {}
  return fallback;
}

/* -------------------------------------------------------
 * CLI RUNNER
 * ------------------------------------------------------*/
if (import.meta.url === `file://${process.argv[1]}`) {
  const msg =
    process.argv.slice(2).join(" ") ||
    "Dostum AION'un mimarisini planlayalım.";
  console.log("\n[AION RUNNING]\n");

  runAION(msg)
    .then((out) => {
      console.log("\n[AION OUTPUT]\n");
      console.dir(out, { depth: null });
      process.exit(0);
    })
    .catch((e) => {
      console.error("\n[AION ERROR]\n", e);
      process.exit(1);
    });
}
