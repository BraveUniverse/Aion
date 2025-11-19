// ===== modules/AgentRegistry.js =====

import { readMemory, writeMemory } from "./MemoryEngine.js";

/**
 * AgentRegistry
 * -----------------------------------------------
 * Hangi agent isminin hangi dosyada olduğunu tutan kalıcı yapı.
 * Örnek:
 * {
 *   "agents": {
 *     "CodeAgent": "agents/CodeAgent.js",
 *     "SQLAgent": "agents/SQLAgent.js"
 *   }
 * }
 */

export class AgentRegistry {
  constructor() {
    this.fileName = "agent_registry.json";
    this.data = this._load();
  }

  _load() {
    const data = readMemory(this.fileName);
    if (!data || typeof data !== "object" || !data.agents) {
      return { agents: {} };
    }
    return data;
  }

  _save() {
    writeMemory(this.fileName, this.data);
  }

  /**
   * Tüm agent isimlerini döndürür.
   */
  getAllNames() {
    return Object.keys(this.data.agents);
  }

  /**
   * Agent ismine göre dosya yolunu verir.
   * Bulamazsa null döner.
   */
  getPath(agentName) {
    return this.data.agents[agentName] || null;
  }

  /**
   * Agent var mı?
   */
  exists(agentName) {
    return Boolean(this.data.agents[agentName]);
  }

  /**
   * Yeni agent kaydı ekler veya günceller.
   * @param {string} agentName
   * @param {string} relativePath - proje köküne göre relative path (ör: "agents/SQLAgent.js")
   * @param {object} meta - opsiyonel ekstra bilgiler
   */
  register(agentName, relativePath, meta = {}) {
    if (!agentName || !relativePath) return;

    this.data.agents[agentName] = relativePath;
    this._save();

    // meta'yı istersen ayrı bir memory dosyasında tutabilirsin.
    // Şimdilik burada sadece registry güncellemesi yapıyoruz.
  }
}
