// ===== tools/FileRead.js =====

import fs from "fs/promises";
import path from "path";

export class FileReadTool {
  constructor() {
    this.name = "FileRead";
  }

  /**
   * input = { path: "src/index.js" }
   */
  async execute(input = {}) {
    const target = input.path;

    if (!target) {
      return {
        ok: false,
        error: "FileRead: 'path' parametresi eksik",
      };
    }

    try {
      const abs = path.resolve(process.cwd(), target);
      const data = await fs.readFile(abs, "utf-8");
      return {
        ok: true,
        path: target,
        content: data,
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
