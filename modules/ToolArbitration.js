// ===== modules/ToolArbitration.js =====

/**
 * ToolArbitration (Advanced)
 * -------------------------------------------------------
 * Görev:
 *  - Bir TaskSpec için hangi agent'ların en mantıklı olduğunu önermek.
 *  - Hem kural bazlı heuristic, hem de LLM (runReasoner) ile ince ayar.
 *
 * Çıktı:
 * {
 *   primary: "CodeAgent",
 *   secondary: ["FixAgent", "FileAgent"],
 *   reason: "kısa açıklama",
 *   confidence: 0.0 - 1.0
 * }
 */

import { runReasoner } from "../config/models.js";
import { appendMemory } from "./MemoryEngine.js";

export class ToolArbitration {
  constructor() {
    this.defaultAgents = [
      "CodeAgent",
      "FileAgent",
      "FixAgent",
      "ResearchAgent",
      "PlanAgent",
      "PipelineCreatorAgent",
      "AgentCreatorAgent",
    ];
  }

  /**
   * @param {object} taskSpec - TaskSpec veya benzeri
   * @param {Array<string>} availableAgents
   * @param {object} context - {messageType, suggestedMode, ...}
   */
  async decide(taskSpec, availableAgents = [], context = {}) {
    const agents =
      availableAgents.length > 0 ? availableAgents : this.defaultAgents;

    // Önce kural bazlı basit tahmin
    const heuristic = this._heuristicDecision(taskSpec, agents, context);

    // Eğer DeepSeek yoksa sadece heuristic kullan
    let llmDecision = null;
    try {
      llmDecision = await this._llmDecision(taskSpec, agents, context, heuristic);
    } catch {
      // LLM sıkıntı çıkarırsa boşver
    }

    const final = this._mergeDecisions(heuristic, llmDecision);

    appendMemory("tool_arbitration.json", {
      taskId: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      context,
      heuristic,
      llmDecision,
      final,
      createdAt: new Date().toISOString(),
    });

    return final;
  }

  /* ------------------------------------------------------------
   * 1) Heuristic (rules)
   * ------------------------------------------------------------ */

  _heuristicDecision(taskSpec, agents, context) {
    const type = (taskSpec.type || "").toLowerCase();
    const goal = (taskSpec.goal || "").toLowerCase();
    const msgType = (context.messageType || "").toLowerCase();

    let primary = "CodeAgent";

    const has = (name) => agents.includes(name);

    // Agent oluşturma
    if (
      type.includes("create_agent") ||
      goal.includes("yeni agent") ||
      msgType === "agent"
    ) {
      primary = has("AgentCreatorAgent") ? "AgentCreatorAgent" : primary;
    }

    // Pipeline oluşturma
    else if (
      type.includes("create_pipeline") ||
      goal.includes("pipeline") ||
      goal.includes("akış oluştur")
    ) {
      primary = has("PipelineCreatorAgent") ? "PipelineCreatorAgent" : primary;
    }

    // Dosya düzenleme
    else if (
      type.includes("file") ||
      msgType === "file_edit" ||
      goal.includes("dosya") ||
      goal.includes("file")
    ) {
      primary = has("FileAgent") ? "FileAgent" : primary;
    }

    // Araştırma
    else if (
      type.includes("research") ||
      msgType === "research" ||
      goal.includes("araştır") ||
      goal.includes("kıyasla") ||
      goal.includes("piyasa")
    ) {
      primary = has("ResearchAgent") ? "ResearchAgent" : primary;
    }

    // Planlama / mimari
    else if (msgType === "planning" || type.includes("design")) {
      primary = has("PlanAgent") ? "PlanAgent" : primary;
    }

    const secondary = agents.filter((a) => a !== primary);

    return {
      primary,
      secondary,
      reason: "Heuristic seçimi",
      confidence: 0.6,
    };
  }

  /* ------------------------------------------------------------
   * 2) LLM Kararı
   * ------------------------------------------------------------ */

  async _llmDecision(taskSpec, agents, context, heuristic) {
    const systemPrompt = `
Sen AION'un ToolArbitration beynisin.

Görevin:
- Verilen taskSpec + context + mevcut agent listesi için
  en mantıklı agent'ı seçmek.
- Heuristic öneriyi de gör ama ona mahkum değilsin.

Çıkış JSON:
{
  "primary": "AgentName",
  "secondary": ["AgentName1", "AgentName2"],
  "reason": "kısa açıklama",
  "confidence": 0.0 - 1.0
}
`.trim();

    const userPrompt = `
TaskSpec:
${JSON.stringify(taskSpec, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Available agents:
${JSON.stringify(agents, null, 2)}

HeuristicSuggestion:
${JSON.stringify(heuristic, null, 2)}
`;

    const raw = await runReasoner(systemPrompt, userPrompt);

    let parsed;
    try {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      parsed = JSON.parse(raw.slice(s, e + 1));
    } catch {
      parsed = null;
    }

    return parsed;
  }

  /* ------------------------------------------------------------
   * 3) Heuristic + LLM kararlarını birleştir
   * ------------------------------------------------------------ */

  _mergeDecisions(heuristic, llmDecision) {
    if (!llmDecision || !llmDecision.primary) {
      return {
        ...heuristic,
        source: "heuristic_only",
      };
    }

    // LLM'in confidence'ı düşükse heuristic'i koru
    const llmConf = typeof llmDecision.confidence === "number"
      ? llmDecision.confidence
      : 0.6;

    if (llmConf < heuristic.confidence) {
      return {
        ...heuristic,
        source: "heuristic_dominate",
      };
    }

    // LLM ağır basarsa
    const merged = {
      primary: llmDecision.primary || heuristic.primary,
      secondary: Array.isArray(llmDecision.secondary)
        ? llmDecision.secondary
        : heuristic.secondary,
      reason: llmDecision.reason || heuristic.reason,
      confidence: Math.max(heuristic.confidence, llmConf),
      source: "llm_preferred",
    };

    return merged;
  }
}
