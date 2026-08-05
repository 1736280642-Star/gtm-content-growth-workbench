import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.join("=") || true];
}));
const apply = args.has("--apply");
const month = String(args.get("--month") || "2026-08");
const ledgerPath = path.resolve(String(args.get("--ledger") || ".tmp/publish-3027-20260805-state.json"));
const monthlyStatePath = path.resolve(String(args.get("--monthly-state") || "data/v5-monthly-workbench.json"));

const [ledgerRaw, monthlyRaw] = await Promise.all([
  readFile(ledgerPath, "utf8"),
  readFile(monthlyStatePath, "utf8")
]);
const ledger = JSON.parse(ledgerRaw);
const monthlyState = JSON.parse(monthlyRaw);
const plan = monthlyState.plans?.[month];
if (!plan || !Array.isArray(plan.matrixTasks)) throw new Error(`MonthlyPlan ${month} 不存在。`);

const taskById = new Map(plan.matrixTasks.map((task) => [String(task.taskId), task]));
const groups = new Map();
for (const schedule of ledger.publishSchedules || []) {
  const taskId = String(schedule.matrixItemId || "");
  if (!taskById.has(taskId) || String(schedule.platform || "").toLowerCase() === "wechat") continue;
  const current = groups.get(taskId) || [];
  current.push(schedule);
  groups.set(taskId, current);
}

const publicStatuses = new Set(["public_observed", "stable_published", "published_verified"]);
const failedStatuses = new Set(["failed", "platform_rejected", "removed_after_publish", "verification_timeout"]);
const timestamp = (item) => Date.parse(item.updatedAt || item.createdAt || 0) || 0;
const latest = (items) => [...items].sort((left, right) => timestamp(right) - timestamp(left))[0];
const selectEffective = (items) => latest(items.filter((item) => publicStatuses.has(item.status)))
  || latest(items.filter((item) => item.status === "pending_verify"))
  || latest(items.filter((item) => failedStatuses.has(item.status)))
  || latest(items);

const changes = [];
const skipped = { pendingVerify: 0, precheckOnly: 0 };
for (const [taskId, schedules] of groups) {
  const schedule = selectEffective(schedules);
  const task = taskById.get(taskId);
  if (publicStatuses.has(schedule.status) && schedule.publicUrl) {
    const externalContentId = schedule.platformArticleId || schedule.externalTaskId;
    if (task.status !== "published" || task.publicUrl !== schedule.publicUrl || task.externalContentId !== externalContentId) {
      changes.push({ taskId, kind: "published", schedule, task, externalContentId });
    }
  } else if (schedule.status === "pending_verify") {
    skipped.pendingVerify += 1;
  } else if (failedStatuses.has(schedule.status)) {
    const failureReason = schedule.failureReason || `发布任务状态：${schedule.status}`;
    if (task.status !== "scheduled" || task.failureReason !== failureReason) {
      changes.push({ taskId, kind: "failed", schedule, task, failureReason });
    }
  } else {
    skipped.precheckOnly += 1;
  }
}

const summary = {
  mode: apply ? "apply" : "preview",
  month,
  monthlyTaskCount: plan.matrixTasks.length,
  mappedTaskCount: groups.size,
  publishCount: changes.filter((item) => item.kind === "published").length,
  failureCount: changes.filter((item) => item.kind === "failed").length,
  pendingVerifySkipped: skipped.pendingVerify,
  precheckOnlySkipped: skipped.precheckOnly
};

if (!apply) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(0);
}

const now = new Date().toISOString();
for (const change of changes) {
  const currentVersion = Number(change.task.publishResultVersion || 0);
  Object.assign(change.task, {
    status: change.kind === "published" ? "published" : "scheduled",
    publishResultVersion: currentVersion + 1,
    publicUrl: change.kind === "published" ? change.schedule.publicUrl : undefined,
    externalContentId: change.kind === "published" ? change.externalContentId : change.schedule.platformArticleId || change.schedule.externalTaskId,
    failureReason: change.kind === "failed" ? change.failureReason : undefined,
    updatedAt: now
  });
  monthlyState.auditLog.unshift({
    id: `publish-sync-${change.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event: "publish_result_saved",
    month,
    actor: "publish-result-sync",
    version: plan.version,
    createdAt: now,
    auditReason: "同步真实自动发布链路结果到当前月度工作台",
    objectId: change.taskId,
    summary: {
      status: change.kind,
      platform: change.schedule.platform,
      publishScheduleId: change.schedule.id,
      hasPublicUrl: Boolean(change.schedule.publicUrl),
      source: "durable_publish_job_ledger"
    }
  });
}
plan.status = plan.matrixTasks.every((task) => task.status === "published") ? "completed" : "running";
plan.updatedAt = now;
plan.updatedBy = "publish-result-sync";

const backupDir = path.resolve(".tmp/publish-result-sync-backups");
await mkdir(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `v5-monthly-workbench-${month}-${Date.now()}.json`);
await copyFile(monthlyStatePath, backupPath);
const temporaryPath = `${monthlyStatePath}.${process.pid}.${Date.now()}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(monthlyState, null, 2)}\n`, "utf8");
await rename(temporaryPath, monthlyStatePath);

process.stdout.write(`${JSON.stringify({ ...summary, backupCreated: true })}\n`);
