import type { PublishSchedule } from "@/lib/types";
import { updateFreeProductionState } from "@/lib/v5/free-production-repository";
import { hasV5GovernanceDatabaseConfig } from "@/lib/v5/knowledge-governance-repository";
import { backfillFormalPublishJobResult } from "@/lib/v5/monthly-execution-repository";

type BackfillStatus = "published" | "failed" | "manual_takeover";

function toBackfillStatus(schedule: PublishSchedule): BackfillStatus | undefined {
  if (["public_observed", "stable_published", "published_verified"].includes(schedule.status) && schedule.publicUrl) return "published";
  // A later removal is a liveness failure, not proof that formal publication never happened.
  if (schedule.status === "removed_after_publish" && schedule.publicUrl && schedule.firstPublicObservedAt) return "published";
  if (["platform_rejected", "removed_after_publish", "verification_timeout", "failed"].includes(schedule.status)) return "failed";
  if (["risk_blocked", "auth_expired", "manual_takeover_required", "pending_config"].includes(schedule.status)) return "manual_takeover";
  return undefined;
}

async function backfillFreeProduction(schedule: PublishSchedule, batchId: string, status: BackfillStatus) {
  return updateFreeProductionState((state) => {
    const batch = state.batches[batchId];
    if (!batch) return { synced: false, reason: "free_batch_not_found" };
    const task = state.tasks[`free-task-${batchId}`];
    const now = new Date().toISOString();
    batch.status = status === "published" ? "published" : "publish_failed";
    batch.publishedAt = status === "published" ? schedule.publishedAt || now : undefined;
    batch.publishedUrl = status === "published" ? schedule.publicUrl : undefined;
    batch.externalRecordId = schedule.id;
    batch.failureCode = status === "published" ? undefined : schedule.failureCode || schedule.status;
    batch.failureMessage = status === "published" ? undefined : schedule.failureReason;
    batch.nextAction = status === "published"
      ? "URL 已由 reconciliation 自动回填；系统将继续执行 24h/72h 存活验证。"
      : schedule.nextAction || "在发布控制塔查看失败原因和账号状态。";
    batch.version += 1;
    batch.updatedAt = now;
    if (task) {
      task.status = batch.status;
      task.publishedAt = batch.publishedAt;
      task.publishedUrl = batch.publishedUrl;
      task.failureCode = batch.failureCode;
      task.failureMessage = batch.failureMessage;
      task.nextAction = batch.nextAction;
      task.updatedAt = now;
    }
    return { synced: true };
  });
}

export async function backfillPublishJob(schedule: PublishSchedule) {
  const status = toBackfillStatus(schedule);
  if (!status || !schedule.matrixItemId) return { synced: false, reason: "lifecycle_not_backfillable" };
  try {
    if (schedule.matrixItemId.startsWith("free-task-")) {
      return await backfillFreeProduction(schedule, schedule.matrixItemId.slice("free-task-".length), status);
    }
    if (!hasV5GovernanceDatabaseConfig()) return { synced: false, reason: "formal_repository_not_configured" };
    return await backfillFormalPublishJobResult({
      taskId: schedule.matrixItemId,
      status,
      publicUrl: schedule.publicUrl,
      externalContentId: schedule.platformArticleId || schedule.externalTaskId,
      failureReason: schedule.failureReason,
      publishScheduleId: schedule.id,
      publishedAt: schedule.publishedAt,
      urlStatus: schedule.urlStatus,
      firstPublicObservedAt: schedule.firstPublicObservedAt,
      lastVerifiedAt: schedule.lastVerifiedAt,
      stablePublishedAt: schedule.stablePublishedAt,
      removedAt: schedule.removedAt,
      verificationCount: schedule.verificationCount
    });
  } catch (error) {
    return { synced: false, reason: error instanceof Error ? error.message : "publish_backfill_failed" };
  }
}
