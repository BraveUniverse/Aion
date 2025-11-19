// ===== core/StateMachine.js =====

import { appendMemory } from "../modules/MemoryEngine.js";

/**
 * PipelineStateMachine
 * -------------------------------------------------------
 * Tek bir pipeline'ın çalışma durumunu izleyen basit state machine.
 *
 * States:
 *  - idle
 *  - running
 *  - paused
 *  - completed
 *  - failed
 */

const VALID_STATES = ["idle", "running", "paused", "completed", "failed"];

export class PipelineStateMachine {
  constructor({ pipelineId, taskId }) {
    this.pipelineId = pipelineId;
    this.taskId = taskId;
    this.state = "idle";
    this.currentStepId = null;
    this.startedAt = null;
    this.finishedAt = null;
    this.history = [];
  }

  _transition(next, info = {}) {
    if (!VALID_STATES.includes(next)) {
      throw new Error(`PipelineStateMachine: geçersiz state: ${next}`);
    }

    const prev = this.state;
    this.state = next;

    const evt = {
      from: prev,
      to: next,
      ts: new Date().toISOString(),
      info,
    };

    this.history.push(evt);

    appendMemory("pipeline_state.json", {
      pipelineId: this.pipelineId,
      taskId: this.taskId,
      ...evt,
    });
  }

  start() {
    if (this.state !== "idle") return;
    this.startedAt = new Date().toISOString();
    this._transition("running", { startedAt: this.startedAt });
  }

  pause(reason = "") {
    if (this.state !== "running") return;
    this._transition("paused", { reason });
  }

  resume() {
    if (this.state !== "paused") return;
    this._transition("running", { reason: "resume" });
  }

  stepBegin(stepId) {
    this.currentStepId = stepId;
    appendMemory("pipeline_steps.json", {
      pipelineId: this.pipelineId,
      taskId: this.taskId,
      stepId,
      event: "begin",
      ts: new Date().toISOString(),
    });
  }

  stepEnd(stepId, status = "success") {
    if (this.currentStepId === stepId) {
      this.currentStepId = null;
    }
    appendMemory("pipeline_steps.json", {
      pipelineId: this.pipelineId,
      taskId: this.taskId,
      stepId,
      event: "end",
      status,
      ts: new Date().toISOString(),
    });

    if (status === "error") {
      this.fail(`step ${stepId} failed`);
    }
  }

  complete() {
    this.finishedAt = new Date().toISOString();
    this._transition("completed", { finishedAt: this.finishedAt });
  }

  fail(reason = "") {
    this.finishedAt = new Date().toISOString();
    this._transition("failed", {
      finishedAt: this.finishedAt,
      reason,
    });
  }

  snapshot() {
    return {
      pipelineId: this.pipelineId,
      taskId: this.taskId,
      state: this.state,
      currentStepId: this.currentStepId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      history: this.history,
    };
  }
}
