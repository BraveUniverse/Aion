// ===== utils/text.js =====

/**
 * Temiz bir trim — normal trim’den daha agresif.
 */
export function cleanText(str) {
  if (!str) return "";
  return String(str)
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/ +/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * LLM çıktısından ilk geçerli JSON objesini ayıklar.
 * "{ ... }" aralığını bulup JSON.parse yapmaya çalışır.
 */
export function extractJson(text) {
  if (!text) return null;
  text = String(text);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const slice = text.slice(start, end + 1);

  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * LLM çıktısını "kod bloğu" olmadan verir.
 * ```js
 *   kodlar
 * ```
 * gibi blokları temizler.
 */
export function stripCodeFences(text) {
  if (!text) return "";

  return text
    .replace(/```[\s\S]*?```/g, (match) =>
      match.replace(/```.*?\n?/, "").replace(/```$/, "")
    )
    .trim();
}

/**
 * LLM bazen şöyle verir:
 * {
 *  "a": 1
 * }
 * 
 * {  ile başlıyor ama başında markdown/yorum var.
 * Bu fonksiyon baştaki çöpü temizler.
 */
export function cleanLeadingGarbage(text) {
  if (!text) return "";

  // İlk '{' öncesindeki her şeyi at
  const idx = text.indexOf("{");
  if (idx > 0) return text.slice(idx);
  return text;
}

/**
 * Hem kod bloklarını temizle + JSON’u çek + fallback
 */
export function extractJsonSafe(text) {
  if (!text) return null;

  let cleaned = stripCodeFences(text);
  cleaned = cleanLeadingGarbage(cleaned);

  try {
    const json = extractJson(cleaned);
    if (json) return json;
  } catch {}

  return null;
}

/**
 * Kod bloklarını çıkarır ama sadece kodu döndürür.
 */
export function extractCodeBlock(text) {
  if (!text) return "";

  const match = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Kod bloğu yoksa tam metni döndür
  return text.trim();
}

/**
 * Bir string içindeki tüm JSON bloklarını çıkarır.
 * Çok nadir gereken durumlar için.
 */
export function extractAllJsonBlocks(text) {
  const matches = [...text.matchAll(/\{[\s\S]*?\}/g)];
  const results = [];

  for (const m of matches) {
    try {
      results.push(JSON.parse(m[0]));
    } catch {}
  }

  return results;
}

/**
 * LLM çıktısında triple-json çöplüğü varsa en büyük JSON'u seç.
 */
export function extractLargestJson(text) {
  const candidates = extractAllJsonBlocks(text);
  if (candidates.length === 0) return null;

  return candidates.reduce((a, b) =>
    JSON.stringify(b).length > JSON.stringify(a).length ? b : a
  );
}

/**
 * LLM "Sure! Here is the JSON:" gibi şeyler ekler.
 * Bu fonksiyon sadece JSON’u çeker, geri kalanını temizler.
 */
export function forceJson(text, fallback = {}) {
  if (!text) return fallback;

  const extracted = extractJsonSafe(text);
  if (extracted) return extracted;

  const largest = extractLargestJson(text);
  if (largest) return largest;

  return fallback;
}

/**
 * Çok uzun LLM çıkışlarını kısaltır.
 */
export function shorten(text, max = 2000) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...\n[TRUNCATED]";
}
