// ===== memory/MemoryEngine.js =====

import fs from "fs";
import path from "path";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { MemoryReader } from "./MemoryReader.js";

/**
 * Hybrid Memory Engine
 * -------------------------------------------------------
 * 3 hafıza bölgesini yönetir:
 *  - episodic.json
 *  - semantic (embeddings.db)
 *  - structured.json
 *
 * AION’un tüm katmanları tek API üzerinden bu modülü kullanır.
 */

export class MemoryEngine {
  constructor(baseDir = "./memory_store") {
    this.baseDir = baseDir;

    this.paths = {
      episodic: path.join(baseDir, "episodic.json"),
      structured: path.join(baseDir, "structured.json"),
      semantic: path.join(baseDir, "semantic.db"), // EmbeddingStore DB
    };

    // Bellek dosyalarını hazırlayalım
    this._ensureFiles();

    // Modüller
    this.embeddingStore = new EmbeddingStore(this.paths.semantic);
    this.reader = new MemoryReader(this.paths);
  }

  /* ------------------------------------------------------------
   * DOSYA OLUŞTURMA
   * ----------------------------------------------------------*/
  _ensureFiles() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (!fs.existsSync(this.paths.episodic)) {
      fs.writeFileSync(this.paths.episodic, "[]");
    }

    if (!fs.existsSync(this.paths.structured)) {
      fs.writeFileSync(this.paths.structured, "{}");
    }

    // semantic DB (sqlite) EmbeddingStore tarafından yönetiliyor
  }

  /* ------------------------------------------------------------
   * 1) EPISODIC MEMORY YAZMA
   * ----------------------------------------------------------*/
  appendEpisodicMemory(event) {
    const arr = JSON.parse(fs.readFileSync(this.paths.episodic, "utf8"));

    arr.push({
      ...event,
      timestamp: new Date().toISOString(),
    });

    fs.writeFileSync(this.paths.episodic, JSON.stringify(arr, null, 2));
  }

  /* ------------------------------------------------------------
   * 2) STRUCTURED MEMORY YAZMA (kalıcı bilgi)
   * ----------------------------------------------------------*/
  writeStructured(key, value) {
    const obj = JSON.parse(fs.readFileSync(this.paths.structured, "utf8"));

    obj[key] = {
      value,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(this.paths.structured, JSON.stringify(obj, null, 2));
  }

  readStructured() {
    try {
      return JSON.parse(fs.readFileSync(this.paths.structured, "utf8"));
    } catch {
      return {};
    }
  }

  /* ------------------------------------------------------------
   * 3) SEMANTIC MEMORY YAZMA
   * ----------------------------------------------------------*/
  async storeSemantic(text, meta = {}) {
    const embedding = await this.embeddingStore.generateEmbedding(text);

    this.embeddingStore.storeItem({
      text,
      meta,
      embedding,
      timestamp: new Date().toISOString(),
    });
  }

  /* ------------------------------------------------------------
   * 4) HYBRID MEMORY OKUMA (tek API)
   * ----------------------------------------------------------*/
  async recall(queryText) {
    return this.reader.recall(queryText);
  }

  /* ------------------------------------------------------------
   * 5) AUTO MEMORY ROUTING
   *    → AION hangi içeriği hangi hafızaya yazmalı?
   * ----------------------------------------------------------*/
  async smartStore(event) {
    const { type, text, data, importance } = event;

    // 1) Chat veya düşünce → episodic
    if (type === "conversation" || type === "internal_note") {
      return this.appendEpisodicMemory({
        type,
        text,
        data,
      });
    }

    // 2) Niyet, plan, teknik bilgi → semantic
    if (type === "semantic" || importance === "high") {
      return this.storeSemantic(text, data || {});
    }

    // 3) Kalıcı bilgi → structured
    if (type === "structured") {
      return this.writeStructured(event.key, event.value);
    }

    // default episodic
    return this.appendEpisodicMemory(event);
  }

  /* ------------------------------------------------------------
   * 6) AUTO CLEAN-UP — episodic’i hafif tut
   * ----------------------------------------------------------*/
  cleanEpisodic(limit = 500) {
    const arr = JSON.parse(fs.readFileSync(this.paths.episodic, "utf8"));
    if (arr.length <= limit) return;

    const sliced = arr.slice(arr.length - limit);
    fs.writeFileSync(this.paths.episodic, JSON.stringify(sliced, null, 2));
  }

  /* ------------------------------------------------------------
   * 7) High-level integration:
   * ----------------------------------------------------------*/
  async logInteraction(userMessage, aiResponse) {
    await this.smartStore({
      type: "conversation",
      text: userMessage,
    });

    await this.smartStore({
      type: "internal_note",
      text: aiResponse,
    });

    this.cleanEpisodic(500);
  }
}

/* ------------------------------------------------------------
 * TEKTONİK EXPORT — tüm sistem bunu kullanıyor
 * ----------------------------------------------------------*/

export const AIONMemory = new MemoryEngine();
