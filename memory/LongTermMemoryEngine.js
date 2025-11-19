// ===== memory/LongTermMemoryEngine.js =====

import fs from "fs";
import path from "path";
import { EmbeddingStore } from "./EmbeddingStore.js";

/**
 * LongTermMemoryEngine (HYBRID LTM)
 * ----------------------------------------------------------
 * Görev:
 *  - Özetlenmiş uzun dönem hafıza kayıtlarını tutmak
 *  - Embedding tabanlı arama sağlamak
 *
 * Kullanım:
 *  - storeSummary({ text, summary, tags, source, importance })
 *  - search(query, topK?)
 *
 * Notlar:
 *  - Dosya formatı EmbeddingStore ile uyumludur.
 *  - Her kayıt: { id, text, summary, tags, source, importance, embedding, createdAt }
 */

export class LongTermMemoryEngine {
  /**
   * @param {object|string} config
   *  - string ise: longterm.json dosya yolu
   *  - object ise:
   *      {
   *        file?: string,       // longterm.json yolu
   *        baseDir?: string,    // default: ./memory_data
   *        maxItems?: number
   *      }
   */
  constructor(config = {}) {
    if (typeof config === "string") {
      this.baseDir = path.dirname(config);
      this.filePath = config;
    } else {
      this.baseDir =
        config.baseDir || path.resolve(process.cwd(), "memory_data");
      this.filePath =
        config.file || path.join(this.baseDir, "longterm.json");
    }

    this.maxItems = config.maxItems ?? 500;

    this._ensureFiles();

    // EmbeddingStore: longterm kayıtlarını buradan yönetir
    this.store = new EmbeddingStore(this.filePath);
  }

  /* ------------------------------------------------------------
   * Init
   * ----------------------------------------------------------*/
  _ensureFiles() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify([]));
      }
    } catch (err) {
      console.error("LongTermMemoryEngine init error:", err);
    }
  }

  /* ------------------------------------------------------------
   * PUBLIC: Generic store interface (opsiyonel)
   * ----------------------------------------------------------*/
  /**
   * Generic store wrapper — şimdilik summary'ye yönlendiriyor.
   * @param {string} kind
   * @param {object} payload
   * @param {object} meta
   */
  async store(kind, payload = {}, meta = {}) {
    // Şimdilik tek anlamlı tür: "summary" / "longterm"
    if (kind === "summary" || kind === "longterm") {
      return this.storeSummary(payload, meta);
    }

    // Diğer her şey de summary olarak işlenir
    return this.storeSummary(payload, meta);
  }

  /* ------------------------------------------------------------
   * PUBLIC: Uzun dönem özet kaydı
   * ----------------------------------------------------------*/
  /**
   * Uzun dönem hafızaya yeni bir özet kaydı ekler.
   *
   * @param {object} payload
   *  - text?:   Orijinal ham içerik
   *  - summary: Özet içerik (yoksa text kullanılır)
   *  - tags?:   string[] etiket
   *  - source?: nereden geldi (örn: "pipeline_run", "chat", "plan")
   *  - importance?: 0-1 arası önem skoru
   * @param {object} meta (şimdilik opsiyonel, future use)
   */
  async storeSummary(payload = {}, meta = {}) {
    const {
      text = "",
      summary = "",
      tags = [],
      source = "unknown",
      importance = 0.5,
    } = payload;

    const baseText = summary || text;
    if (!baseText || typeof baseText !== "string") {
      throw new Error("LongTermMemoryEngine.storeSummary: summary/text boş olamaz.");
    }

    try {
      const embedding = await this.store.generateEmbedding(baseText);

      const entry = {
        id: `lt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        text,
        summary: summary || text,
        tags: Array.isArray(tags) ? tags : [],
        source,
        importance: typeof importance === "number" ? importance : 0.5,
        embedding,
        meta,
        createdAt: new Date().toISOString(),
      };

      await this.store.add(entry);
      // Şimdilik maxItems trim işlemini pas geçiyoruz;
      // gerekirse EmbeddingStore içinde yönetilir.

      return entry;
    } catch (err) {
      console.error("LongTermMemoryEngine.storeSummary error:", err);
      throw err;
    }
  }

  /* ------------------------------------------------------------
   * PUBLIC: Arama
   * ----------------------------------------------------------*/
  /**
   * Uzun dönem hafızada embedding tabanlı arama yapar.
   *
   * @param {string} query
   * @param {number} topK
   * @returns {Promise<Array<{id,summary,text,tags,source,score,createdAt}>>}
   */
  async search(query, topK = 5) {
    if (!query || typeof query !== "string") {
      return [];
    }

    try {
      const queryEmbedding = await this.store.generateEmbedding(query);

      const results = this.store.search(queryEmbedding, topK) || [];

      // EmbeddingStore.search çıktısı: [{ item, score }]
      return results.map((r) => {
        const item = r.item || {};
        return {
          id: item.id,
          summary: item.summary || item.text || "",
          text: item.text || "",
          tags: item.tags || [],
          source: item.source || "unknown",
          score: typeof r.score === "number" ? r.score : 0.5,
          importance:
            typeof item.importance === "number" ? item.importance : 0.5,
          createdAt: item.createdAt,
        };
      });
    } catch (err) {
      console.error("LongTermMemoryEngine.search error:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------
   * UTIL: Tüm kayıtları ham olarak okuma (debug vs.)
   * ----------------------------------------------------------*/
  readAllRaw() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}

export default LongTermMemoryEngine;
