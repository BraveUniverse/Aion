#!/usr/bin/env node

// ===== cli.js - AION Interactive Terminal Interface =====

import readline from "readline";
import chalk from "chalk";

import { AION } from "./AION.js";
import { appendMemory } from "./modules/MemoryEngine.js";

// CLI arayüzü oluştur
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.magenta("AION> "),
});

console.clear();
console.log(chalk.cyanBright("╔══════════════════════════════════════════════╗"));
console.log(chalk.cyanBright("║           AION Multi-Agent Terminal          ║"));
console.log(chalk.cyanBright("╚══════════════════════════════════════════════╝"));
console.log(chalk.gray("Yardım için: help\n"));
rl.prompt();

// AION instance (tam beyin)
const aion = new AION();

/* ------------------------------------------------------------
 * Komut yorumlayıcı
 * ------------------------------------------------------------ */
async function handleCommand(input) {
  const raw = input.trim();

  if (!raw) return;

  if (raw === "exit" || raw === "quit") {
    console.log(chalk.yellow("Çıkış yapılıyor..."));
    process.exit(0);
  }

  if (raw === "help") {
    console.log(`
${chalk.cyanBright("AION CLI Komutları")}
----------------------------------
help       : Komut listesini gösterir
exit/quit  : Uygulamadan çıkar
clear      : Terminali temizler
memory     : Bellek dosyalarını listeler
run        : AION ile konuşup görev işleme modunu kullan
----------------------------------
");
    return;
  }

  if (raw === "clear") {
    console.clear();
    return;
  }

  if (raw === "memory") {
    console.log(chalk.blue("Bellek dosyaları memory klasöründe duruyor."));
    console.log("Örnekler:");
    console.log(" - agent_registry.json");
    console.log(" - task_type_learning.json");
    console.log(" - pipeline_runs.json");
    console.log(" - agent_runs.json");
    console.log(" - interpreted_raw.json");
    console.log("");
    return;
  }

  // “run” ile başlıyorsa dialog başlat
  if (raw === "run") {
    console.log(
      chalk.greenBright("\nGörev modu başladı! AION'a bir şey söyleyebilirsin:\n")
    );
    await conversationLoop();
    return;
  }

  console.log(chalk.red("Bilinmeyen komut. help yazabilirsin.\n"));
}

/* ------------------------------------------------------------
 * AION Görev/Diyalog Döngüsü
 * ------------------------------------------------------------ */
async function conversationLoop() {
  return new Promise((resolve) => {
    const loop = async () => {
      rl.question(chalk.magenta("Sen> "), async (userInput) => {
        const text = userInput.trim();

        if (!text) return loop();

        if (text === "back") {
          console.log(chalk.yellow("Görev modundan çıkıldı.\n"));
          return resolve();
        }

        // AION’a mesaj gönder
        try {
          const result = await aion.handleMessage(text);

          // Görevin türüne göre gösterim
          if (result.mode === "chat") {
            console.log(chalk.whiteBright("\nAION (chat):"));
            console.log(result.reply);
            console.log("");
          } else if (result.mode === "plan") {
            console.log(chalk.blueBright("\nAION PLAN:"));
            console.log(result.plan);
            console.log("");
          } else if (result.mode === "task") {
            console.log(chalk.greenBright("\nAION → TaskSpec oluşturdu:"));
            console.log(JSON.stringify(result.taskSpec, null, 2));

            console.log(chalk.yellow("\nPipeline spec:"));
            console.log(JSON.stringify(result.pipelineSpec, null, 2));

            console.log(chalk.magenta("\nÇalıştırılıyor...\n"));

            const pipelineResult = await aion.runPipeline(result.taskSpec, result.pipelineSpec);

            console.log(chalk.green("\nPipeline Bitti ✔"));
            console.log(JSON.stringify(pipelineResult, null, 2));
            console.log("");

          } else {
            console.log(chalk.gray("AION bilinmeyen mod döndürdü."));
          }

        } catch (err) {
          console.log(chalk.red("\nAION bir hata verdi:"));
          console.log(String(err?.message || err));
          console.log("");
          appendMemory("cli_errors.json", {
            error: String(err?.message || err),
            input: text,
            createdAt: new Date().toISOString(),
          });
        }

        loop();
      });
    };

    loop();
  });
}

/* ------------------------------------------------------------
 * Komut satırından girdileri dinle
 * ------------------------------------------------------------ */
rl.on("line", async (line) => {
  try {
    await handleCommand(line);
  } catch (err) {
    console.log(chalk.red("CLI error:"), err);
  }
  rl.prompt();
});
