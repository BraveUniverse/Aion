// ===== brain/ArbitrationLayer.js =====

/**
 * ArbitrationLayer
 * -------------------------------------------------------
 * Görev:
 *  - PlannerLayer'dan gelen PipelineSpec'i inceleyip,
 *    her step için en mantıklı agent'ı seçmek.
 *
 * Kullanır:
 *  - RelevancyEngine  → mesaj tipi + mod tahmini
 *  - ToolArbitration  → primary / secondary agent kararı
 *
 * NOT:
 *  - Pipeline yapısını bozmaz, sadece agent seçimini optimize eder.
 *  - ControllerLayer, isterse bu layer'dan dönen optimizedPipeline'ı
 *    kullanarak çalışır.
 */

import { ToolArbitration } from "../modules/ToolArbitration.js";
import { RelevancyEngine } from "../modules/Relevancy.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export class ArbitrationLayer {
  constructor(options = {}) {
    this.toolArb = new ToolArbitration();
    this.relevancy = new RelevancyEngine({
      maxMessages: options.maxMessages || 12,
      maxTasks: options.maxTasks || 20,
      maxChars: options.maxChars || 9000,
    });
  }

  /**
   * Ana fonksiyon:
   *  - TaskSpec + PipelineSpec alır
   *  - Relevancy + ToolArbitration ile step.agent seçimlerini optimize eder
   *
   * @param {object} taskSpec
   * @param {object} pipelineSpec
   * @param {object} options  { history, preferences, profile }
   * @returns {Promise<{ optimizedPipeline, arbitrationLog, relevance }>}
   */
  async arbitrate(taskSpec, pipelineSpec, options = {}) {
    const { history = [], preferences = {}, profile = {} } = options;

    // 1) RelevancyEngine → mesaj tipi + mod + context
    const relevance = await this.relevancy.analyze({
      history,
      currentInput: taskSpec.goal || "",
      preferences,
      profile,
    });

    const arbitrationLog = [];
    const newSteps = [];

    // 2) Her step için ToolArbitration çağır
    for (const step of pipelineSpec.steps || []) {
      const decision = await this.toolArb.decide(
        taskSpec,
        [step.agent], // mevcut agent'ı candidate list'e koy
        {
          messageType: relevance.messageType,
          suggestedMode: relevance.suggestedMode,
          stepTitle: step.title,
          stepAgent: step.agent,
        }
      );

      const finalAgent = decision?.primary || step.agent;

      arbitrationLog.push({
        stepId: step.id,
        stepTitle: step.title,
        originalAgent: step.agent,
        finalAgent,
        decision,
      });

      newSteps.push({
        ...step,
        agent: finalAgent,
        meta: {
          ...(step.meta || {}),
          arbitration: {
            ...decision,
            decidedAt: new Date().toISOString(),
          },
        },
      });
    }

    // 3) Pipeline meta'ya arbitration bilgisini işle
    const optimizedPipeline = {
      ...pipelineSpec,
      steps: newSteps,
      meta: {
        ...(pipelineSpec.meta || {}),
        arbitration: {
          messageType: relevance.messageType,
          suggestedMode: relevance.suggestedMode,
          score: relevance.score,
          decidedAt: new Date().toISOString(),
        },
      },
    };

    // 4) Log kaydı
    appendMemory("tool_arbitration_runs.json", {
      taskId: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      relevance: {
        messageType: relevance.messageType,
        suggestedMode: relevance.suggestedMode,
        score: relevance.score,
      },
      steps: arbitrationLog,
      createdAt: new Date().toISOString(),
    });

    return {
      optimizedPipeline,
      arbitrationLog,
      relevance,
    };
  }
}
