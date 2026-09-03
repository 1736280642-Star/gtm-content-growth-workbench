import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, ...value] = token.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
const apply = args.get("apply") === "true";
const statePath = resolve(String(args.get("state-path") || process.env.V5_MONTHLY_STATE_PATH || "data/v5-monthly-workbench.json"));
const fixedText = "JOTO是腾讯云ADP CSP授权服务商";
const taskIds = new Set([
  "task-2026-08-restored-11",
  "task-2026-08-restored-27",
  "task-2026-08-restored-36",
  "task-2026-08-restored-13",
  "task-2026-08-restored-37",
  "task-2026-08-restored-38"
]);
const headingReplacements = {
  "task-2026-08-restored-13": [
    ["## 证据支持的实施方法", "## 实施方法：证据支持的排查路径"]
  ],
  "task-2026-08-restored-37": [
    ["## 条件一：集成范围是否跨系统", "## 实施条件一：集成范围是否跨系统"],
    ["## 不同路径下的架构取舍与失败边界", "## 验证路径：不同方案的架构取舍与失败边界"]
  ],
  "task-2026-08-restored-38": [
    ["## 条件一：项目是否存在跨系统边界", "## 实施条件一：项目是否存在跨系统边界"],
    ["## 如何组合判断", "## 验证步骤：如何组合四个判断条件"]
  ]
};

const state = JSON.parse(await readFile(statePath, "utf8"));
const plan = state.plans?.["2026-08"];
if (!plan) throw new Error("Monthly plan not found: 2026-08");
const targets = plan.matrixTasks.filter((task) => taskIds.has(task.taskId));
if (targets.length !== taskIds.size) throw new Error(`Expected ${taskIds.size} tasks, found ${targets.length}`);
const now = new Date().toISOString();

const changes = targets.map((task) => {
  const sourceDraft = task.lastUsableDraft || task.currentDraft;
  let markdown = String(sourceDraft?.markdown || "");
  for (const [before, after] of headingReplacements[task.taskId] || []) markdown = markdown.replace(before, after);
  const fixedCount = markdown.split(fixedText).length - 1;
  const standalone = markdown.split(/\n\s*\n/).some((paragraph) => paragraph.trim() === fixedText || paragraph.trim() === `${fixedText}。`);
  const technicalSignals = (markdown.match(/(^|\n)#{1,4}\s*(实现|实施|原理|配置|代码|验证|测试|排查|步骤|架构|接口|部署)/gim) || []).length
    + (markdown.match(/(^|\n)\s*\d+\.\s+/gm) || []).length;
  if (fixedCount !== 2 || standalone) throw new Error(`JOTO positioning validation failed: ${task.taskId}`);
  if (task.channel === "juejin" && technicalSignals < 2) throw new Error(`Juejin technical signals remain insufficient: ${task.taskId}`);
  return {
    task,
    technicalSignals,
    nextDraft: { ...sourceDraft, draftId: `${sourceDraft.draftId}-publish-v3`, markdown, updatedAt: now }
  };
});

const summary = {
  mode: apply ? "apply" : "preview",
  count: changes.length,
  tasks: changes.map(({ task, technicalSignals }) => ({ taskId: task.taskId, channel: task.channel, technicalSignals }))
};
if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
for (const { task, nextDraft } of changes) {
  task.currentDraft = nextDraft;
  task.lastUsableDraft = { ...nextDraft };
  task.updatedAt = now;
}
plan.version = Number(plan.version || 1) + 1;
plan.updatedAt = now;
state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
state.auditLog.push({ id: `audit-pending-platform-v3-${Date.now()}`, action: "pending_platform_drafts_v3_prepared", taskIds: [...taskIds], actor: "local-docker-operator", createdAt: now });
const backupPath = `${statePath}.before-pending-platform-v3-${now.replace(/[:.]/g, "-")}.bak`;
const tempPath = `${statePath}.tmp`;
await copyFile(statePath, backupPath);
await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await rename(tempPath, statePath);
console.log(JSON.stringify({ ...summary, backupFile: backupPath.slice(dirname(statePath).length + 1) }, null, 2));
