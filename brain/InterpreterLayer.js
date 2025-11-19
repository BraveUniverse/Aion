// ===== brain/InterpreterLayer.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

export class InterpreterLayer {
  constructor() {
    this.registry = new TaskTypeRegistry();
  }

  /**
   * Mode'a göre TaskSpec karar mekanizması
   */
  async interpret(convInfo) {
    const { raw, intent, projectIdHint } = convInfo;

    // PLAN MODU → TaskSpec üretmez
    if (intent === "plan") {
      return this.noTask("Plan modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    // CHAT MODU → TaskSpec üretmez
    if (intent === "chat") {
      return this.noTask("Chat modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    // TASK veya MIXED mod → gerçek TaskSpec reasoner
    const interpreted = await this.reasonTaskSpec(raw, projectIdHint);

    // Yeni görev tipleri otomatik öğrenilir
    this.learnTypeIfNew(interpreted.type);

    // Hafıza kaydı
    appendMemory("interpreted_raw.json", {
      raw,
      interpreted,
      createdAt: new Date().toISOString(),
    });

    return interpreted;
  }

  /**
   * Yeni görev tiplerini kaydeden mekanizma
   */
  learnTypeIfNew(typeName) {
    if (!typeName) return;

    const existed = this.registry.exists(typeName);
    if (!existed) {
      this.registry.register(typeName);

      appendMemory("task_type_learning.json", {
        learnedType: typeName,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Reasoner'dan TaskSpec çıkarma
   */
  async reasonTaskSpec(message, projectIdHint) {
    const allowedTypes = this.registry.getAll().join(" | ");

    const systemPrompt = `
Sen AION'un Görev Yorumlama Beynisisin (INTERPRETER).

Görev:
Kullanıcının mesajını "TaskSpec" formatına dönüştür.

NOT:
- Aşağıdaki liste sadece mevcut görev tipleridir:
  ${allowedTypes}

Ama kullanıcı bu listede olmayan BİR TANE BİLE yeni görev tipi isterse:
- Yeni bir type oluşturabilirsin
- AION bunu otomatik öğrenecek
- Kısıtlama yok

ÇIKTI FORMAT (KESİN):
{
  "goal": "string",
  "type": "string",
  "details": {
    "...": "..."
  }
}
`.trim();

    const raw = await runReasoner(systemPrompt, message);
    const parsed = this.safeParseTaskSpec(raw);

    // ID ve meta ekle
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
        fallback: true,
      },
    };
  }

  /**
   * Plan / Chat modunda TaskSpec üretmeyen yapı
   */
  noTask(reason, raw, projectId) {
    return {
      id: `task_${Date.now()}`,
      projectId,
      goal: raw,
      type: "no_task_generated",
      details: { reason },
      createdAt: new Date().toISOString(),
    };
  }
}
