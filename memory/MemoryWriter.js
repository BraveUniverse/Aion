// ===== memory/MemoryWriter.js =====

import fs from "fs";
import { EmbeddingStore } from "./EmbeddingStore.js";

/**
 * MemoryWriter
 * -------------------------------------------------------
 * AION'un yazma katmanı.
 *
 * 3 memory alanını yönetir:
 *  - episodic.json     (ham konuşma geçmişi)
 *  - semantic.json     (embedding tabanlı uzun süreli hafıza)
 *  - structured.json   (bilgi kartları, kalıcı bilgiler)
 *
 * Okuma/Temizleme MemoryEngine'de,
 * Yazma MemoryWriter'da.
 */

export class MemoryWriter {
  constructor(paths) {
    this.paths = paths;

    // semantic store
    this.semantic = new EmbeddingStore(paths.semantic);
  }

  /* ------------------------------------------------------------
   * EPISODIC MEMORY — ham konuşma kaydı (sınırsız büyümez)
   * ----------------------------------------------------------*/
  appendEpisodic(entry, maxCount = 200) {
    let data = [];

    try {
      if (fs.existsSync(this.paths.episodic)) {
        data = JSON.parse(fs.readFileSync(this.paths.episodic, "utf8"));
      }
    } catch (err) {
      console.error("MemoryWriter episodic load error:", err);
    }

    data.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    // kapasite kontrolü
    if (data.length > maxCount) {
      data = data.slice(data.length - maxCount);
    }

    try {
      fs.writeFileSync(this.paths.episodic, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("MemoryWriter episodic write error:", err);
    }
  }

  /* ------------------------------------------------------------
   * SEMANTIC MEMORY — embedding tabanlı uzun süreli hafıza
   * ----------------------------------------------------------*/
  async appendSemantic(type, text, raw = null) {
    try {
      const embedding = await this.semantic.generateEmbedding(text);

      this.semantic.add({
        type,
        text,
        raw,
        embedding,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("MemoryWriter semantic write error:", err);
    }
  }

  /* ------------------------------------------------------------
   * STRUCTURED MEMORY — bilgi kartları
   *
   * “UserFact”, “Project”, “Rule”, “Setting” gibi
   * kalıcı yapısal bilgiler burada tutulur.
   * ----------------------------------------------------------*/
  writeStructured(key, value) {
    let data = {};

    try {
      if (fs.existsSync(this.paths.structured)) {
        data = JSON.parse(fs.readFileSync(this.paths.structured, "utf8"));
      }
    } catch (err) {
      console.error("MemoryWriter structured read error:", err);
    }

    data[key] = {
      value,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.paths.structured, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("MemoryWriter structured write error:", err);
    }
  }
}
