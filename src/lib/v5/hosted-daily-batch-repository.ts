import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { archiveHostedResult } from "./hosted-history-repository";
import { publishingResultContent } from "./hosted-history-projection";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";

export interface HostedDailyPublishResult {
  taskId: string;
  title: string;
  channel: string;
  status: "published" | "platform_review" | "failed" | "deferred";
  publicUrl?: string;
  publishedAt?: string;
  failureReason?: string;
  responsibility?: "system" | "external" | "user";
  userActionRequired?: boolean;
  nextAction?: string;
  nextAttemptAt?: string;
  attemptCount?: number;
}

export interface HostedDailyPublishBatchView {
  batchId: string;
  orderId: string;
  monthlyPlanId: string;
  businessDate: string;
  timezone: string;
  effectiveCaps: Record<string, number>;
  plannedCount: number;
  publishedCount: number;
  pendingCount: number;
  failedCount: number;
  status: "collecting" | "closed";
  closedAt?: string;
  digestOutboxId?: string;
  rowVersion: number;
  results: HostedDailyPublishResult[];
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : undefined;
}

function mapBatch(row: RowDataPacket): HostedDailyPublishBatchView {
  return {
    batchId: String(row.id),
    orderId: String(row.order_id),
    monthlyPlanId: String(row.monthly_plan_id),
    businessDate: String(row.business_date).slice(0, 10),
    timezone: String(row.timezone),
    effectiveCaps: parseV5Json(row.effective_caps_json, {}),
    plannedCount: Number(row.planned_count || 0),
    publishedCount: Number(row.published_count || 0),
    pendingCount: Number(row.pending_count || 0),
    failedCount: Number(row.failed_count || 0),
    status: String(row.status) as HostedDailyPublishBatchView["status"],
    closedAt: iso(row.closed_at),
    digestOutboxId: row.digest_outbox_id ? String(row.digest_outbox_id) : undefined,
    rowVersion: Number(row.row_version || 1),
    results: parseV5Json(row.result_snapshot_json, [])
  };
}

function comparableBatch(batch: Omit<HostedDailyPublishBatchView, "closedAt" | "digestOutboxId" | "rowVersion">) {
  return {
    monthlyPlanId: batch.monthlyPlanId,
    businessDate: batch.businessDate,
    timezone: batch.timezone,
    effectiveCaps: batch.effectiveCaps,
    plannedCount: batch.plannedCount,
    publishedCount: batch.publishedCount,
    pendingCount: batch.pendingCount,
    failedCount: batch.failedCount,
    status: batch.status,
    results: batch.results
  };
}

export async function readHostedDailyPublishBatchRecord(batchId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM hosted_daily_publish_batch WHERE id = ? LIMIT 1", [batchId]);
  return rows[0] ? mapBatch(rows[0]) : undefined;
}

export async function upsertHostedDailyPublishBatchRecord(input: {
  batchId: string;
  orderId: string;
  monthlyPlanId: string;
  businessDate: string;
  timezone: string;
  effectiveCaps: Record<string, number>;
  results: HostedDailyPublishResult[];
  plannedCount: number;
  publishedCount: number;
  pendingCount: number;
  failedCount: number;
  shouldClose: boolean;
  actorId: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_daily_publish_batch WHERE id = ? LIMIT 1 FOR UPDATE", [input.batchId]);
    const previous = rows[0] ? mapBatch(rows[0]) : undefined;
    const status = previous?.status === "closed" || input.shouldClose ? "closed" as const : "collecting" as const;
    const nextComparable = comparableBatch({
      batchId: input.batchId,
      orderId: input.orderId,
      monthlyPlanId: input.monthlyPlanId,
      businessDate: input.businessDate,
      timezone: input.timezone,
      effectiveCaps: input.effectiveCaps,
      plannedCount: input.plannedCount,
      publishedCount: input.publishedCount,
      pendingCount: input.pendingCount,
      failedCount: input.failedCount,
      status,
      results: input.results
    });
    if (previous && hashV5GovernancePayload(comparableBatch(previous)) === hashV5GovernancePayload(nextComparable)) return previous;

    if (!previous) {
      await connection.query(
        `INSERT INTO hosted_daily_publish_batch
         (id, order_id, monthly_plan_id, business_date, timezone, version, effective_caps_json,
          result_snapshot_json, planned_count, published_count, pending_count, failed_count, status, closed_at, row_version)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [input.batchId, input.orderId, input.monthlyPlanId, input.businessDate, input.timezone,
          stringifyV5Json(input.effectiveCaps), stringifyV5Json(input.results), input.plannedCount,
          input.publishedCount, input.pendingCount, input.failedCount, status, status === "closed" ? new Date() : null]
      );
    } else {
      const [result] = await connection.query<ResultSetHeader>(
        `UPDATE hosted_daily_publish_batch SET monthly_plan_id = ?, timezone = ?, effective_caps_json = ?,
         result_snapshot_json = ?, planned_count = ?, published_count = ?, pending_count = ?, failed_count = ?,
         status = ?, closed_at = COALESCE(closed_at, ?), row_version = row_version + 1
         WHERE id = ? AND row_version = ?`,
        [input.monthlyPlanId, input.timezone, stringifyV5Json(input.effectiveCaps), stringifyV5Json(input.results),
          input.plannedCount, input.publishedCount, input.pendingCount, input.failedCount, status,
          status === "closed" ? new Date() : null, input.batchId, previous.rowVersion]
      );
      if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_daily_batch_version_conflict", "每日发布批次已经变化，请稍后重试。", 409);
    }
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: "根据 MonthlyPlan 当日正式发布结果同步托管批次",
      eventType: previous ? "hosted_daily_publish_batch_updated" : "hosted_daily_publish_batch_created",
      objectType: "hosted_daily_publish_batch",
      objectId: input.batchId,
      beforeSummary: previous ? comparableBatch(previous) : undefined,
      afterSummary: nextComparable,
      correlationId: input.orderId
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_daily_publish_batch WHERE id = ? LIMIT 1", [input.batchId]);
    const updated = mapBatch(updatedRows[0]);
    if (updated.status === "closed") await archiveHostedResult(connection, {
      ...publishingResultContent(updated), resultId: `${updated.batchId}:v${updated.rowVersion}`,
      orderId: input.orderId, step: "publishing", createdAt: new Date().toISOString()
    }, input.actorId);
    return updated;
  });
}

export async function attachHostedDailyBatchDigest(input: {
  batchId: string;
  outboxId: string;
  actorId: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_daily_publish_batch WHERE id = ? LIMIT 1 FOR UPDATE", [input.batchId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_daily_batch_not_found", "每日发布批次不存在。", 404);
    const previous = mapBatch(rows[0]);
    if (previous.digestOutboxId) return previous;
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE hosted_daily_publish_batch SET digest_outbox_id = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ? AND digest_outbox_id IS NULL`,
      [input.outboxId, input.batchId, previous.rowVersion]
    );
    if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_daily_batch_version_conflict", "每日发布批次已经变化，请稍后重试。", 409);
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: "关联每日 URL 汇总通知，防止重复投递",
      eventType: "hosted_daily_publish_batch_digest_attached",
      objectType: "hosted_daily_publish_batch",
      objectId: input.batchId,
      beforeSummary: { digestOutboxId: null, rowVersion: previous.rowVersion },
      afterSummary: { digestOutboxId: input.outboxId, rowVersion: previous.rowVersion + 1 },
      correlationId: previous.orderId
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_daily_publish_batch WHERE id = ? LIMIT 1", [input.batchId]);
    return mapBatch(updatedRows[0]);
  });
}

export async function listHostedDailyPublishBatchRecords(orderId: string, limit = 31) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM hosted_daily_publish_batch WHERE order_id = ? ORDER BY business_date DESC, version DESC LIMIT ?",
    [orderId, Math.max(1, Math.min(100, limit))]
  );
  return rows.map(mapBatch);
}
