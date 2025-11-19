// ===== config/models.js =====

import fetch from "node-fetch";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * AION Model Router (DeepSeek R1 + Local Qwen)
 * -------------------------------------------------------
 * • Reasoning   → DeepSeek R1 (cloud)
 * • Chat        → Qwen2.5 1.5B Chat (local)
 * • Coding      → Qwen2.5 1.5B Coder (local)
 *
 * Amaç:
 *  - M4 Air için maksimum hız
 *  - Minimum memory load
 *  - Zero-crash stable fallback
 *  - ReasonerManager ile %100 uyum
 */

// ======================================================
// ENV
// ======================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";

// ======================================================
// LOCAL MODEL AYARLARI
// ======================================================
const OLLAMA_ENABLED = true;
const OLLAMA_URL = "http://localhost:11434/api/generate";

// Chat modeli (ultra hızlı)
const LOCAL_CHAT_MODEL = "qwen2.5-1.5b-chat";

// Kod üretimi için (hız + kalite dengesi)
const LOCAL_CODER_MODEL = "qwen2.5-coder-1.5b-instruct";

// Reasoning cloud modeli
const CLOUD_REASONING_MODEL = "deepseek-reasoner";

// ======================================================
// DEEPSEEK CLOUD CALLER
// ======================================================
async function callDeepSeek(systemPrompt, userPrompt) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY .env dosyasına girilmemiş.");
  }

  const url = "https://api.deepseek.com/v1/chat/completions";

  const body = {
    model: CLOUD_REASONING_MODEL,
    messages: [
      systemPrompt ? { role: "system", content: systemPrompt } : null,
      { role: "user", content: userPrompt }
    ].filter(Boolean),
    max_tokens: 4096,
    temperature: 0.2,
    stream: false
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await res.json();

  if (!json?.choices?.[0]?.message?.content) {
    throw new Error("DeepSeek API yanıtı geçersiz.");
  }

  return json.choices[0].message.content;
}

// ======================================================
// OLLAMA CALLER
// ======================================================
async function callOllama(model, prompt) {
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.2,
      num_ctx: 4096
    }
  };

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await res.json();

  if (!json || !json.response) {
    throw new Error("Ollama local model yanıtı hatalı.");
  }

  return json.response;
}

// ======================================================
// MODEL ROUTERS
// ======================================================

/**
 * runReasoner → DeepSeek R1 (her zaman cloud)
 */
export async function runReasoner(systemPrompt, userPrompt) {
  try {
    return await callDeepSeek(systemPrompt, userPrompt);
  } catch (err) {
    appendMemory("model_errors.json", {
      model: "reasoner",
      error: String(err),
      ts: new Date().toISOString()
    });
    return "ERROR: DeepSeek R1 çağrısı başarısız.";
  }
}

/**
 * runChat → Local Qwen chat
 */
export async function runChat(systemPrompt, userPrompt) {
  try {
    if (OLLAMA_ENABLED) {
      return await callOllama(
        LOCAL_CHAT_MODEL,
        `${systemPrompt}\n\n${userPrompt}`
      );
    }
    return "Local chat modeli devre dışı.";
  } catch (err) {
    appendMemory("model_errors.json", {
      model: "chat",
      error: String(err)
    });
    return "Chat modeli çalışmadı.";
  }
}

/**
 * runCoder → Local Qwen coder
 */
export async function runCoder(systemPrompt, userPrompt) {
  try {
    return await callOllama(
      LOCAL_CODER_MODEL,
      `${systemPrompt}\n\n${userPrompt}`
    );
  } catch (err) {
    appendMemory("model_errors.json", {
      model: "coder",
      error: String(err)
    });
    return "Coder modeli çalışmadı.";
  }
}
