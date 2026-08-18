import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { blockPublishSchedulesForMatrixItem } from "../src/lib/workbench-store.ts";

test("human interception blocks only queued publish schedules for the selected article", () => {
  const directory = mkdtempSync(join(tmpdir(), "joto-content-interception-"));
  const statePath = join(directory, "workbench-state.json");
  const previousStatePath = process.env.WORKBENCH_STATE_PATH;
  process.env.WORKBENCH_STATE_PATH = statePath;
  writeFileSync(statePath, JSON.stringify({
    publishSchedules: [
      { id: "schedule-target", platform: "csdn", status: "scheduled", scheduledAt: "2026-08-14T10:00:00.000Z", draftId: "draft-target", matrixItemId: "task-target", contentHash: "hash-target", idempotencyKey: "key-target", attemptIds: [], createdAt: "2026-08-14T00:00:00.000Z" },
      { id: "schedule-other", platform: "csdn", status: "scheduled", scheduledAt: "2026-08-14T11:00:00.000Z", draftId: "draft-other", matrixItemId: "task-other", contentHash: "hash-other", idempotencyKey: "key-other", attemptIds: [], createdAt: "2026-08-14T00:00:00.000Z" },
      { id: "schedule-published", platform: "csdn", status: "stable_published", scheduledAt: "2026-08-13T10:00:00.000Z", draftId: "draft-published", matrixItemId: "task-target", contentHash: "hash-published", idempotencyKey: "key-published", attemptIds: [], createdAt: "2026-08-13T00:00:00.000Z" }
    ]
  }), "utf8");

  try {
    assert.equal(blockPublishSchedulesForMatrixItem("task-target", "用户拦截发布"), 1);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.publishSchedules.find((item) => item.id === "schedule-target").status, "risk_blocked");
    assert.equal(state.publishSchedules.find((item) => item.id === "schedule-other").status, "scheduled");
    assert.equal(state.publishSchedules.find((item) => item.id === "schedule-published").status, "stable_published");
  } finally {
    if (previousStatePath === undefined) delete process.env.WORKBENCH_STATE_PATH;
    else process.env.WORKBENCH_STATE_PATH = previousStatePath;
  }
});
