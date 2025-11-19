// ===== brain/InterpreterLayer.js =====

import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

// ★ Yeni eklenen gelişmiş modüller:
import { ToolArbitration } from "../modules/ToolArbitration.js";
import { ReasoningCompression } from "../modules/ReasoningCompression.js";

export class InterpreterLayer {
  constructor() {
    this.registry = new TaskTypeRegistry();
    this.toolArbiter = new ToolArbitration();            // ★ agent seçimi
    this.compressor = new ReasoningCompression(2000);    // ★ reasoning kısaltma
  }

  /**
   * Mode'a göre TaskSpec karar mekanizması
   */
  async interpret(convInfo) {
    const { raw, intent, projectIdHint, relevancy } = convInfo;

    // PLAN MODU → TaskSpec üretmez
    if (intent === "plan") {
      return this.noTask("Plan modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    // CHAT MODU → TaskSpec üretmez
    if (intent === "chat") {
      return this.noTask("Chat modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    // TASK veya MIXED mod → reasoner ile TaskSpec çıkar
    const interpreted = await this.reasonTaskSpec(raw, projectIdHint);

    // Yeni görev tiplerini kaydet
    this.learnTypeIfNew(interpreted.type);

    // ★ ToolArbitration: hangi agent çalışacak?
    const agentDecision = await this.toolArbiter.decide(
      interpreted,
      [], // availableAgents boş → defaultAgents
      {
        messageType: relevancy?.messageType,
        suggestedMode: relevancy?.suggestedMode,
      }
    );

    interpreted.agent = agentDecision.primary;
    interpreted.agentDecision = agentDecision;

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

Ama kullanıcı yeni bir görev tipi isterse yeni bir "type" oluştur.
AION bunu otomatik öğrenecek.

ÇIKTI FORMAT:
{
  "goal": "string",
  "type": "string",
  "details": { "...": "..." }
}
`.trim();

    const rawOutput = await runReasoner(systemPrompt, message);

    // ★ ReasoningCompression — output’u temizle
    const cleaned = await this.compressor.compressIfLong(rawOutput, {
      kind: "reasoning",
      maxCharsOverride: 1800,
      taskSpec: null,
    });

    const parsed = this.safeParseTaskSpec(cleaned);

    // Meta ekle
    parsed.id = `task_${Date.now()}`;
    parsed.projectId = projectIdHint || null;
    parsed.createdAt = new Date().toISOString();

    return parsed;
  }

  safeParseTaskSpec(text) {
    try {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s >= 0 && e > s) {
        return JSON.parse(text.slice(s, e + 1));
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
      agent: null,
      details: { reason },
      createdAt: new Date().toISOString(),
    };
  }
}
