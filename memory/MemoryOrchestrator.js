// ===== memory/MemoryOrchestrator.js =====

import { MemoryReader } from "./MemoryReader.js";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { readMemory } from "../modules/MemoryEngine.js";

/**
 * MemoryOrchestrator (Hybrid Memory Brain)
 * -------------------------------------------------------
 * Görev:
 *  - Kullanıcı mesajı için en iyi hafıza karışımını üretir:
 *      1) episodic memory (yakın geçmiş)
 *      2) semantic memory (embedding tabanlı)
 *      3) structured memory (planlar, projeler, görevler)
 *      4) long-term categorical memory (kategori bazlı özet)
 *
 *  - Hepsini skorlayıp tek bir contextPack halinde Reasoner'a sunar.
 */

export class MemoryOrchestrator {
  constructor() {
    this.reader = new MemoryReader();
    this.embedder = new EmbeddingStore();
  }

  /**
   * Ana fonksiyon:
   * Kullanıcı mesajı → hybrid memory context.
   */
  async buildContextPack(userMessage) {
    const queryEmbedding = await this.embedder.generateEmbedding(userMessage);

    // 1) Episodic memory: son 20 mesaj
    const episodic = this.collectEpisodic();

    // 2) Semantic memory: embedding store'dan en yakın 5 kayıt
    const semantic = await this.reader.querySimilar(userMessage, 5);

    // 3) Structured memory (planlar, projeler, görevler)
    const structured = this.collectStructured(userMessage);

    // 4) Long-term categorical memory
    const longTerm = this.collectLongTerm(userMessage);

    // 5) Skorlayıp birleştiriyoruz
    const merged = this.mergeAndRank({
      episodic,
      semantic,
      structured,
      longTerm
    }, queryEmbedding);

    return {
      contextPack: this.buildContextString(merged),
      sources: merged
    };
  }

  /* -------------------------------------------------------
   * 1) Episodic Memory — Son mesajlar
   * -----------------------------------------------------*/
  collectEpisodic(limit = 20) {
    const msgs = readMemory("messages.json") || [];
    return msgs.slice(-limit).map(m => ({
      type: "episodic",
      score: 0.3,
      data: m
    }));
  }

  /* -------------------------------------------------------
   * 2) Structured Memory — Projeler, planlar, görevler
   * -----------------------------------------------------*/
  collectStructured(userMessage) {
    const projects = readMemory("projects.json") || [];
    const plans = readMemory("plans.json") || [];
    const tasks = readMemory("tasks.json") || [];

    const msgLower = userMessage.toLowerCase();

    const result = [];

    for (const p of projects) {
      const hit =
        p.title?.toLowerCase().includes(msgLower) ||
        p.description?.toLowerCase().includes(msgLower);

      result.push({
        type: "structured_project",
        score: hit ? 0.8 : 0.4,
        data: p
      });
    }

    for (const pl of plans) {
      const hit =
        pl.plan?.planTitle?.toLowerCase().includes(msgLower) ||
        pl.input?.toLowerCase().includes(msgLower);

      result.push({
        type: "structured_plan",
        score: hit ? 0.7 : 0.4,
        data: pl
      });
    }

    for (const t of tasks) {
      const hit = t.goal?.toLowerCase().includes(msgLower);

      result.push({
        type: "structured_task",
        score: hit ? 0.6 : 0.3,
        data: t
      });
    }

    return result;
  }

  /* -------------------------------------------------------
   * 3) Long-Term Categorical Memory (future use)
   * -----------------------------------------------------*/
  collectLongTerm(userMessage) {
    const cats = readMemory("memory_categories.json") || [];

    const msgLower = userMessage.toLowerCase();

    return cats.map(c => ({
      type: "long_term",
      score: c.keywords.some(k => msgLower.includes(k.toLowerCase()))
        ? 0.75
        : 0.35,
      data: c
    }));
  }

  /* -------------------------------------------------------
   * 4) Tüm hafıza sonuçlarını birleştirip sıralamak
   * -----------------------------------------------------*/
  mergeAndRank(allMemorySources, queryEmbedding) {
    // Hepsini tek dizi yap
    const all = [
      ...allMemorySources.episodic,
      ...allMemorySources.semantic,
      ...allMemorySources.structured,
      ...allMemorySources.longTerm
    ];

    // Legacy: semantic kayıtlar zaten kendi distance skoruyla geliyor
    // diğerlerini normalize edeceğiz

    const normalized = all.map(item => {
      let finalScore = item.score;

      // Semantic ise distance'ın etkisi zaten var
      if (item.type !== "semantic") {
        // Score boost: eğer item.data içinde çok yakın bir eşleşme varsa
        const dataStr = JSON.stringify(item.data).toLowerCase();
        const msgStr = JSON.stringify(queryEmbedding).toLowerCase();

        if (dataStr.includes(msgStr.slice(0, 8))) {
          finalScore += 0.2;
        }
      }

      return { ...item, finalScore };
    });

    // Skora göre sırala
    return normalized.sort((a, b) => b.finalScore - a.finalScore).slice(0, 10);
  }

  /* -------------------------------------------------------
   * 5) Final context string oluşturma
   * -----------------------------------------------------*/
  buildContextString(items) {
    return items
      .map(i => {
        switch (i.type) {
          case "episodic":
            return `[EPISODIC] ${i.data.role}: ${i.data.text}`;
          case "semantic":
            return `[SEMANTIC] ${i.data.originalText}`;
          case "structured_project":
            return `[PROJECT] ${i.data.title || i.data.id}`;
          case "structured_plan":
            return `[PLAN] ${i.data.plan?.planTitle}`;
          case "structured_task":
            return `[TASK] ${i.data.goal}`;
          case "long_term":
            return `[LONGTERM] ${i.data.category}: ${i.data.summary}`;
        }
      })
      .filter(Boolean)
      .join("\n");
  }
}
