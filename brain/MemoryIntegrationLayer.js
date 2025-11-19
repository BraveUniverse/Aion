// ===== brain/MemoryIntegrationLayer.js =====

/**
 * MemoryIntegrationLayer
 * -------------------------------------------------------
 * Görev:
 *  - AION'un beyni ile uzun vadeli hafıza katmanını bağlamak.
 *
 * Yaptığı işler:
 *  1) Kullanıcı / asistan mesajlarını episodic + semantic memory'e yazmak
 *  2) Task + Pipeline sonuçlarını long-term memory'e kaydetmek
 *  3) LLM çağrıları için "hybrid context" hazırlamak
 *
 * Not:
 *  - Mevcut kodlarını BOZMAMAK için:
 *    * Mevcut appendMemory / messages.json yapısı aynen çalışmaya devam ediyor.
 *    * Bu katman ekstra olarak memory_data/ altına uzun vadeli kayıtlar tutuyor.
 */

import fs from "fs";
import path from "path";

import { MemoryWriter } from "../memory/MemoryWriter.js";
import { MemoryReader } from "../memory/MemoryReader.js";
import { MemoryOrchestrator } from "../memory/MemoryOrchestrator.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export class MemoryIntegrationLayer {
  constructor(config = {}) {
    // Tüm long-term dosyaları burada:
    this.baseDir =
      config.baseDir || path.resolve(process.cwd(), "memory_data");

    this.paths = {
      episodic: path.join(this.baseDir, "episodic.json"),
      semantic: path.join(this.baseDir, "semantic.sqlite"),
      structured: path.join(this.baseDir, "structured.json"),
    };

    this._ensureFiles();

    // Yazma & okuma katmanları
    this.writer = new MemoryWriter(this.paths);
    this.reader = new MemoryReader(this.paths);

    // Hybrid context için (episodic + structured vs.)
    this.orchestrator = new MemoryOrchestrator();
  }

  /* ------------------------------------------------------------
   * INIT: klasör + dosyaları garanti et
   * ----------------------------------------------------------*/
  _ensureFiles() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (!fs.existsSync(this.paths.episodic)) {
      fs.writeFileSync(this.paths.episodic, JSON.stringify([]));
    }

    // semantic.sqlite yoksa EmbeddingStore kendi içinde init edecek
    if (!fs.existsSync(this.paths.semantic)) {
      fs.writeFileSync(this.paths.semantic, "");
    }

    if (!fs.existsSync(this.paths.structured)) {
      fs.writeFileSync(this.paths.structured, JSON.stringify({}));
    }
  }

  /* ------------------------------------------------------------
   * 1) Kullanıcı / Asistan mesajlarını kaydetme
   * ----------------------------------------------------------*/

  /**
   * Kullanıcı mesajını uzun vadeli hafızaya işler.
   *
   * NOT:
   *  - runAION zaten messages.json'a yazıyor (appendMemory ile).
   *  - Burada ekstra olarak episodic + semantic.json/DB'ye kaydediyoruz.
   */
  async storeUserMessage(text, meta = {}) {
    if (!text || !text.trim()) return;

    // Episodic: ham kayıt
    this.writer.appendEpisodic({
      role: "user",
      text,
      meta: {
        ...meta,
        source: "user",
      },
    });

    // Semantic: embedding tabanlı uzun vadeli
    try {
      await this.writer.appendSemantic("user_message", text, {
        role: "user",
        ...meta,
      });
    } catch (err) {
      console.error("MemoryIntegration storeUserMessage semantic error:", err);
    }
  }

  /**
   * Asistan (AION) cevabını uzun vadeli hafızaya işler.
   */
  async storeAssistantMessage(text, meta = {}) {
    if (!text || !text.trim()) return;

    this.writer.appendEpisodic({
      role: "assistant",
      text,
      meta: {
        ...meta,
        source: "assistant",
      },
    });

    try {
      await this.writer.appendSemantic("assistant_message", text, {
        role: "assistant",
        ...meta,
      });
    } catch (err) {
      console.error(
        "MemoryIntegration storeAssistantMessage semantic error:",
        err
      );
    }
  }

  /**
   * Kolaylık için tek fonksiyon:
   *  - userMessage
   *  - assistantMessage (opsiyonel, henüz yoksa null geçebilirsin)
   */
  async recordTurn({ userMessage, assistantMessage = null, meta = {} }) {
    // Zaten runAION içinde messages.json'a yazıldığı için
    // burada sadece long-term tarafını güçlendiriyoruz.
    await this.storeUserMessage(userMessage, meta);

    if (assistantMessage) {
      await this.storeAssistantMessage(assistantMessage, meta);
    }
  }

  /* ------------------------------------------------------------
   * 2) Task + Pipeline run'larını hafızaya yazma
   * ----------------------------------------------------------*/

  /**
   * Bir Task + Pipeline run'ı bittiğinde çağrılır.
   *
   * Burada:
   *  - episodic'e kısa özet
   *  - semantic'e detaylı özet
   *  - structured.json içine task index'i (isteğe bağlı)
   */
  async recordTaskRun(taskSpec, pipelineSpec, pipelineResult) {
    const status = pipelineResult?.status || "unknown";

    // Kısa özet string'i oluştur
    const shortSummary = `[TASK-RUN] ${taskSpec.type} | goal: ${
      taskSpec.goal
    } | status: ${status}`;

    // episodic kayıt
    this.writer.appendEpisodic({
      role: "system",
      text: shortSummary,
      meta: {
        kind: "task_run",
        taskId: taskSpec.id,
        projectId: taskSpec.projectId || null,
        status,
      },
    });

    // semantic kayıt için daha detaylı bir gövde
    const richText = JSON.stringify(
      {
        taskSpec,
        pipelineSpec,
        pipelineResult,
      },
      null,
      2
    );

    try {
      await this.writer.appendSemantic("task_run", richText, {
        taskId: taskSpec.id,
        projectId: taskSpec.projectId || null,
        status,
      });
    } catch (err) {
      console.error("MemoryIntegration recordTaskRun semantic error:", err);
    }

    // İsteğe bağlı: structured index
    try {
      const structuredPath = this.paths.structured;
      let structured = {};
      if (fs.existsSync(structuredPath)) {
        structured = JSON.parse(fs.readFileSync(structuredPath, "utf8"));
      }

      const taskKey = `task_${taskSpec.id}`;

      structured[taskKey] = {
        goal: taskSpec.goal,
        type: taskSpec.type,
        projectId: taskSpec.projectId || null,
        lastStatus: status,
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(structuredPath, JSON.stringify(structured, null, 2));
    } catch (err) {
      console.error("MemoryIntegration recordTaskRun structured error:", err);
    }

    // Legacy log dosyasına da küçük bir iz bırakmak istersen:
    appendMemory("long_term_task_runs.json", {
      taskId: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      status,
      createdAt: new Date().toISOString(),
    });
  }

  /* ------------------------------------------------------------
   * 3) Reasoner için context hazırlama
   * ----------------------------------------------------------*/

  /**
   * LLM çağrılarından önce kullanabileceğin helper:
   *
   *  - MemoryOrchestrator üzerinden:
   *      episodic + structured + (ileride semantic) karışık contextPack üretir.
   *
   * Dönüş:
   *  {
   *    contextPack: "LLM'e koyulacak metin",
   *    sources: [...],
   *    rawHybrid: {...}
   *  }
   */
  async buildContextForReasoner(userMessage) {
    // Hybrid context (MemoryOrchestrator) — episodic + structured + categories
    let hybrid = null;
    try {
      hybrid = await this.orchestrator.buildContextPack(userMessage);
    } catch (err) {
      console.error("MemoryIntegration buildContextForReasoner error:", err);
    }

    // hybrid yoksa basit fallback: messages.json'dan son 10 entry
    if (!hybrid || !hybrid.contextPack) {
      const msgs = (await this._readLegacyMessages()) || [];
      const last = msgs.slice(-10);
      const contextPack = last
        .map((m) => `[${m.role}] ${m.text}`)
        .join("\n");

      return {
        contextPack,
        sources: [],
        rawHybrid: null,
      };
    }

    return {
      contextPack: hybrid.contextPack,
      sources: hybrid.sources,
      rawHybrid: hybrid,
    };
  }

  async _readLegacyMessages() {
    try {
      const file = path.resolve(process.cwd(), "messages.json");
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
