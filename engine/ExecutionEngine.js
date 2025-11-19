// ===== engine/ExecutionEngine.js =====

import path from "path";
import { pathToFileURL } from "url";

import { appendMemory } from "../modules/MemoryEngine.js";
import { AgentRegistry } from "../modules/AgentRegistry.js";
import { DynamicAgentBuilder } from "./DynamicAgentBuilder.js";

// ★ Yeni dahil edilen gelişmiş beyin modülleri:
import { ToolArbitration } from "../modules/ToolArbitration.js";
import { ReasoningCompression } from "../modules/ReasoningCompression.js";
import { RelevancyLayer } from "../modules/RelevancyLayer.js";

/**
 * ExecutionEngine (Self-Expanding, Self-Healing, Brain-Aware)
 * -------------------------------------------------------
 * - AgentRegistry → agent path doğrulama
 * - DynamicAgentBuilder → eksik agent dosyası oluşturma
 * - ToolArbitration → yanlış agent çağrısını engelleme
 * - ReasoningCompression → çok büyük agent outputlarını sıkıştırma
 * - RelevancyLayer → adımın bağlam analizi
 * - Dinamik import → tüm agentların runtime'da yüklenmesi
 */

export class ExecutionEngine {
  constructor() {
    this.registry = new AgentRegistry();
    this.builder = new DynamicAgentBuilder();
    this.cache = new Map();

    // Gelişmiş beyin modülleri
    this.toolArbiter = new ToolArbitration();
    this.compressor = new ReasoningCompression(2000);
    this.relevancy = new RelevancyLayer();
  }

  /**
   * Controller → ExecutionEngine → Agent.run()
   * 
   * @param {string} agentName
   * @param {object} input
   * @param {object} context
   */
  async runAgent(agentName, input, context = {}) {
    const startedAt = new Date().toISOString();

    // ★ Önce bağlam analizi yap
    const relevancy = await this.relevancy.analyze(input, context);

    // ★ Agent doğru seçilmiş mi?
    const arbitration = await this.toolArbiter.decide(
      {
        goal: input.taskGoal,
        type: input.taskDetails?.type,
        details: input.taskDetails,
      },
      [],
      {
        blueprintAgent: agentName,
        stepContext: relevancy,
      }
    );

    const finalAgentName = arbitration.primary;

    try {
      const instance = await this.getAgentInstance(finalAgentName, input);
      const rawOutput = await instance.run(input, { ...context, relevancy });

      // ★ Output çok büyükse sıkıştır
      const output = await this.compressor.compressIfLong(rawOutput);

      appendMemory("agent_runs.json", {
        agentName: finalAgentName,
        blueprintAgent: agentName,
        arbitration,
        relevancy,
        inputSummary: {
          stepId: input.stepId,
          stepTitle: input.stepTitle,
          goal: input.taskGoal,
        },
        outputPreview: String(output).slice(0, 300),
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      return output;

    } catch (err) {
      // ★ Error kayıt
      appendMemory("agent_runs.json", {
        agentName: finalAgentName,
        inputSummary: {
          stepId: input.stepId,
          stepTitle: input.stepTitle,
          goal: input.taskGoal,
        },
        error: String(err?.message || err),
        arbitration,
        relevancy,
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      // ★ Otomatik hata düzeltme (Auto-Healing)
      const healed = await this.autoHeal(finalAgentName, input, err);

      if (healed.fixedOutput !== null) {
        return healed.fixedOutput;
      }

      throw err;
    }
  }

  /**
   * Eksik agent → oluştur + dynamic import
   */
  async getAgentInstance(agentName, hintInput = {}) {
    let relativePath = this.registry.getPath(agentName);

    if (!relativePath) {
      // ★ dynamic agent creation
      relativePath = await this.builder.ensureAgentFile(agentName, hintInput);
    }

    const cacheKey = `${agentName}@${relativePath}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const absPath = path.resolve(process.cwd(), relativePath);
    const url = pathToFileURL(absPath).href;

    const module = await import(url);

    const AgentClass = module[agentName] || module.default;
    if (!AgentClass) {
      throw new Error(
        `ExecutionEngine: ${relativePath} içinde '${agentName}' sınıfı bulunamadı`
      );
    }

    const instance = new AgentClass();
    this.cache.set(cacheKey, instance);

    return instance;
  }

  /**
   * AUTO-HEALING → Agent hatasını fix etmeyi dener
   * Bu sistem, AION'un kendi kendini geliştirme kısmıdır.
   */
  async autoHeal(agentName, input, error) {
    try {
      const fixSuggestion = `
Agent hata verdi.

Agent: ${agentName}
Hata: ${String(error)}

Görev:
Bu hatayı düzeltmek için:
1) Hatanın nedenini açıkla
2) Agent dosyasına eklenmesi gereken patch'i üret
3) Patch'i JSON formatında döndür:

{
  "reason": "...",
  "patch": {
    "file": "agents/${agentName}.js",
    "changes": "..."
  }
}
`;

      // reasoning (DeepFix)
      const raw = await runReasoner(fixSuggestion, "");
      const compressed = await this.compressor.compressIfLong(raw, {
        maxCharsOverride: 1500,
        kind: "fix_patch",
      });

      appendMemory("auto_heal.json", {
        agent: agentName,
        input,
        error: String(error),
        suggestion: compressed,
        createdAt: new Date().toISOString(),
      });

      // şimdilik patch'i uygulamıyoruz, auto-review modunda sadece kaydediyoruz
      return { fixedOutput: null };

    } catch {
      return { fixedOutput: null };
    }
  }
}
