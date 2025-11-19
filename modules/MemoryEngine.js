// ===== modules/MemoryEngine.js =====

import fs from "fs/promises";
import path from "path";

/**
 * AION MemoryEngine
 * -------------------------------------------------------
 * Görev: Tüm JSON tabanlı hafızayı yönetmek.
 *
 * Özellikler:
 * - Güvenli okuma/yazma (readMemory, writeMemory)
 * - Append-only log memory (appendMemory)
 * - Otomatik memory klasörü oluşturma
 * - JSON dosyası bozuksa fallback + otomatik tamir
 * - Path traversal koruması
 * - Basit lock sistemi (aynı anda iki yazma engellenir)
 */

const MEMORY_DIR = path.resolve(process.cwd(), "memory");
const locks = new Set();

/* --------------------------------------------
 * Memory klasörü var mı? Yoksa oluştur
 * -------------------------------------------- */
async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

/* --------------------------------------------
 * Dosya yolunu güvenle oluştur
 * -------------------------------------------- */
function safePath(fileName) {
  const clean = fileName.replace(/(\.\.[/\\])/g, "").replace(/^[/\\]+/, "");
  return path.resolve(MEMORY_DIR, clean);
}

/* --------------------------------------------
 * LOCK Mekanizması
 * -------------------------------------------- */
async function acquireLock(fileName) {
  while (locks.has(fileName)) {
    await new Promise((res) => setTimeout(res, 10));
  }
  locks.add(fileName);
}

function releaseLock(fileName) {
  locks.delete(fileName);
}

/* --------------------------------------------
 * readMemory(fileName)
 * -------------------------------------------- */
export async function readMemory(fileName) {
  await ensureMemoryDir();
  const filePath = safePath(fileName);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(raw);
    return json;
  } catch (err) {
    // Dosya yoksa boş data döndür
    if (err.code === "ENOENT") {
      return null;
    }

    // JSON bozuksa: backup oluştur ve boş döndür
    const brokenBackup = filePath + ".broken_" + Date.now();
    await fs.copyFile(filePath, brokenBackup);
    console.error(
      `MemoryEngine: JSON bozuk → yedek oluşturuldu: ${brokenBackup}`
    );

    return null;
  }
}

/* --------------------------------------------
 * writeMemory(fileName, data)
 * -------------------------------------------- */
export async function writeMemory(fileName, data) {
  await ensureMemoryDir();
  const filePath = safePath(fileName);

  await acquireLock(fileName);

  try {
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, json, "utf-8");
  } finally {
    releaseLock(fileName);
  }
}

/* --------------------------------------------
 * appendMemory(fileName, entry)
 * --------------------------------------------
 * Log tarzı hafıza:
 * - Her entry array'e eklenir
 * - Dosya yoksa [entry] olarak oluşturulur
 */
export async function appendMemory(fileName, entry) {
  await ensureMemoryDir();
  const filePath = safePath(fileName);

  await acquireLock(fileName);

  try {
    let existing = [];

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    } catch (err) {
      existing = [];
    }

    existing.push({
      ...entry,
      _ts: new Date().toISOString(),
    });

    const json = JSON.stringify(existing, null, 2);
    await fs.writeFile(filePath, json, "utf-8");
  } finally {
    releaseLock(fileName);
  }
}

/* --------------------------------------------
 * clearMemory(fileName) — isteğe bağlı yardımcı fonksiyon
 * -------------------------------------------- */
export async function clearMemory(fileName) {
  await ensureMemoryDir();
  const filePath = safePath(fileName);
  await fs.writeFile(filePath, "[]", "utf-8");
}
