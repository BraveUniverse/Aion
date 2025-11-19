// ===== modules/MemorySync.js =====

/**
 * MemorySync
 * -------------------------------------------------------
 * Görev:
 *  - Oturum içi hafıza (RAM) ile kalıcı hafıza (JSON dosyaları)
 *    arasında basit bir senkronizasyon katmanı.
 *
 * Kullanım:
 *  - sessionContext.userProfile
 *  - sessionContext.preferences
 *  - sessionContext.lastTasks
 */

import { readMemory, writeMemory, appendMemory } from "./MemoryEngine.js";

export class MemorySync {
  constructor() {
    this.session = {
      preferences: {},
      profile: {},
      lastTasks: [],
    };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;

    const prefs = await readMemory("preferences.json");
    const profile = await readMemory("profile.json");

    if (prefs && typeof prefs === "object") this.session.preferences = prefs;
    if (profile && typeof profile === "object") this.session.profile = profile;

    this.loaded = true;
  }

  getPreferences() {
    return this.session.preferences;
  }

  async updatePreferences(patch) {
    await this.load();
    this.session.preferences = {
      ...this.session.preferences,
      ...patch,
    };
    await writeMemory("preferences.json", this.session.preferences);
  }

  getProfile() {
    return this.session.profile;
  }

  async updateProfile(patch) {
    await this.load();
    this.session.profile = {
      ...this.session.profile,
      ...patch,
    };
    await writeMemory("profile.json", this.session.profile);
  }

  /**
   * Son N task'i hafızada tutar ve disk loguna da append eder.
   */
  async pushTask(taskSpec, maxInSession = 20) {
    await this.load();

    this.session.lastTasks.push({
      id: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      createdAt: taskSpec.createdAt || new Date().toISOString(),
    });

    if (this.session.lastTasks.length > maxInSession) {
      this.session.lastTasks = this.session.lastTasks.slice(-maxInSession);
    }

    await appendMemory("tasks_history.json", {
      id: taskSpec.id,
      type: taskSpec.type,
      goal: taskSpec.goal,
      createdAt: taskSpec.createdAt || new Date().toISOString(),
    });
  }

  getLastTasks() {
    return this.session.lastTasks;
  }
}
