// ===== memory/MemoryWriter.js =====

import fs from "fs";
import { EmbeddingStore } from "./EmbeddingStore.js";
import { CategoricalMemory } from "./CategoricalMemory.js";

/**
 * MemoryWriter (Hybrid)
 * -------------------------------------------------------
 * AION'un yazma katmanı.
 *
 * Katmanlar:
 *  - Episodic: Kısa dönem konuşma geçmişi (sınırlı)
 *  - Semantic: Embedding tabanlı uzun dönem hafıza
 *  - Structured: Kalıcı, anahtar-değer bazlı bilgi kartları
 *  - Categorical: Mesaj tipine göre kategorik hafıza
 *
 * Ayrıca:
 *  - Smart Routing (otomatik memory seçimi)
 *  - Duplicate Filtering (embedding similarity check)
 *  - Category autodetection
 */

export class MemoryWriter {
  constructor(paths) {
    this.paths = paths;

    // semantic store
    this.semantic = new EmbeddingStore(paths.semantic);

    // categorical store
    this.categorical = new CategoricalMemory(paths.categorical);
  }

  /* ------------------------------------------------------------
   * PUBLIC: Ana giriş noktası (Smart Hybrid Write)
   * ----------------------------------------------------------*/
  async write(entry) {
    const { type, text, raw } = entry;

    // 1) Episodic her zaman kayıt alır
    this.appendEpisodic(entry);

    // 2) Kategori belirle
    const category = this._inferCategory(type, text);

    // 3) Duplicate check
    const isDup = await this._isDuplicate(text);
    if (isDup) {
      return { ok: false, reason: "duplicate_filtered" };
    }

    // 4) Kategori hafızasına yaz
    this.categorical.add(category, {
      type,
      text,
      raw,
      timestamp: new Date().toISOString(),
    });

    // 5) Semantic embedding’e yaz
    await this.appendSemantic(category, text, raw);

    return { ok: true, category };
  }

  /* ------------------------------------------------------------
   * EPISODIC MEMORY — ham konuşma kaydı (sınırsız büyümez)
   * ----------------------------------------------------------*/
  appendEpisodic(entry, maxCount = 300) {
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

    // kapasite
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

  /* ------------------------------------------------------------
   * CATEGORY INFERENCE (Auto)
   * ----------------------------------------------------------*/
  _inferCategory(type, text) {
    const t = (text || "").toLowerCase();

    if (type === "code" || t.includes("kod") || t.includes("function")) return "coding";
    if (type === "plan" || t.includes("mimari")) return "planning";
    if (t.includes("araştır") || t.includes("research")) return "research";
    if (t.includes("dosya") || t.includes("patch")) return "file_edit";
    if (t.includes("agent oluştur") || type === "agent") return "agent";
    if (t.includes("pipeline")) return "pipeline";

    return "general";
  }

  /* ------------------------------------------------------------
   * DUPLICATE FILTER — semantic similarity check
   * ----------------------------------------------------------*/
  async _isDuplicate(text) {
    try {
      const similars = await this.semantic.query(text, { topK: 3, threshold: 0.92 });
      return similars.length > 0;
    } catch (err) {
      return false;
    }
  }
}
