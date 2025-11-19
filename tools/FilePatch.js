// ===== tools/FilePatch.js =====

import fs from "fs/promises";
import path from "path";

export class FilePatchTool {
  constructor() {
    this.name = "FilePatch";
  }

  /**
   * input = {
   *   path: "src/app.js",
   *   find: "eski içerik",
   *   replace: "yeni içerik"
   * }
   */
  async execute(input = {}) {
    const target = input.path;
    const find = input.find;
    const replace = input.replace;

    if (!target || !find) {
      return {
        ok: false,
        error: "FilePatch: path ve find zorunludur",
      };
    }

    try {
      const abs = path.resolve(process.cwd(), target);
      let data = await fs.readFile(abs, "utf-8");

      if (!data.includes(find)) {
        return {
          ok: false,
          path: target,
          error: "Aranan ifade dosyada bulunamadı.",
        };
      }

      const newData = data.replace(find, replace || "");

      await fs.writeFile(abs, newData, "utf-8");

      return {
        ok: true,
        path: target,
        replaced: true,
        beforeLength: data.length,
        afterLength: newData.length,
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
