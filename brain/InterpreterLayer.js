// ===== brain/InterpreterLayer.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * InterpreterLayer
 * -------------------------------------------------------
 * Görevi: Kullanıcı mesajından "TaskSpec" çıkarmak.
 *
 * Kurallar:
 * - Eğer mod "plan" ise ASLA TaskSpec üretmez → sadece plan aşamasıdır.
 * - Eğer mod "task" ise TaskSpec ZORUNLU olarak üretilir.
 * - Eğer mod "mixed" ise niyet analiz edilir → task uygunsa TaskSpec üretir.
 * - TaskSpec JSON'u strict formatta döner:
 *
 *   {
 *      "id": "task_827364",
 *      "projectId": "xyz" | null,
 *      "goal": "kullanıcının amacı",
 *      "type": "create_agent | create_pipeline | generate_code | modify_file | research | write_doc | other",
 *      "details": {... SERBEST ...},
 *      "createdAt": "timestamp"
 *   }
 *
 */

export class InterpreterLayer {
  constructor() {}

  /**
   * TaskSpec çıkarma fonksiyonu.
   * @param {object} convInfo - ConversationLayer çıktısı
   */
  async interpret(convInfo) {
    const { raw, intent, projectIdHint } = convInfo;

    // MODE GUARD: plan modunda TaskSpec ÜRETME
    if (intent === "plan") {
      return {
        id: `task_${Date.now()}`,
        projectId: projectIdHint || null,
        goal: raw,
        type: "no_task_generated",
        details: {
          reason:
            "Plan modunda TaskSpec üretilmez. Önce plan tamamlanmalı, sonra görev başlar.",
        },
        createdAt: new Date().toISOString(),
      };
    }

    // MODE GUARD: chat modunda task üretme
    if (intent === "chat") {
      return {
        id: `task_${Date.now()}`,
        projectId: projectIdHint || null,
        goal: raw,
        type: "no_task_generated",
        details: {
          reason:
            "Chat modunda TaskSpec üretilmez. Bu mesaj bir görev içermiyor.",
        },
        createdAt: new Date().toISOString(),
      };
    }

    // BURAYA GELDİYSE intent = task veya mixed → derin Reasoner gerekiyor
    const interpreted = await this.reasonTaskSpec(raw, projectIdHint);

    // Hafızaya kayıt
    appendMemory("interpreted_raw.json", {
      raw,
      interpreted,
      createdAt: new Date().toISOString(),
    });

    return interpreted;
  }

  /* ------------------------------------------------------------
   * TaskSpec Reasoning (DeepSeek)
   * ----------------------------------------------------------*/
  async reasonTaskSpec(message, projectIdHint) {
    const systemPrompt = `
Sen AION'un Görev Yoruma Beyni (INTERPRETER)'sın.

Görevin:
Kullanıcının mesajını inceleyip temiz bir "TaskSpec" çıkarmaktır.

Kesin kurallar:
- Kullanıcı ne istiyorsa onu hedef olarak yaz (goal).
- "type" alanı somut işi belirtir:
  - create_agent   → yeni agent oluşturma
  - create_pipeline → pipeline oluşturma
  - generate_code   → kod üretme
  - modify_file     → var olan dosyada değişiklik yapma
  - write_doc       → teknik döküman oluşturma
  - research        → araştırma yapma
  - data_process    → veri üzerinde işlem yapma
  - other           → diğer işler
- Details alanına AION'un işine yarayacak tüm ekstra bilgileri koy.
- Çıkış MUTLAKA pure JSON olacak.

FORMAT:
{
  "goal": "string",
  "type": "create_agent | create_pipeline | generate_code | modify_file | write_doc | research | data_process | other",
  "details": {
    "model": "...",
    "files": ["..."],
    "path": "...",
    "inputs": "kullanıcının verdiği teknik istekler",
    "notes": "opsiyonel"
  }
}
`.trim();

    const raw = await runReasoner(systemPrompt, message);
    const parsed = this.safeParseTaskSpec(raw);

    // TaskSpec id ekle
    parsed.id = `task_${Date.now()}`;
    parsed.projectId = projectIdHint || null;
    parsed.createdAt = new Date().toISOString();

    return parsed;
  }

  safeParseTaskSpec(text) {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
    } catch (e) {
      console.error("TaskSpec parse error:", e);
    }

    // fallback
    return {
      goal: text,
      type: "other",
      details: {
        notes: "Interpreter JSON parse fallback çalıştı.",
      },
    };
  }
}
