import { randomUUID } from "node:crypto";
import type { GenerationBatchRecord } from "./monthly-workspace-contracts";
import { updateV5MonthlyState } from "./monthly-repository";
import { V5ServiceError } from "./monthly-service";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function createGenerationBatch(month: string, taskIds: string[], auditReason: string) {
  if (!MONTH_PATTERN.test(month)) throw new V5ServiceError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM。");
  const normalizedTaskIds = Array.from(new Set(taskIds.map(String).map((id) => id.trim()).filter(Boolean)));
  if (!normalizedTaskIds.length) throw new V5ServiceError(422, "GENERATION_TASKS_REQUIRED", "至少选择 1 篇待生成任务。");
  if (!auditReason.trim() || auditReason.length > 200) throw new V5ServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的批次原因。");

  return updateV5MonthlyState((state) => {
    const now = new Date().toISOString();
    const batch: GenerationBatchRecord = {
      batchId: `generation-batch-${randomUUID()}`,
      month,
      taskIds: normalizedTaskIds,
      pendingTaskIds: normalizedTaskIds,
      completedTaskIds: [],
      failedTaskIds: [],
      status: "queued",
      createdAt: now,
      updatedAt: now
    };
    state.generationBatches[month] = [batch, ...(state.generationBatches[month] || [])].slice(0, 50);
    state.auditLog.unshift({ id: randomUUID(), event: "generation_batch_created", month, actor: "local-product-operator", version: 1, createdAt: now, auditReason, objectId: batch.batchId, summary: { taskCount: normalizedTaskIds.length } });
    return batch;
  });
}

export type GenerationBatchAction = "start" | "pause" | "resume" | "claim-next" | "task-completed" | "task-failed" | "cancel";

export async function mutateGenerationBatch(batchId: string, action: GenerationBatchAction, taskId?: string) {
  return updateV5MonthlyState((state) => {
    const entry = Object.entries(state.generationBatches).find(([, batches]) => batches.some((batch) => batch.batchId === batchId));
    const batch = entry?.[1].find((item) => item.batchId === batchId);
    if (!entry || !batch) throw new V5ServiceError(404, "GENERATION_BATCH_NOT_FOUND", "生成批次不存在，请刷新页面后重试。");
    const previousStatus = batch.status;

    if (action === "start") {
      if (batch.status === "queued") batch.status = "running";
    } else if (action === "pause") {
      if (batch.status === "running" || batch.status === "queued") batch.status = batch.activeTaskId ? "pausing" : "paused";
    } else if (action === "resume") {
      if (["paused", "pausing", "failed"].includes(batch.status)) batch.status = "running";
    } else if (action === "cancel") {
      batch.status = "cancelled";
    } else if (action === "claim-next") {
      if (batch.status === "pausing") batch.status = "paused";
      if (batch.status !== "running" || batch.activeTaskId) return batch;
      const nextTaskId = batch.pendingTaskIds[0];
      if (!nextTaskId) batch.status = batch.failedTaskIds.length ? "failed" : "completed";
      else batch.activeTaskId = nextTaskId;
    } else if (action === "task-completed" || action === "task-failed") {
      const completedTaskId = taskId || batch.activeTaskId;
      if (!completedTaskId || completedTaskId !== batch.activeTaskId) throw new V5ServiceError(409, "GENERATION_TASK_NOT_ACTIVE", "批次当前进行中的任务与回写任务不一致。");
      batch.pendingTaskIds = batch.pendingTaskIds.filter((id) => id !== completedTaskId);
      if (action === "task-completed") batch.completedTaskIds = Array.from(new Set([...batch.completedTaskIds, completedTaskId]));
      else batch.failedTaskIds = Array.from(new Set([...batch.failedTaskIds, completedTaskId]));
      batch.activeTaskId = undefined;
      if (batch.status === "pausing") batch.status = "paused";
      else if (!batch.pendingTaskIds.length) batch.status = batch.failedTaskIds.length ? "failed" : "completed";
    }

    batch.updatedAt = new Date().toISOString();
    if (batch.status !== previousStatus) state.auditLog.unshift({ id: randomUUID(), event: "generation_batch_status_changed", month: entry[0], actor: "local-product-operator", version: 1, createdAt: batch.updatedAt, objectId: batch.batchId, summary: { from: previousStatus, to: batch.status, taskId } });
    return batch;
  });
}
