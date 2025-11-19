// ===== modules/CategoricalMemory.js =====

import { readMemory, writeMemory } from "./MemoryEngine.js";
import { EmbeddingStore } from "../memory/EmbeddingStore.js";

/**
 * CategoricalMemory
 * ---------------------------------------------------------------
 * AION'un uzun vadeli, kategorilere ayrılmış hafıza sistemi.
 *
 * Özellikler:
 *  - Her kategori için bağımsız memory havuzu
 *  - Her kayda embedding eklenir → semantic recall yapılabilir
 *  - MemoryEngine ile uyumludur
 *  - MemoryOrchestrator tarafından çağrılır
 *
 * Bu modül AION'un “kişilik”, “kullanıcı alışkanlıkları”, “uzun vadeli
 * proje bilgileri”, “pattern öğrenme” gibi kalıcı hafızasını oluşturur.
 */

export class CategoricalMemory {
  constructor() {
    this.fileName = "categorical_memory.json";

    // kategori yapısı:
    // {
    //   "user_profile": [
    //      { id, text, embedding, createdAt }
    //   ],
    //   "preferences": [ ... ],
    //   "projects": [ ... ],
    //   "coding_patterns": [...]
    // }
    this.data = this._load();
  }

  _load() {
    const m = readMemory(this.fileName);
    if (!m || typeof m !== "object") {
      return {};
    }
    return m;
  }

  _save() {
    writeMemory(this.fileName, this.data);
  }

  /**
   * Bir kategori yoksa otomatik oluşturur.
   */
  ensureCategory(name) {
    if (!this.data[name]) {
      this.data[name] = [];
      this._save();
    }
  }

  /**
   * Yeni uzun vadeli bilgi kaydı ekleme
   */
  async addRecord(category, text) {
    this.ensureCategory(category);

    const embedding = await EmbeddingStore.embed(text);

    const record = {
      id: `cm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      text,
      embedding,
      createdAt: new Date().toISOString()
    };

    this.data[category].push(record);
    this._save();

    return record;
  }

  /**
   * Kategoriden semantic olarak en yakın n kaydı döndürür.
   */
  async recallFromCategory(category, query, topN = 3) {
    if (!this.data[category] || this.data[category].length === 0) return [];

    const qEmbed = await EmbeddingStore.embed(query);

    const scored = this.data[category]
      .map((rec) => ({
        ...rec,
        similarity: cosineSimilarity(qEmbed, rec.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topN);
  }

  /**
   * Tüm kategorilerden semantic recall
   * → MemoryOrchestrator tarafından kullanılır.
   */
  async recallAll(query, topN = 5) {
    const qEmbed = await EmbeddingStore.embed(query);
    const all = [];

    for (const cat of Object.keys(this.data)) {
      for (const rec of this.data[cat]) {
        const score = cosineSimilarity(qEmbed, rec.embedding);
        all.push({
          ...rec,
          category: cat,
          similarity: score
        });
      }
    }

    return all
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);
  }

  /**
   * Bir kategoriyi tamamen silme
   */
  deleteCategory(category) {
    if (this.data[category]) {
      delete this.data[category];
      this._save();
    }
  }

  /**
   * Tüm hafızayı temizleme
   */
  clearAll() {
    this.data = {};
    this._save();
  }
}

/* -----------------------------------------------------
 * Basit cosine similarity
 * ---------------------------------------------------*/
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;

  return dot / (magA * magB);
}

export default CategoricalMemory;
