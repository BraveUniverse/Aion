// ===== memory/MemoryOrchestrator.js =====
// AION Hybrid Memory Brain (FULL VERSION)

import { MemoryReader } from "./MemoryReader.js";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { LongTermMemoryEngine } from "./LongTermMemoryEngine.js";
import { CategoricalMemory } from "./CategoricalMemory.js";
import { readMemory } from "../modules/MemoryEngine.js";

/**
 * MemoryOrchestrator
 * -------------------------------------------------------
 * AION’un FINAL hafıza birleştiricisi.
 *
 * Kullanıcı mesajı için:
 *  1) Episodic memory
 *  2) Semantic memory
 *  3) Structured memory
 *  4) Categorical memory
 *  5) Long-term memory (özetlenmiş kalıcı bilgiler)
 *
 * Tümünü skorlayıp ContextPack üretir.
 */

export class MemoryOrchestrator {
  constructor(paths = {}) {
    this.reader = new MemoryReader(paths);
    this.embedder = new EmbeddingStore(paths.semantic);
    this.longterm = new LongTermMemoryEngine(paths.longterm);
    this.categorical = new CategoricalMemory(paths.categorical);

    this.MAX_CONTEXT_ITEMS = 12;
  }

  /**
   * Ana API:
   *  → User input
   *  ← Hybrid memory contextPack
   */
  async buildContextPack(userMessage) {
    const embedding = await this.embedder.generateEmbedding(userMessage);

    // 1) Episodic — yakın geçmiş
    const episodic = this.collectEpisodic(20);

    // 2) Semantic — benzer içerikler
    const semantic = await this.reader.querySimilar(userMessage, 6);

    // 3) Structured — kurallar, projeler, planlar
    const structured = this.collectStructured(userMessage);

    // 4) Categorical — kategoriye göre uzun dönem
    const categorical = this.collectCategorical(userMessage);

    // 5) Long-term — özetlenmiş bilgiler
    const longterm = await this.collectLongTerm(userMessage);

    // 6) Hepsini ağırlıklı birleştir
    const merged = await this.mergeAndScore({
      episodic,
      semantic,
      structured,
      categorical,
      longterm
    }, embedding);

    // 7) Final text oluştur
    const contextPack = this.buildContextString(merged.slice(0, this.MAX_CONTEXT_ITEMS));

    return {
      contextPack,
      sources: merged
    };
  }

  /* ------------------------------------------------------------
   * 1) EPISODIC
   * ----------------------------------------------------------*/
  collectEpisodic(limit = 20) {
    const data = readMemory("episodic.json") || [];
    const sliced = data.slice(-limit);

    return sliced.map(m => ({
      channel: "episodic",
      score: 0.35,
      text: `${m.role}: ${m.text}`,
      raw: m
    }));
  }

  /* ------------------------------------------------------------
   * 2) STRUCTURED MEMORY
   * ----------------------------------------------------------*/
  collectStructured(userMessage) {
    const db = readMemory("structured.json") || {};
    const msg = userMessage.toLowerCase();

    const res = [];

    for (const key of Object.keys(db)) {
      const entry = db[key];
      const txt = JSON.stringify(entry.value || "").toLowerCase();

      const match = txt.includes(msg) ? 0.9 : 0.5;

      res.push({
        channel: "structured",
        score: match,
        text: `${key}: ${JSON.stringify(entry.value)}`,
        raw: entry
      });
    }

    return res;
  }

  /* ------------------------------------------------------------
   * 3) CATEGORICAL MEMORY
   * ----------------------------------------------------------*/
  collectCategorical(userMessage) {
    const records = this.categorical.getAll();
    const msg = userMessage.toLowerCase();

    return records.map(rec => {
      const text = JSON.stringify(rec.data).toLowerCase();
      const hit = text.includes(msg);

      return {
        channel: "categorical",
        score: hit ? 0.75 : 0.45,
        text: `[${rec.category}] ${rec.data.text}`,
        raw: rec
      };
    });
  }

  /* ------------------------------------------------------------
   * 4) LONG TERM MEMORY
   * ----------------------------------------------------------*/
  async collectLongTerm(userMessage) {
    const summaries = await this.longterm.search(userMessage);
    return summaries.map(s => ({
      channel: "longterm",
      score: s.score || 0.6,
      text: `[LT] ${s.summary}`,
      raw: s
    }));
  }

  /* ------------------------------------------------------------
   * 5) MERGE & SCORE (Hybrid)
   * ----------------------------------------------------------*/
  async mergeAndScore(channels, queryEmbedding) {
    const all = [
      ...channels.episodic,
      ...channels.semantic,
      ...channels.structured,
      ...channels.categorical,
      ...channels.longterm
    ];

    // Semantic kendi distance skorunu içeriyor
    const normalized = await Promise.all(
      all.map(async item => {
        let score = item.score ?? 0.3;

        // semantic dışı kaynaklar için embedding similarity boost
        if (item.channel !== "semantic") {
          const sim = await this.embedder.similarity(queryEmbedding, item.text);
          score += sim * 0.35; // ağır etkili
        }

        return { ...item, finalScore: score };
      })
    );

    return normalized.sort((a, b) => b.finalScore - a.finalScore);
  }

  /* ------------------------------------------------------------
   * 6) CONTEXT STRING
   * ----------------------------------------------------------*/
  buildContextString(items) {
    return items
      .map(i => {
        return `[${i.channel.toUpperCase()}] ${i.text}`;
      })
      .join("\n");
  }
}
