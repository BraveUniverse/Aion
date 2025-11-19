// ===== engine/ExecutionEngine.js =====

import path from "path";
import { pathToFileURL } from "url";
import { appendMemory } from "../modules/MemoryEngine.js";
import { AgentRegistry } from "../modules/AgentRegistry.js";
import { DynamicAgentBuilder } from "./DynamicAgentBuilder.js";

/**
 * ExecutionEngine (Dynamic, Self-Expanding)
 * -------------------------------------------------------
 * - AgentRegistry'den agent path'ini bulur.
 * - Yoksa DynamicAgentBuilder ile yeni agent dosyası üretir.
 * - Sonra dinamik import ile agent sınıfını yükler, instance oluşturur.
 * - Agent.run(input, context) çağırır ve sonucu döndürür.
 */

export class ExecutionEngine {
  constructor() {
    this.registry = new AgentRegistry();
    this.builder = new DynamicAgentBuilder();
    this.cache = new Map(); // key: agentName@path → instance
  }

  /**
   * Controller burayı çağırır.
   *
   * @param {string} agentName
   * @param {object} input
   * @param {object} context
   */
  async runAgent(agentName, input, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      const instance = await this.getAgentInstance(agentName, input);
      const output = await instance.run(input, context);

      appendMemory("agent_runs.json", {
        agentName,
        inputSummary: {
          taskGoal: input.taskGoal,
          stepId: input.stepId,
          stepTitle: input.stepTitle,
        },
        status: "success",
        createdAt: startedAt,
        finishedAt: new Date().toISOString(),
      });

      return output;
    } catch (err) {
      appendMemory("agent_runs.json", {
        agentName,
        inputSummary: {
          taskGoal: input.taskGoal,
          stepId: input.stepId,
          stepTitle: input.stepTitle,
        },
        status: "error",
        error: String(err?.message || err),
        createdAt: startedAt,
        finishedAt: new Date().toISOString(),
      });

      throw err;
    }
  }

  /**
   * Agent instance'ını getir:
   * - Registry'de var mı?
   * - Yoksa yeni agent dosyasını oluştur
   * - Dinamik import + cache
   */
  async getAgentInstance(agentName, hintInput = {}) {
    // 1) Agent dosyasının varlığını garanti et
    let relativePath = this.registry.getPath(agentName);
    if (!relativePath) {
      relativePath = await this.builder.ensureAgentFile(agentName, hintInput);
    }

    const cacheKey = `${agentName}@${relativePath}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 2) Dinamik import
    const absPath = path.resolve(process.cwd(), relativePath);
    const fileUrl = pathToFileURL(absPath).href;

    const module = await import(fileUrl);

    // Agent sınıfı ismi agentName ile aynı olmalı
    const AgentClass = module[agentName] || module.default;
    if (!AgentClass) {
      throw new Error(
        `ExecutionEngine: ${relativePath} içinde ${agentName} sınıfı bulunamadı.`
      );
    }

    const instance = new AgentClass();
    this.cache.set(cacheKey, instance);

    return instance;
  }
}
