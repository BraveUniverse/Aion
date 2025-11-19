// ===== memory/MemoryReader.js =====

import fs from "fs";
import { EmbeddingStore } from "./EmbeddingStore.js";

/**
 * MemoryReader
 * -------------------------------------------------------
 * Hybrid Memory'nin okuma katmanı.
 *
 * 3 kaynaktan okur:
 *  - episodic.json
 *  - semantic.json   (embedding store)
 *  - structured.json
 *
 * + Fusion Logic: relevance puanı hesaplanır.
 */

export class MemoryReader {
  constructor(paths) {
    this.paths = paths;
    this.semantic = new EmbeddingStore(paths.semantic);
  }

  /* ------------------------------------------------------------
   * EPISODIC MEMORY OKUMA
   * ----------------------------------------------------------*/
  readEpisodic(limit = 50) {
    try {
      const raw = fs.readFileSync(this.paths.episodic, "utf8");
      const items = JSON.parse(raw);

      return items.slice(-limit); // son X giriş
    } catch {
      return [];
    }
  }

  /* ------------------------------------------------------------
   * STRUCTURED MEMORY OKUMA
   * ----------------------------------------------------------*/
  readStructured() {
    try {
      const raw = fs.readFileSync(this.paths.structured, "utf8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /* ------------------------------------------------------------
   * SEMANTIC MEMORY SEARCH
   * ----------------------------------------------------------*/
  async searchSemantic(queryText, topK = 5, threshold = 0.25) {
    try {
      const queryEmbedding = await this.semantic.generateEmbedding(queryText);

      const results = this.semantic.search(queryEmbedding, topK);

      return results.filter((r) => r.score >= threshold);
    } catch (err) {
      console.error("Semantic search error:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------
   * HYBRID FUSION MEMORY
   *
   * Weighted combination of:
   *   - episodic matches
   *   - semantic matches
   *   - structured memory
   * ----------------------------------------------------------*/
  async queryHybridMemory(queryText) {
    const episodic = this.readEpisodic(40);
    const structured = this.readStructured();
    const semantic = await this.searchSemantic(queryText, 8, 0.2);

    // scoring
    const fused = [];

    // 1) semantic results zaten score içeriyor
    for (const r of semantic) {
      fused.push({
        source: "semantic",
        score: r.score * 1.0,
        entry: r.item,
      });
    }

    // 2) episodic (zaman ağırlıklı)
    const now = Date.now();
    for (const e of episodic) {
      const ageMs = now - new Date(e.timestamp).getTime();
      const agePenalty = Math.max(0.2, 1 - ageMs / (1000 * 60 * 60 * 24)); // 24 saat decay

      fused.push({
        source: "episodic",
        score: agePenalty * 0.6,
        entry: e,
      });
    }

    // 3) structured (kalıcı → yüksek base score)
    for (const [key, obj] of Object.entries(structured)) {
      fused.push({
        source: "structured",
        score: 0.85,
        entry: { key, value: obj.value },
      });
    }

    // 4) relevance sorting
    fused.sort((a, b) => b.score - a.score);

    return fused.slice(0, 10);
  }

  /* ------------------------------------------------------------
   * High-level utility:
   *  → AION beyninin "bana hafızadan en iyi 10 şeyi getir"
   * ----------------------------------------------------------*/
  async recall(queryText) {
    const items = await this.queryHybridMemory(queryText);

    return {
      query: queryText,
      results: items,
      retrievedAt: new Date().toISOString(),
    };
  }
}
