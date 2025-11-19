// ===== tools/FileWrite.js =====

import fs from "fs/promises";
import path from "path";

export class FileWriteTool {
  constructor() {
    this.name = "FileWrite";
  }

  /**
   * input = {
   *   path: "src/app.js",
   *   content: "console.log('hello');",
   *   mode: "overwrite" | "append"
   * }
   */
  async execute(input = {}) {
    const target = input.path;
    const content = input.content || "";
    const mode = input.mode || "overwrite";

    if (!target) {
      return {
        ok: false,
        error: "FileWrite: 'path' parametresi eksik",
      };
    }

    try {
      const abs = path.resolve(process.cwd(), target);

      // Klasör yoksa oluştur
      await fs.mkdir(path.dirname(abs), { recursive: true });

      if (mode === "append") {
        await fs.appendFile(abs, content, "utf-8");
      } else {
        await fs.writeFile(abs, content, "utf-8");
      }

      return {
        ok: true,
        path: target,
        mode,
        length: content.length,
      };
    } catch (err) {
      return {
        ok: false,
        path: target,
        error: String(err),
      };
    }
  }
}
