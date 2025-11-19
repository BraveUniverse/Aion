// ===== memory/EmbeddingStore.js =====

import fs from "fs";
import path from "path";
import { runEmbeddingModel } from "../config/models.js";

/**
 * EmbeddingStore (JSON-based, High Compatibility)
 * ---------------------------------------------------------
 * LongTermMemoryEngine ve MemoryReader ile %100 uyumludur.
 *
 * Format:
 * [
 *   {
 *     id: "lt_...",
 *     text: "...",
 *     summary: "...",
 *     tags: [...],
 *     source: "...",
 *     importance: 0.7,
 *     embedding: [...],
 *     createdAt: "2025-02-20T12:00:00Z"
 *   }
 * ]
 */

export class EmbeddingStore {
  constructor(jsonPath) {
    this.file = jsonPath || path.join(process.cwd(), "memory_data", "semantic.json");

    if (!fs.existsSync(path.dirname(this.file))) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    }

    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify([]));
    }
  }

  /* --------------------------------------------------------
   * RAW READ/WRITE
   * ------------------------------------------------------*/
  _loadAll() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  _saveAll(list) {
    fs.writeFileSync(this.file, JSON.stringify(list, null, 2));
  }

  /* --------------------------------------------------------
   * GENERATE EMBEDDING
   * ------------------------------------------------------*/
  async generateEmbedding(text) {
    const result = await runEmbeddingModel(text);

    if (!result || !Array.isArray(result.embedding)) {
      throw new Error("EmbeddingStore: Invalid embedding output");
    }

    return Float32Array.from(result.embedding);
  }

  /* --------------------------------------------------------
   * ADD ITEM
   * ------------------------------------------------------*/
  async add(item) {
    const list = this._loadAll();
    list.push(item);
    this._saveAll(list);
  }

  /* --------------------------------------------------------
   * SEARCH
   * ------------------------------------------------------*/
  search(queryEmbedding, topK = 5) {
    const list = this._loadAll();
    if (list.length === 0) return [];

    const q = Array.from(queryEmbedding);

    const scored = list.map((item) => {
      const emb = item.embedding;
      if (!emb || emb.length !== q.length) return null;

      return {
        item,
        score: cosineSimilarity(q, emb),
      };
    }).filter(Boolean);

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

/* --------------------------------------------------------
 * COSINE SIMILARITY
 * ------------------------------------------------------*/
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
