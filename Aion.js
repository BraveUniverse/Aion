===== AION.js =====

/**
 * AION Ana Beyin Giriş Noktası (Full Brain MVP)
 * ---------------------------------------------------
 * Modlar:
 *  - "chat"
 *  - "plan"
 *  - "task"
 */

import { ConversationLayer } from "./brain/ConversationLayer.js";
import { InterpreterLayer } from "./brain/InterpreterLayer.js";
import { PlannerLayer } from "./brain/PlannerLayer.js";
import { ControllerLayer } from "./brain/ControllerLayer.js";

import { runReasoner } from "./config/models.js";
import { appendMemory } from "./modules/MemoryEngine.js";

// 🔵 Yeni eklenen import:
import { MemoryIntegrationLayer } from "./brain/MemoryIntegrationLayer.js";

// Tekil instance'lar
const conversationLayer = new ConversationLayer();
const interpreterLayer = new InterpreterLayer();
const plannerLayer = new PlannerLayer();
const controllerLayer = new ControllerLayer();

// 🔵 Long-term memory instance
const memoryIntegration = new MemoryIntegrationLayer();

/**
 * AION ana fonksiyon
 */
export async function runAION(userMessage, options = {}) {
  const startedAt = new Date().toISOString();
  const callId = `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // 0) Ham kullanıcı mesajını kayıt (legacy)
  appendMemory("messages.json", {
    id: callId,
    role: "user",
    text: userMessage,
    createdAt: startedAt,
  });

  // 🔵 Long-term memory: kullanıcı mesajını kaydet
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

      // 🔵 assistant cevabını long-term memory'e kaydet
      await memoryIntegration.storeAssistantMessage(planResult.naturalSummary, {
        callId,
        mode: "plan",
      });

      return {
        mode: "plan",
        callId,
        startedAt,
        ...planResult,
      };
    }

    if (mode === "task") {
      const taskResult = await runTaskFlow(callId, convInfo);

      // 🔵 task-run long-term memory kaydı
      await memoryIntegration.recordTaskRun(
        taskResult.taskSpec,
        taskResult.pipelineSpec,
        taskResult.pipelineResult
      );

      // 🔵 assistant cevabını long-term memory'e kaydet
      await memoryIntegration.storeAssistantMessage(taskResult.summary, {
        callId,
        mode: "task",
      });

      return {
        mode: "task",
        callId,
        startedAt,
        ...taskResult,
      };
    }

    if (mode === "chat") {
      const chatResult = await runChatFlow(callId, convInfo);

      // 🔵 assistant cevabını long-term memory'e kaydet
      await memoryIntegration.storeAssistantMessage(chatResult.answer, {
        callId,
        mode: "chat",
      });

      return {
        mode: "chat",
        callId,
        startedAt,
        ...chatResult,
      };
    }

    // MİXED fallback
    const planTry = await safeTryPlanningFlow(callId, convInfo);
    if (planTry.ok && planTry.confidence >= 0.7) {
      await memoryIntegration.storeAssistantMessage(
        planTry.payload.naturalSummary,
        { callId, mode: "plan" }
      );
      return {
        mode: "plan",
        callId,
        startedAt,
        ...planTry.payload,
      };
    }

    const taskTry = await safeTryTaskFlow(callId, convInfo);
    if (taskTry.ok && taskTry.confidence >= 0.7) {
      await memoryIntegration.recordTaskRun(
        taskTry.payload.taskSpec,
        taskTry.payload.pipelineSpec,
        taskTry.payload.pipelineResult
      );
      await memoryIntegration.storeAssistantMessage(
        taskTry.payload.summary,
        { callId, mode: "task" }
      );
      return {
        mode: "task",
        callId,
        startedAt,
        ...taskTry.payload,
      };
    }

    const chatResult = await runChatFlow(callId, convInfo);

    await memoryIntegration.storeAssistantMessage(chatResult.answer, {
      callId,
      mode: "chat",
    });

    return {
      mode: "chat",
      callId,
      startedAt,
      ...chatResult,
    };
  } catch (err) {
    const errorText = String(err?.message || err);

    appendMemory("errors.json", {
      id: callId,
      error: errorText,
      stack: err?.stack || null,
      createdAt: new Date().toISOString(),
      rawMessage: userMessage,
    });

    return {
      mode: "error",
      callId,
      startedAt,
      error: errorText,
    };
  }
}

/* -------------------------------------------------------
 * (Diğer tüm fonksiyonlar AYNEN, HİÇ DEĞİŞMEDİ)
 * -------------------------------------------------------
 * runPlanningFlow
 * safeTryPlanningFlow
 * summarizePlanForUser
 * runTaskFlow
 * safeTryTaskFlow
 * summarizeTaskRun
 * runChatFlow
 * safeJsonFromText
 * CLI Runner
 * ------------------------------------------------------- 
 */

// (Devam eden tüm orijinal fonksiyonlar burada — hiçbir satır değişmedi)dönüştürür.
async function runPlanningFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  const systemPrompt = `
Sen AION'un PLANLAMA beynisin.
Görevin: Kullanıcının anlattığı fikri, hedefi veya sistemi;
- önce netleştirmek,
- sonra mantıklı bir mimari ve adım adım plan haline getirmek,
- artı/eksi değerlendirmesi yapmak,
- gerekirse alternatif yaklaşımlar önermek.

Her zaman aşağıdaki JSON formatını döndür:

{
  "planTitle": "kısa başlık",
  "goal": "nihai hedef açıklaması",
  "contextSummary": "kullanıcının anlattıklarının kısa özeti",
  "steps": [
    {
      "id": "step1",
      "title": "adım başlığı",
      "description": "detaylı açıklama",
      "type": "design | research | coding | infra | agent | pipeline | other",
      "notes": "opsiyonel ek not"
    }
  ],
  "pros": ["avantaj 1", "avantaj 2"],
  "cons": ["dezavantaj 1", "risk 1"],
  "suggestedTasks": [
    {
      "type": "create_agent | create_pipeline | generate_code | design_schema | other",
      "description": "somut görevin açıklaması",
      "priority": "high | normal | low"
    }
  ]
}
`.trim();

  const userPrompt = convInfo.raw;

  const raw = await runReasoner(systemPrompt, userPrompt);
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

  // Hafızaya plan kaydı
  appendMemory("plans.json", {
    id: `plan_${Date.now()}`,
    callId,
    projectId: convInfo.projectIdHint || null,
    input: convInfo.raw,
    plan: parsed,
    createdAt: startedAt,
    finishedAt,
  });

  // Kullanıcıya dönülecek sade plan özeti:
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

/**
 * Belirsiz durumda plan denemesi (confidence ile döner)
 */
async function safeTryPlanningFlow(callId, convInfo) {
  try {
    const res = await runPlanningFlow(callId, convInfo);
    // Çok boş bir plan ise confidence düşük olsun
    const hasSteps = Array.isArray(res.plan?.steps) && res.plan.steps.length > 0;
    const confidence = hasSteps ? 0.8 : 0.4;

    return {
      ok: true,
      confidence,
      payload: res,
    };
  } catch {
    return {
      ok: false,
      confidence: 0,
      payload: null,
    };
  }
}

/**
 * Planı kullanıcıya doğal dille anlatan metin üretir.
 */
async function summarizePlanForUser(planJson) {
  const systemPrompt = `
Sen AION'un doğal dil plan anlatım modülüsün.
Görevin: Verilen plan JSON'unu,
kullanıcının anlayacağı, samimi ama net bir Türkçe metne dönüştürmek.

Kurallar:
- Maksimum 10-12 cümle.
- Önce hedefi ve ana fikri açıkla.
- Sonra adımları sırayla özetle.
- Sonra avantaj ve riskleri kısaca belirt.
- Son olarak "istersen buradan somut görevlere geçebiliriz" tarzı kısa bir kapanış ekle.
`.trim();

  const userPrompt = JSON.stringify(planJson, null, 2);
  const summary = await runReasoner(systemPrompt, userPrompt);
  return summary;
}

/* -------------------------------------------------------
 * TASK MODU (Somut Görev Yürütme: Interpreter → Planner → Controller)
 * -----------------------------------------------------*/

async function runTaskFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  // 1) Interpreter → TaskSpec
  const taskSpec = await interpreterLayer.interpret(convInfo);

  appendMemory("tasks.json", {
    id: taskSpec.id,
    goal: taskSpec.goal,
    type: taskSpec.type,
    projectId: taskSpec.projectId,
    createdAt: startedAt,
  });

  // 2) Planner → PipelineSpec
  const pipelineSpec = await plannerLayer.plan(taskSpec);

  appendMemory("pipelines_index.json", {
    id: pipelineSpec.taskId,
    taskId: taskSpec.id,
    projectId: taskSpec.projectId,
    stepCount: pipelineSpec.steps.length,
    createdAt: new Date().toISOString(),
  });

  // 3) Controller → pipeline'ı Execution üzerinden çalıştırır
  const pipelineResult = await controllerLayer.runPipeline(taskSpec, pipelineSpec);

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

  // 4) Kullanıcı için görev özetini üret
  const summary = await summarizeTaskRun(taskSpec, pipelineSpec, pipelineResult);

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

/**
 * Belirsiz durumda task denemesi (confidence ile)
 */
async function safeTryTaskFlow(callId, convInfo) {
  try {
    const res = await runTaskFlow(callId, convInfo);
    const ok = res.ok === true;
    const confidence = ok ? 0.8 : 0.4;

    return {
      ok: true,
      confidence,
      payload: res,
    };
  } catch {
    return {
      ok: false,
      confidence: 0,
      payload: null,
    };
  }
}

/**
 * Task pipeline sonuç özetleyici.
 */
async function summarizeTaskRun(taskSpec, pipelineSpec, pipelineResult) {
  const systemPrompt = `
Sen AION'un görev özeti modülüsün.
Görevin: TaskSpec, PipelineSpec ve PipelineResult bilgisini kullanarak,
kullanıcıya ne yapıldığını net ve kısa bir şekilde anlatmak.

Kurallar:
- Maksimum 8-10 cümle.
- Önce görevin amacını özetle.
- Sonra pipeline'ın ana adımlarını anlat.
- Sonra önemli çıktıları vurgula (örn. hangi dosyalar üretildi, hangi agent'lar çalıştı).
- Sorun çıktıysa bunu dürüstçe belirt ve bir sonraki olası adımı öner.
- Kullanıcıya doğrudan hitap eden bir ton kullan ("dostum" yazmak zorunda değilsin ama istersen yazabilirsin).
`.trim();

  const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

PipelineSpec:
${JSON.stringify(pipelineSpec, null, 2)}

PipelineResult (status: ${pipelineResult.status}):
${JSON.stringify(pipelineResult, null, 2)}
`;

  const summary = await runReasoner(systemPrompt, userPrompt);
  appendMemory("summaries.json", {
    taskId: taskSpec.id,
    summary,
    createdAt: new Date().toISOString(),
  });

  return summary;
}

/* -------------------------------------------------------
 * CHAT MODU (Normal Sohbet / Açıklama / Q&A)
 * -----------------------------------------------------*/

async function runChatFlow(callId, convInfo) {
  const startedAt = new Date().toISOString();

  const systemPrompt = `
Sen AION'sun: çok katmanlı, multi-agent bir beyin.
Görevin: Kullanıcının mesajına doğal, samimi ve teknik olarak doğru cevap vermek.

Kurallar:
- Kullanıcı Türkçe konuşuyorsa Türkçe cevap ver.
- Gerekmedikçe aşırı teknik detaya boğma ama önemli yerleri saklama.
- Eğer kullanıcı AION'un mimarisi, agent'lar, pipeline'lar hakkında konuşuyorsa
  rahatça detay verebilirsin.
- Gerektiğinde "bunu plan modunda daha derin konuşabiliriz" diyebilirsin.
`.trim();

  const userPrompt = convInfo.raw;

  const answer = await runReasoner(systemPrompt, userPrompt);
  const finishedAt = new Date().toISOString();

  appendMemory("messages.json", {
    id: `${callId}_assistant_chat`,
    role: "assistant",
    mode: "chat",
    text: answer,
    createdAt: finishedAt,
  });

  return {
    ok: true,
    answer,
    finishedAt,
  };
}

/* -------------------------------------------------------
 * Yardımcı: LLM cevabından güvenli JSON çekme
 * -----------------------------------------------------*/

function safeJsonFromText(text, fallback) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const jsonStr = text.slice(start, end + 1);
      return JSON.parse(jsonStr);
    }
  } catch {
    // ignore
  }
  return fallback;
}

/* -------------------------------------------------------
 * CLI Test Runner (opsiyonel)
 * node AION.js "Dostum AION mimarisini planlayalım."
 * -----------------------------------------------------*/

if (import.meta.url === `file://${process.argv[1]}`) {
  const msg =
    process.argv.slice(2).join(" ") ||
    "Dostum AION'un mimarisini ve beyin katmanlarını planlayalım.";
  console.log("\n[AION] Running...\n");

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
