import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, ...value] = token.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
const apply = args.get("apply") === "true";
const statePath = resolve(String(args.get("state-path") || process.env.WORKBENCH_STATE_PATH || "data/workbench-state.json"));
const scheduleIds = String(args.get("schedule-ids") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (scheduleIds.length === 0) throw new Error("Pass --schedule-ids=id1,id2");

const state = JSON.parse(await readFile(statePath, "utf8"));
const now = new Date().toISOString();
const targets = scheduleIds.map((scheduleId) => {
  const schedule = state.publishSchedules?.find((candidate) => candidate.id === scheduleId);
  if (!schedule) throw new Error(`Publish schedule not found: ${scheduleId}`);
  const attempt = state.publishAttempts?.find((candidate) => candidate.id === schedule.latestAttemptId);
  if (schedule.status !== "precheck_failed") {
    throw new Error(`Unsafe status for ${scheduleId}: ${schedule.status}`);
  }
  if (schedule.platformArticleId || schedule.publicUrl || schedule.externalTaskId) {
    throw new Error(`External publish evidence exists for ${scheduleId}; refusing to requeue.`);
  }
  if (!attempt || attempt.failureCode !== "adapter_failed" || attempt.failureReason !== "fetch failed" || attempt.verifyStatus !== "not_started") {
    throw new Error(`Latest attempt is not the expected pre-action bridge failure: ${scheduleId}`);
  }
  return { schedule, attempt };
});

const summary = {
  mode: apply ? "apply" : "preview",
  count: targets.length,
  schedules: targets.map(({ schedule }) => ({ id: schedule.id, platform: schedule.platform, taskId: schedule.sourceTaskId }))
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

for (const { schedule } of targets) {
  schedule.status = "scheduled";
  schedule.scheduledAt = now;
  schedule.updatedAt = now;
  delete schedule.failureCode;
  delete schedule.failureReason;
  delete schedule.nextAction;
}
state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
state.auditLog.push({
  id: `audit-scoped-bridge-requeue-${Date.now()}`,
  action: "scoped_bridge_failures_requeued",
  scheduleIds,
  actor: "local-docker-operator",
  createdAt: now
});

const backupPath = `${statePath}.before-scoped-bridge-requeue-${now.replace(/[:.]/g, "-")}.bak`;
const temporaryPath = `${statePath}.tmp`;
await copyFile(statePath, backupPath);
await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await rename(temporaryPath, statePath);
console.log(JSON.stringify({ ...summary, backupFile: backupPath.slice(dirname(statePath).length + 1) }, null, 2));
