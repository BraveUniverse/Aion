// ===== memory/EmbeddingStore.js =====

import fs from "fs";
import path from "path";
import { runEmbeddingModel } from "../config/models.js";

/**
 * EmbeddingStore
 * -------------------------------------------------------
 * - semantic.json içindeki embedding kayıtlarını yönetir.
 * - runEmbeddingModel(model, text) kullanarak embedding üretir.
 * - En yakın komşu hesaplamasını içerir.
 */

export class EmbeddingStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  /* ------------------------------------------------------------
   * INIT / LOAD
   * ----------------------------------------------------------*/
  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (err) {
      console.error("EmbeddingStore LOAD error:", err);
      return [];
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error("EmbeddingStore SAVE error:", err);
    }
  }

  /* ------------------------------------------------------------
   * PUBLIC: Embedding oluştur
   * ----------------------------------------------------------*/
  async generateEmbedding(text) {
    try {
      const emb = await runEmbeddingModel(text);
      return emb;
    } catch (err) {
      console.error("EmbeddingStore generateEmbedding error:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------
   * PUBLIC: Yeni kayıt ekle
   * ----------------------------------------------------------*/
  add(entry, maxCount = 500) {
    this.data.push(entry);

    // Kapasite aşılırsa en eski kaydı sil
    if (this.data.length > maxCount) {
      this.data.shift();
    }

    this._save();
  }

  /* ------------------------------------------------------------
   * PUBLIC: En yakın semantic sonuçlar
   * ----------------------------------------------------------*/
  async nearest(text, topK = 5) {
    if (this.data.length === 0) return [];

    const queryEmb = await this.generateEmbedding(text);

    const scored = this.data.map((item) => {
      try {
        return {
          ...item,
          score: cosineSimilarity(queryEmb, item.embedding),
        };
      } catch {
        return { ...item, score: 0 };
      }
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

/* ------------------------------------------------------------
 * Cosine similarity helper
 * ----------------------------------------------------------*/
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0,
    normA = 0,
    normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}
