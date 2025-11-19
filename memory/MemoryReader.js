// ===== memory/MemoryReader.js =====
// AION Hybrid Memory — Full Reader Layer

import fs from "fs";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { CategoricalMemory } from "./CategoricalMemory.js";
import { LongTermMemoryEngine } from "./LongTermMemoryEngine.js";

/**
 * MemoryReader
 * -------------------------------------------------------
 * AION Hybrid Memory için tüm okuma operasyonlarını yürütür:
 *
 *  - Episodic Memory (yakın geçmiş)
 *  - Structured Memory (kalıcı kurallar, bilgiler, projeler)
 *  - Semantic Memory (embedding store)
 *  - Categorical Memory (kategori bazlı uzun dönem)
 *  - Long-Term Memory Engine (özetlenmiş bilgiler)
 *
 * Not:
 *  → MemoryOrchestrator üst katman, Reader alt katmandır.
 */

export class MemoryReader {
  constructor(paths = {}) {
    this.paths = paths;

    // Embedding store (semantic)
    this.semantic = new EmbeddingStore(paths.semantic);

    // Categorical memory
    this.categorical = new CategoricalMemory(paths.categorical);

    // Long-term memory engine
    this.longterm = new LongTermMemoryEngine(paths.longterm);
  }

  /* ------------------------------------------------------------
   * 1) EPISODIC MEMORY (son konuşmalar)
   * ----------------------------------------------------------*/
  readEpisodic(limit = 50) {
    try {
      const raw = fs.readFileSync(this.paths.episodic, "utf8");
      const json = JSON.parse(raw);

      // En çok konuşmayı çeken yer burasıdır
      return json.slice(-limit);
    } catch (err) {
      return [];
    }
  }

  /* ------------------------------------------------------------
   * 2) STRUCTURED MEMORY (kalıcı bilgiler)
   * ----------------------------------------------------------*/
  readStructured() {
    try {
      const raw = fs.readFileSync(this.paths.structured, "utf8");
      const json = JSON.parse(raw);
      return json;
    } catch (err) {
      return {};
    }
  }

  /* ------------------------------------------------------------
   * 3) SEMANTIC MEMORY SEARCH
   * ----------------------------------------------------------*/
  async searchSemantic(queryText, topK = 5, threshold = 0.2) {
    try {
      const embedding = await this.semantic.generateEmbedding(queryText);

      const results = this.semantic.search(embedding, topK);

      // Semantic store format: { item, score }
      return results.filter(r => r.score >= threshold);
    } catch (err) {
      console.error("Semantic search error:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------
   * 4) CATEGORICAL MEMORY READ
   * ----------------------------------------------------------*/
  readCategorical() {
    return this.categorical.getAll();
  }

  /* ------------------------------------------------------------
   * 5) LONG-TERM MEMORY SEARCH
   * ----------------------------------------------------------*/
  async searchLongTerm(queryText, topK = 5) {
    try {
      const res = await this.longterm.search(queryText, topK);
      return res.map(r => ({
        source: "longterm",
        score: r.score ?? 0.6,
        entry: r
      }));
    } catch (err) {
      console.error("LongTerm search error:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------
   * 6) HYBRID FUSION MEMORY
   *
   * Modern scoring:
   *   - Semantic → score olduğu gibi
   *   - Episodic → zaman decay + low-wt
   *   - Structured → güçlü kalıcı bilgi
   *   - Categorical → kategori match
   *   - Long-term → özetlenmiş hafıza
   * ----------------------------------------------------------*/
  async queryHybridMemory(queryText) {
    const now = Date.now();
    const msgLower = queryText.toLowerCase();

    // Pull memory layers
    const episodic = this.readEpisodic(40);
    const structured = this.readStructured();
    const semantic = await this.searchSemantic(queryText, 8, 0.2);
    const categorical = this.readCategorical();
    const longterm = await this.searchLongTerm(queryText, 5);

    const fused = [];

    /* -------------------------
     * 1) SEMANTIC MEMORY
     * -----------------------*/
    for (const r of semantic) {
      fused.push({
        source: "semantic",
        score: r.score * 1.0,
        entry: r.item
      });
    }

    /* -------------------------
     * 2) EPISODIC MEMORY
     * -----------------------*/
    for (const e of episodic) {
      const ageMs = now - new Date(e.timestamp).getTime();
      const agePenalty = Math.max(0.2, 1 - ageMs / (1000 * 60 * 60 * 24)); // 24 saat decay

      fused.push({
        source: "episodic",
        score: agePenalty * 0.45,
        entry: e
      });
    }

    /* -------------------------
     * 3) STRUCTURED MEMORY
     * -----------------------*/
    for (const [key, obj] of Object.entries(structured)) {
      const rawTxt = JSON.stringify(obj.value || "").toLowerCase();
      const hit = rawTxt.includes(msgLower);

      fused.push({
        source: "structured",
        score: hit ? 0.95 : 0.55,
        entry: { key, value: obj.value }
      });
    }

    /* -------------------------
     * 4) CATEGORICAL MEMORY
     * -----------------------*/
    for (const cat of categorical) {
      const rawTxt = JSON.stringify(cat.data || "").toLowerCase();
      const hit = rawTxt.includes(msgLower);

      fused.push({
        source: "categorical",
        score: hit ? 0.80 : 0.45,
        entry: cat
      });
    }

    /* -------------------------
     * 5) LONG-TERM MEMORY
     * -----------------------*/
    for (const lt of longterm) {
      fused.push(lt);
    }

    fused.sort((a, b) => b.score - a.score);

    return fused.slice(0, 12);
  }

  /* ------------------------------------------------------------
   * 7) High-level recall()
   * ----------------------------------------------------------*/
  async recall(queryText) {
    const items = await this.queryHybridMemory(queryText);

    return {
      query: queryText,
      results: items,
      retrievedAt: new Date().toISOString()
    };
  }
}
