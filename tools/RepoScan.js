// ===== tools/RepoScan.js =====

import fs from "fs/promises";
import path from "path";

export class RepoScanTool {
  constructor() {
    this.name = "RepoScan";
  }

  /**
   * input = {
   *   root: "./src",
   *   maxFiles: 200,
   *   includeContent: false
   * }
   */
  async execute(input = {}) {
    const root = input.root || ".";
    const includeContent = input.includeContent || false;
    const maxFiles = input.maxFiles || 200;

    const absRoot = path.resolve(process.cwd(), root);

    let result = [];
    let counter = 0;

    async function walk(dir) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const it of items) {
        if (counter >= maxFiles) return;

        const fullPath = path.join(dir, it.name);

        if (it.isDirectory()) {
          await walk(fullPath);
        } else {
          counter++;
          const rel = path.relative(absRoot, fullPath);

          let entry = { path: rel };

          if (includeContent) {
            try {
              entry.content = await fs.readFile(fullPath, "utf-8");
            } catch {
              entry.content = null;
            }
          }

          result.push(entry);
        }
      }
    }

    try {
      await walk(absRoot);
      return {
        ok: true,
        root,
        count: result.length,
        files: result,
      };
    } catch (err) {
      return {
        ok: false,
        root,
        error: String(err),
      };
    }
  }
}
