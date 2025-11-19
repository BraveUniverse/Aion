// ===== config/models.js =====

import fetch from "node-fetch";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * Model provider ayarları
 * -------------------------------------------------------
 * Cloud (DeepSeek) ve Local modeller için router.
 *
 * AION’un bütün “runReasoner”, “runChat”, “runCoder” çağrıları buradan geçer.
 *
 * Desteklenen kaynaklar:
 *  - DeepSeek API
 *  - Local Ollama (http://localhost:11434)
 *  - Local LM Studio (http://127.0.0.1:1234/v1)
 *
 * Router mantığı:
 *  - runReasoner → DeepSeek R1 (varsayılan)
 *  - runChat → Local Qwen (varsayılan)
 *  - runCoder → Local Qwen-Coder (varsayılan)
 *  Eğer local hata verirse otomatik Cloud fallback.
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const USE_OLLAMA = true;        // M4 için local inference önerilir
const OLLAMA_URL = "http://localhost:11434/api/generate";

const LMSTUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions";

/* ------------------------------------------------------------
 * MODEL KULLANIM PROFİLLERİ
 * ------------------------------------------------------------ */

// Reasoning (derin planlama)
const CLOUD_REASONING_MODEL = "deepseek-reasoner";     // DeepSeek R1
const LOCAL_REASONING_MODEL = "qwen2.5-7b-instruct";    // Sen hangisini kurduysan

// Chat (diyalog)
const LOCAL_CHAT_MODEL = "qwen2.5-1.5b-chat";

// Coding
const LOCAL_CODER_MODEL = "qwen2.5-coder-1.5b-instruct";

/* ------------------------------------------------------------
 * DEEPSEEK CLOUD API (R1 / Chat / Reasoning)
 * ------------------------------------------------------------ */

async function callDeepSeek(model, systemPrompt, userPrompt) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key girilmemiş. DEEPSEEK_API_KEY env olarak gir.");
  }

  const url = "https://api.deepseek.com/v1/chat/completions";

  const body = {
    model,
    messages: [
      systemPrompt ? { role: "system", content: systemPrompt } : null,
      { role: "user", content: userPrompt },
    ].filter(Boolean),
    stream: false,
    max_tokens: 2048,
    temperature: 0.2,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!json || !json.choices || !json.choices[0]) {
    throw new Error("DeepSeek API geçersiz yanıt.");
  }

  return json.choices[0].message.content;
}

/* ------------------------------------------------------------
 * LOCAL MODELLER (OLLAMA)
 * ------------------------------------------------------------ */

async function callOllama(model, prompt) {
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: 4096,
    },
  };

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!json || !json.response) {
    throw new Error("Ollama response hatalı.");
  }

  return json.response;
}

/* ------------------------------------------------------------
 * LOCAL MODELLER (LM Studio)
 * ------------------------------------------------------------ */

async function callLMStudio(model, systemPrompt, userPrompt) {
  const body = {
    model,
    messages: [
      systemPrompt ? { role: "system", content: systemPrompt } : null,
      { role: "user", content: userPrompt },
    ].filter(Boolean),
    max_tokens: 4096,
    temperature: 0.2,
    stream: false,
  };

  const res = await fetch(LMSTUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

/* ------------------------------------------------------------
 * Router Fonksiyonları
 * ------------------------------------------------------------ */

/**
 * runReasoner
 * ------------------------------------------------------------
 * - Derin planlama işlerinde kullanılır
 * - Varsayılan: cloud → DeepSeek R1
 * - Eğer cloud kapalıysa local reasoning modeli
 */
export async function runReasoner(systemPrompt, userPrompt) {
  try {
    if (DEEPSEEK_API_KEY) {
      return await callDeepSeek(CLOUD_REASONING_MODEL, systemPrompt, userPrompt);
    }

    if (USE_OLLAMA) {
      return await callOllama(LOCAL_REASONING_MODEL, `${systemPrompt}\n\n${userPrompt}`);
    }

    return await callLMStudio(LOCAL_REASONING_MODEL, systemPrompt, userPrompt);
  } catch (err) {
    appendMemory("model_errors.json", {
      model: "reasoner",
      error: String(err?.message || err),
      ts: new Date().toISOString(),
    });

    // fallback → local chat modeli
    try {
      return await callOllama(LOCAL_CHAT_MODEL, `${systemPrompt}\n\n${userPrompt}`);
    } catch (e2) {
      return "ERROR: Reasoner fallback da başarısız.";
    }
  }
}

/**
 * runChat
 * ------------------------------------------------------------
 * - Normal diyalog veya hafif işler
 */
export async function runChat(systemPrompt, userPrompt) {
  try {
    if (USE_OLLAMA) {
      return await callOllama(LOCAL_CHAT_MODEL, `${systemPrompt}\n\n${userPrompt}`);
    }

    return await callLMStudio(LOCAL_CHAT_MODEL, systemPrompt, userPrompt);
  } catch (err) {
    return await callDeepSeek("deepseek-chat", systemPrompt, userPrompt);
  }
}

/**
 * runCoder
 * ------------------------------------------------------------
 * - Kod üretmek, refactor vb.
 * - Local Qwen-Coder varsayılan
 */
export async function runCoder(systemPrompt, userPrompt) {
  try {
    return await callOllama(LOCAL_CODER_MODEL, `${systemPrompt}\n\n${userPrompt}`);
  } catch (err) {
    // fallback → deepseek code-like davranış
    return await callDeepSeek("deepseek-chat", systemPrompt, userPrompt);
  }
}
