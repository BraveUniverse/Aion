// ===== brain/InterpreterLayer.js =====

import { reasonerManager } from "../engine/ReasonerManager.js";
import { appendMemory } from "../modules/MemoryEngine.js";
import { TaskTypeRegistry } from "../modules/TaskTypeRegistry.js";

// ★ Yeni modüller
import { ToolArbitration } from "../modules/ToolArbitration.js";
import { ReasoningCompression } from "../modules/ReasoningCompression.js";

export class InterpreterLayer {
  constructor() {
    this.registry = new TaskTypeRegistry();
    this.toolArbiter = new ToolArbitration();
    this.compressor = new ReasoningCompression(2000);
  }

  /**
   * Mode'a göre TaskSpec karar mekanizması
   */
  async interpret(convInfo) {
    const { raw, intent, projectIdHint, relevancy } = convInfo;

    if (intent === "plan") {
      return this.noTask("Plan modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    if (intent === "chat") {
      return this.noTask("Chat modunda TaskSpec üretilmez.", raw, projectIdHint);
    }

    // 🔥 TASK → LLM ile TaskSpec üret
    const interpreted = await this.reasonTaskSpec(raw, projectIdHint);

    // Yeni görev tipi öğren
    this.learnTypeIfNew(interpreted.type);

    // ★ Agent belirleme
    const agentDecision = await this.toolArbiter.decide(
      interpreted,
      [],
      {
        messageType: relevancy?.messageType,
        suggestedMode: relevancy?.suggestedMode,
      }
    );

    interpreted.agent = agentDecision.primary;
    interpreted.agentDecision = agentDecision;

    // Hafızaya yaz
    appendMemory("interpreted_raw.json", {
      raw,
      interpreted,
      createdAt: new Date().toISOString(),
    });

    return interpreted;
  }

  /**
   * Yeni görev tiplerini öğrenen mekanizma
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
   * ★ ReasonerManager ile TaskSpec çıkarma
   */
  async reasonTaskSpec(message, projectIdHint) {
    const allowedTypes = this.registry.getAll().join(" | ");

    const systemPrompt = `
Sen AION'un Görev Yorumlama Beynisisin (INTERPRETER).

Görev:
Kullanıcının mesajını "TaskSpec" formatında çıkar.

NOT:
- Mevcut görev tipleri:
  ${allowedTypes}

Ama kullanıcı yeni bir görev isterse yeni bir "type" oluştur.
AION bunu otomatik öğrenecek.

JSON formatı:
{
  "goal": "...",
  "type": "...",
  "details": { ... }
}
`.trim();

    // 🔥 runReasoner → reasonerManager.run
    const rawOutput = await reasonerManager.run({
      systemPrompt,
      userPrompt: message,
      mode: "interpretation",
      temperature: 0.2,
      maxTokens: 900,
    });

    // ★ ReasoningCompression
    const cleaned = await this.compressor.compressIfLong(rawOutput, {
      kind: "reasoning",
      maxCharsOverride: 1800,
    });

    const parsed = this.safeParseTaskSpec(cleaned);

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
      details: { fallback: true },
    };
  }

  /**
   * Plan / Chat durumunda TaskSpec üretmeyen yapı
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
