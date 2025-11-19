// ===== memory/EmbeddingStore.js =====

import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { runEmbeddingModel } from "../config/models.js";

/**
 * EmbeddingStore
 * ---------------------------------------------------------
 * - semantic memory'nin veri deposu
 * - SQLite + JSON metadata
 * - generateEmbedding(text)
 * - storeItem({ text, meta, embedding })
 * - search(queryEmbedding)
 */

export class EmbeddingStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.dim = 1024; // Default embedding boyutu
  }

  /* --------------------------------------------------------
   * DB INIT
   * ------------------------------------------------------*/
  async _init() {
    if (this.db) return;

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    // Tablo yoksa oluştur
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT,
        meta TEXT,
        embedding BLOB,
        timestamp TEXT
      );
    `);
  }

  /* --------------------------------------------------------
   * EMBEDDING OLUŞTURMA
   * ------------------------------------------------------*/
  async generateEmbedding(text) {
    // 1) Modelle embed oluştur
    const result = await runEmbeddingModel(text);

    if (!result || !Array.isArray(result.embedding)) {
      throw new Error("EmbeddingStore: Geçersiz embedding çıktısı.");
    }

    this.dim = result.embedding.length;

    return Float32Array.from(result.embedding);
  }

  /* --------------------------------------------------------
   * STORE ITEM
   * ------------------------------------------------------*/
  async storeItem({ text, meta, embedding, timestamp }) {
    await this._init();

    const buffer = Buffer.from(embedding.buffer);

    await this.db.run(
      `
      INSERT INTO embeddings (text, meta, embedding, timestamp)
      VALUES (?, ?, ?, ?)
      `,
      text,
      JSON.stringify(meta || {}),
      buffer,
      timestamp
    );
  }

  /* --------------------------------------------------------
   * SEMANTIC SEARCH
   * ------------------------------------------------------*/
  async searchByEmbedding(queryEmbedding, limit = 5) {
    await this._init();

    const rows = await this.db.all(`SELECT * FROM embeddings`);

    if (!rows || rows.length === 0) return [];

    const q = Array.from(queryEmbedding);

    // cosine similarity hesaplama
    const similarities = rows.map((row) => {
      const emb = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const sim = cosineSimilarity(q, emb);
      return { ...row, score: sim };
    });

    // Skora göre sırala
    return similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/* --------------------------------------------------------
 * COSINE SIMILARITY
 * ------------------------------------------------------*/
function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
