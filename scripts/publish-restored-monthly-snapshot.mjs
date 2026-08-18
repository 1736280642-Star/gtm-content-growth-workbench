import process from "node:process";

function parseArgs(tokens) {
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) args[rawKey] = inlineValue;
    else if (tokens[index + 1] && !tokens[index + 1].startsWith("--")) args[rawKey] = tokens[++index];
    else args[rawKey] = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] || "http://127.0.0.1:3027").replace(/\/$/, "");
const month = String(args.month || new Date().toISOString().slice(0, 7));
const execute = args.execute === true;
const requestedTaskIds = new Set(String(args["task-ids"] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const platformByChannel = new Map([
  ["csdn", "csdn"],
  ["juejin", "juejin"],
  ["zhihu_toutiao_general", "zhihu"]
]);

const workspaceResponse = await fetch(`${baseUrl}/api/v5/monthly-workspace?month=${encodeURIComponent(month)}`, { cache: "no-store" });
const workspaceBody = await workspaceResponse.json();
if (!workspaceResponse.ok || !workspaceBody.ok) throw new Error(workspaceBody.error?.message || "Monthly workspace read failed.");

const tasks = workspaceBody.data.productionTasks
  .filter((task) => platformByChannel.has(task.channel) && (!requestedTaskIds.size || requestedTaskIds.has(task.taskId)))
  .map((task) => ({ task, draft: task.lastUsableDraft || task.currentDraft, platform: platformByChannel.get(task.channel) }));
const invalid = tasks.filter(({ task, draft }) => task.status !== "scheduled" || !draft?.draftId || draft.status !== "available" || !draft.markdown?.trim());
const planned = {
  month,
  mode: execute ? "execute" : "preview",
  total: tasks.length,
  byPlatform: Object.fromEntries([...platformByChannel.values()].map((platform) => [platform, tasks.filter((item) => item.platform === platform).length])),
  invalid: invalid.map(({ task }) => task.taskId)
};
process.stdout.write(`${JSON.stringify({ event: "publish_batch_plan", ...planned })}\n`);
if (invalid.length) process.exit(2);
if (!execute) process.exit(0);

const results = [];
for (const { task, draft, platform } of tasks) {
  const response = await fetch(`${baseUrl}/api/v5/content-tasks/${encodeURIComponent(task.taskId)}/publish-job`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId: draft.draftId,
      platform,
      scheduledAt: task.scheduledAt,
      dispatch: false,
      month,
      allowRestoredSnapshot: true,
      auditReason: "Kari explicitly authorized real sequential publishing of the restored monthly matrix, excluding WeChat."
    })
  });
  const body = await response.json().catch(() => ({}));
  const schedules = body.data?.schedules || [];
  const result = {
    taskId: task.taskId,
    platform,
    ok: response.ok && body.ok !== false,
    httpStatus: response.status,
    scheduleIds: schedules.map((schedule) => schedule.id),
    statuses: schedules.map((schedule) => schedule.status),
    message: body.message || body.error?.message
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({ event: "publish_batch_item", ...result })}\n`);
  if (!result.ok) break;
}

const summary = {
  event: "publish_batch_complete",
  requested: tasks.length,
  accepted: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  stoppedEarly: results.length < tasks.length
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed || summary.stoppedEarly) process.exit(1);
