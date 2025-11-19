// ===== engine/DynamicAgentBuilder.js =====

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";
import { AgentRegistry } from "../modules/AgentRegistry.js";

/**
 * DynamicAgentBuilder
 * -------------------------------------------------------
 * Yeni bir agent adına ihtiyaç duyulduğunda:
 *  - Eğer registry'de yoksa:
 *      - LLM ile agent sınıf kodunu üretir
 *      - ./agents/<AgentName>.js dosyasına yazar
 *      - AgentRegistry'ye kaydeder
 */

export class DynamicAgentBuilder {
  constructor() {
    this.registry = new AgentRegistry();
    this.agentDir = path.resolve(process.cwd(), "agents");
  }

  /**
   * Agent dosyasının varlığını garanti eder.
   * Varsa registry'den path döner.
   * Yoksa yeni agent dosyasını üretir ve kaydeder.
   *
   * @param {string} agentName - Örn: "SQLAgent"
   * @param {object} hintInput - Görevden gelen input / context ipuçları
   * @returns {Promise<string>} relativePath (ör: "agents/SQLAgent.js")
   */
  async ensureAgentFile(agentName, hintInput = {}) {
    const existingPath = this.registry.getPath(agentName);
    if (existingPath) {
      return existingPath;
    }

    // Yeni agent yaratmamız lazım
    const relPath = `agents/${agentName}.js`;
    const absPath = path.resolve(process.cwd(), relPath);

    await fs.mkdir(this.agentDir, { recursive: true });

    const code = await this.generateAgentCode(agentName, hintInput);
    await fs.writeFile(absPath, code, "utf-8");

    this.registry.register(agentName, relPath, {
      createdAt: new Date().toISOString(),
    });

    appendMemory("agent_learning.json", {
      agentName,
      filePath: relPath,
      hintInputSummary: {
        taskGoal: hintInput.taskGoal,
        stepTitle: hintInput.stepTitle,
      },
      createdAt: new Date().toISOString(),
    });

    return relPath;
  }

  /**
   * LLM'den Agent sınıfı kodu üretir.
   * Burada standard bir agent iskeleti üretiyoruz.
   */
  async generateAgentCode(agentName, hintInput = {}) {
    const baseName = agentName.endsWith("Agent")
      ? agentName.slice(0, -5)
      : agentName;

    const systemPrompt = `
Sen AION için yeni bir "Agent" sınıfı üreten koddasın.

Görev:
"${agentName}" isminde bir agent sınıfı oluştur.
Bu agent mutlaka şu yapıda olmalı:

- "agents/${agentName}.js" içinde bulunacak.
- ES Module formatında olacak.
- export class ${agentName} { ... } şeklinde olacak.
- Sınıfta tek public metod olacak: async run(input, context = {}) { ... }
- Gerekirse runReasoner ve appendMemory kullanabilirsin.

Genel kurallar:
- input.taskGoal agent'ın ana hedefini anlatır.
- input.taskDetails içinde agent'a özel alanlar bulunur.
- context önceki step sonuçlarını içerir.
- Agent, görevine uygun net bir çıktı formatı döndürmeli (JSON obje).
- Kod içinde Türkçe yorum satırları kullanılabilir.

Çıktı:
SADECE geçerli bir JavaScript dosyası döndür, açıklama metni ekleme.
`.trim();

    const userPrompt = `
Agent adı: ${agentName}
Temel rol / alan: ${baseName}

Hint input:
${JSON.stringify(hintInput, null, 2)}
`;

    const code = await runReasoner(systemPrompt, userPrompt);

    // Ek koruma: boş veya çok saçma bir şey gelirse basit bir iskelet üretelim
    if (!code || code.trim().length < 20) {
      return this.fallbackAgentCode(agentName);
    }

    return code;
  }

  /**
   * LLM saçmalarsa minimum çalışır bir iskelet
   */
  fallbackAgentCode(agentName) {
    return `
import { runReasoner } from "../config/models.js";
import { appendMemory } from "../modules/MemoryEngine.js";

export class ${agentName} {
  async run(input, context = {}) {
    const systemPrompt = \`
Sen AION için oluşturulmuş dinamik bir agent'sın (${agentName}).
Görevin: Verilen girdiye göre işe yarar bir çıktı üretmek.
\`.trim();

    const userPrompt = JSON.stringify({ input, context }, null, 2);
    const answer = await runReasoner(systemPrompt, userPrompt);

    const result = {
      type: "${agentName}",
      answer
    };

    appendMemory("dynamic_agent_outputs.json", {
      agentName: "${agentName}",
      createdAt: new Date().toISOString()
    });

    return result;
  }
}
`.trim();
  }
}
