// ===== modules/TaskTypeRegistry.js =====

import { readMemory, writeMemory } from "./MemoryEngine.js";

/**
 * TaskTypeRegistry
 * -----------------------------------------------
 * Görev tiplerinin kalıcı olarak tutulduğu öğrenilebilir yapı.
 * Interpreter yeni bir type üretirse buraya eklenir ve kalıcı olur.
 */

export class TaskTypeRegistry {
  constructor() {
    this.fileName = "task_types_registry.json";
    this.data = this._load();
  }

  _load() {
    const data = readMemory(this.fileName);
    if (!data || !Array.isArray(data.types)) {
      return { types: [] };
    }
    return data;
  }

  /**
   * Var olan tüm tipleri döndürür.
   */
  getAll() {
    return this.data.types;
  }

  /**
   * Yeni bir görev tipi varsa registry'ye kalıcı olarak ekler.
   */
  register(typeName) {
    if (!typeName) return;

    if (!this.data.types.includes(typeName)) {
      this.data.types.push(typeName);

      writeMemory(this.fileName, this.data);

      console.log(`[AION Registry] Yeni görev tipi öğrenildi → ${typeName}`);
      return true;
    }
    return false;
  }

  /**
   * Tip listesinde var mı?
   */
  exists(typeName) {
    return this.data.types.includes(typeName);
  }
}
