import process from "node:process";

const baseUrl = String(process.argv.find((item) => item.startsWith("--base-url="))?.split("=", 2)[1] || "http://127.0.0.1:3027").replace(/\/$/, "");
const requestedTaskIds = new Set(String(process.argv.find((item) => item.startsWith("--task-ids="))?.split("=", 2)[1] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const jobsResponse = await fetch(`${baseUrl}/api/publish-jobs`, { cache: "no-store" });
const jobsBody = await jobsResponse.json();
if (!jobsResponse.ok) throw new Error("Publish Job ledger read failed.");

const blocked = jobsBody.jobs.filter(({ schedule }) => schedule.platform === "juejin"
  && schedule.status === "precheck_failed"
  && schedule.failureCode === "content_blocked"
  && (!requestedTaskIds.size || requestedTaskIds.has(schedule.matrixItemId)));
process.stdout.write(`${JSON.stringify({ event: "juejin_repair_plan", blocked: blocked.length })}\n`);
const results = [];

for (let index = 0; index < blocked.length; index += 1) {
  const { schedule } = blocked[index];
  const rewriteResponse = await fetch(`${baseUrl}/api/publishing/preflight`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftId: schedule.draftId, platform: "juejin", platformVariantId: schedule.platformVariantId, autoRewrite: true })
  });
  const rewriteBody = await rewriteResponse.json().catch(() => ({}));
  if (!rewriteResponse.ok || !rewriteBody.ok || !rewriteBody.data?.variant?.id) {
    const result = { taskId: schedule.matrixItemId, ok: false, stage: "rewrite", httpStatus: rewriteResponse.status, message: rewriteBody.message };
    results.push(result);
    process.stdout.write(`${JSON.stringify({ event: "juejin_repair_item", ...result })}\n`);
    continue;
  }

  const scheduledAt = new Date(Date.now() + index).toISOString();
  const createResponse = await fetch(`${baseUrl}/api/publish-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId: schedule.draftId,
      platform: "juejin",
      platformVariantId: rewriteBody.data.variant.id,
      matrixItemId: schedule.matrixItemId,
      scheduledAt
    })
  });
  const createBody = await createResponse.json().catch(() => ({}));
  const replacement = createBody.data?.schedules?.[0];
  const result = {
    taskId: schedule.matrixItemId,
    ok: createResponse.ok && createBody.ok !== false && replacement?.status === "scheduled",
    stage: "replacement",
    httpStatus: createResponse.status,
    scheduleId: replacement?.id,
    status: replacement?.status,
    rewriteProvider: rewriteBody.data.variant.preflight?.rewriteProvider,
    rewriteModel: rewriteBody.data.variant.preflight?.rewriteModel,
    message: createBody.message
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({ event: "juejin_repair_item", ...result })}\n`);
}

const summary = { event: "juejin_repair_complete", requested: blocked.length, repaired: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed) process.exit(1);
