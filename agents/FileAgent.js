// ===== agents/FileAgent.js =====

import fs from "fs/promises";
import path from "path";
import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * FileAgent
 * -------------------------------------------------------
 * Dosya okuma, yazma, patch uygulama gibi işleri yapar.
 *
 * input örnek:
 * {
 *   taskGoal: "...",
 *   taskDetails: {
 *     operation: "read" | "write" | "patch",
 *     baseDir: "./aioncodes/BraveUniverse",
 *     filePath: "src/app/page.tsx",
 *     content: "yazılacak içerik",
 *     patchInstructions: "header'a login butonu ekle"
 *   }
 * }
 */

export class FileAgent {
  async run(input, context = {}) {
    const { taskGoal, taskDetails = {} } = input;
    const {
      operation = "read",
      baseDir = process.cwd(),
      filePath,
      content,
      patchInstructions,
    } = taskDetails;

    if (!filePath) {
      throw new Error("FileAgent: filePath gerekli.");
    }

    const absPath = path.resolve(baseDir, filePath);
    let result;

    if (operation === "read") {
      const fileContent = await this.safeRead(absPath);
      result = {
        type: "file_read",
        path: absPath,
        content: fileContent,
      };
    } else if (operation === "write") {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content ?? "", "utf-8");
      result = {
        type: "file_write",
        path: absPath,
        bytes: Buffer.from(content ?? "", "utf-8").length,
      };
    } else if (operation === "patch") {
      const oldContent = await this.safeRead(absPath);
      const newContent = await this.applyPatch(oldContent, patchInstructions, taskGoal);
      await fs.writeFile(absPath, newContent, "utf-8");
      result = {
        type: "file_patch",
        path: absPath,
        oldBytes: Buffer.from(oldContent, "utf-8").length,
        newBytes: Buffer.from(newContent, "utf-8").length,
      };
    } else {
      throw new Error(`FileAgent: Bilinmeyen operation: ${operation}`);
    }

    appendMemory("file_agent_outputs.json", {
      operation,
      path: absPath,
      taskGoal,
      createdAt: new Date().toISOString(),
    });

    return result;
  }

  async safeRead(absPath) {
    try {
      const data = await fs.readFile(absPath, "utf-8");
      return data;
    } catch (e) {
      // Dosya yoksa boş string dönebiliriz
      return "";
    }
  }

  async applyPatch(oldContent, patchInstructions, taskGoal) {
    const systemPrompt = `
Sen AION'un File Patch modülüsün.

Görev:
Mevcut dosya içeriğini ve verilen patch talimatlarını kullanarak
YENİ bir dosya içeriği üretmek.

Kurallar:
- Eski içeriği temel al
- Sadece gerekli değişiklikleri yap
- Tüm çıktı sadece yeni dosya içeriği olmalı
`.trim();

    const userPrompt = `
Görev:
${taskGoal}

Patch talimatları:
${patchInstructions}

Eski dosya içeriği:
${oldContent}
`;

    const patched = await runReasoner(systemPrompt, userPrompt);
    return patched;
  }
}
