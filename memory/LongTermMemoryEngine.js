// ===== memory/LongTermMemoryEngine.js =====

import fs from "fs";
import path from "path";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { MemoryWriter } from "./MemoryWriter.js";
import { MemoryRetriever } from "./MemoryRetriever.js";
import { MemorySchemas } from "./MemorySchemas.js";

/**
 * LongTermMemoryEngine (HYBRID)
 * ----------------------------------------------------------
 * 3 tip hafıza yönetir:
 *
 * 1) Episodic Memory:
 *    - Konuşmalar, task'lar, pipeline sonuçları
 *
 * 2) Semantic / Vector Memory:
 *    - Embedding + nearest matching
 *
 * 3) Structured Memory:
 *    - Kalıcı kurallar, tercihler, alışkanlıklar
 *
 * Her modül kendi dosya dizininde çalışır,
 * bu engine hepsini tek API altında birleştirir.
 */

export class LongTermMemoryEngine {
  constructor(config = {}) {
    // Memory klasörleri
    this.dir = path.resolve(process.cwd(), "memory_data");
    this.episodicFile = path.join(this.dir, "episodic.json");
    this.semanticFile = path.join(this.dir, "semantic.json");
    this.structuredFile = path.join(this.dir, "structured.json");

    // Varsayılan ayarlar
    this.maxEpisodic = config.maxEpisodic ?? 500;
    this.maxSemantic = config.maxSemantic ?? 500;

    // Alt modüller
    this.embedder = new EmbeddingStore(this.semanticFile);
    this.writer = new MemoryWriter(
      this.episodicFile,
      this.semanticFile,
      this.structuredFile
    );
    this.retriever = new MemoryRetriever(
      this.episodicFile,
      this.semanticFile,
      this.structuredFile
    );

    this.schemas = new MemorySchemas();

    this._init();
  }

  _init() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }

    if (!fs.existsSync(this.episodicFile)) {
      fs.writeFileSync(this.episodicFile, JSON.stringify([]));
    }
    if (!fs.existsSync(this.semanticFile)) {
      fs.writeFileSync(this.semanticFile, JSON.stringify([]));
    }
    if (!fs.existsSync(this.structuredFile)) {
      fs.writeFileSync(this.structuredFile, JSON.stringify(this.schemas.default));
    }
  }

  /* ------------------------------------------------------------
   * PUBLIC API
   * ----------------------------------------------------------*/

  /**
   * Uzun vadeli hafızaya yeni bir bilgi kaydeder
   *
   * @param {"episodic"|"semantic"|"structured"} type
   * @param {object|string} payload
   */
  async store(type, payload, meta = {}) {
    if (type === "episodic") return this._storeEpisodic(payload, meta);
    if (type === "semantic") return this._storeSemantic(payload, meta);
    if (type === "structured") return this._storeStructured(payload);
    throw new Error(`Unknown memory type: ${type}`);
  }

  /**
   * Bellekten bağlam geri çağırır.
   * Birkaç farklı türde context döner.
   */
  async retrieve(query, options = {}) {
    const episodic = await this.retriever.retrieveEpisodic(query, options);
    const semantic = await this.retriever.retrieveSemantic(query, options);
    const structured = await this.retriever.retrieveStructured(query, options);

    return {
      episodic,
      semantic,
      structured,
    };
  }

  /* ------------------------------------------------------------
   * EPISODIC MEMORY
   * ----------------------------------------------------------*/
  async _storeEpisodic(payload, meta) {
    const entry = {
      id: `ep_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      text:
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2),
      meta: meta || {},
      createdAt: new Date().toISOString(),
    };

    await this.writer.writeEpisodic(entry, this.maxEpisodic);
    return entry;
  }

  /* ------------------------------------------------------------
   * SEMANTIC / VECTOR MEMORY
   * ----------------------------------------------------------*/
  async _storeSemantic(payload, meta) {
    const text =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload, null, 2);

    const embedding = await this.embedder.generateEmbedding(text);

    const entry = {
      id: `sem_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      text,
      embedding,
      meta: meta || {},
      createdAt: new Date().toISOString(),
    };

    await this.writer.writeSemantic(entry, this.maxSemantic);
    return entry;
  }

  /* ------------------------------------------------------------
   * STRUCTURED MEMORY
   * ----------------------------------------------------------*/
  async _storeStructured(payload) {
    const structured = this.retriever.loadStructured();
    const updated = {
      ...structured,
      ...payload,
    };
    await this.writer.writeStructured(updated);
    return updated;
  }
}
