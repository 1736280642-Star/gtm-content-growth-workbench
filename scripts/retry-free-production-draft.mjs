import process from "node:process";
import { randomUUID } from "node:crypto";
import { getFreeProductionBatch, retryFreeProductionFailures } from "../src/lib/v5/free-production-service.ts";
import { updateFreeProductionState } from "../src/lib/v5/free-production-repository.ts";

const batchId = String(process.argv[2] || "").trim();
if (!batchId) {
  console.error("Usage: node scripts/retry-free-production-draft.mjs <batch-id>");
  process.exit(1);
}

try {
  let batch = await getFreeProductionBatch(batchId);
  if (batch.status === "draft_created" && String(batch.externalRecordId || "").startsWith("mock-weixin-")) {
    batch = await updateFreeProductionState((state) => {
      const target = state.batches[batchId];
      if (!target || target.version !== batch.version || target.status !== "draft_created" || !String(target.externalRecordId || "").startsWith("mock-weixin-")) {
        throw new Error("mock_draft_state_changed");
      }
      const now = new Date().toISOString();
      target.status = "publish_failed";
      target.draftCreatedAt = undefined;
      target.draftUrl = undefined;
      target.externalRecordId = undefined;
      target.failureCode = "mock_result_not_real";
      target.failureMessage = "隔离重试返回模拟草稿，未写入微信公众号。";
      target.nextAction = "使用真实发布配置重新发送到公众号草稿箱。";
      target.version += 1;
      target.updatedAt = now;
      const task = state.tasks[`free-task-${batchId}`];
      if (task) {
        task.status = target.status;
        task.draftCreatedAt = undefined;
        task.draftUrl = undefined;
        task.failureCode = target.failureCode;
        task.failureMessage = target.failureMessage;
        task.nextAction = target.nextAction;
        task.updatedAt = now;
      }
      state.audits.push({
        auditId: randomUUID(),
        action: "free_production_mock_draft_discarded",
        objectId: batchId,
        actor: "local-workspace-user",
        auditReason: "模拟草稿不能作为真实公众号草稿，清除后重新发送",
        createdAt: now,
        summary: { previousExternalRecordId: batch.externalRecordId }
      });
      return target;
    });
  }
  const result = await retryFreeProductionFailures(batchId, {
    expectedVersion: batch.version,
    auditReason: "修复发布运行时后安全重试公众号草稿发送"
  }, `retry-free-production-draft-${batch.id}-${batch.version}`);

  console.log(JSON.stringify({
    ok: result.status === "draft_created",
    batchId: result.id,
    version: result.version,
    status: result.status,
    externalDraftId: result.externalRecordId,
    draftUrl: result.draftUrl,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
    nextAction: result.nextAction
  }, null, 2));
  if (result.status !== "draft_created" || String(result.externalRecordId || "").startsWith("mock-")) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error && typeof error === "object" && "code" in error ? error.code : "free_production_draft_retry_failed",
    message: error instanceof Error ? error.message : String(error),
    nextAction: error && typeof error === "object" && "nextAction" in error ? error.nextAction : undefined
  }, null, 2));
  process.exit(1);
}
