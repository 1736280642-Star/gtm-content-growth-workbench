import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, parseV5Json, stringifyV5Json, withV5GovernanceTransaction, writeV5GovernanceAudit, type V5GovernanceActor } from "../knowledge-governance-repository";
import type { RagJobStatus } from "./contracts";
import { assertRagJobTransition } from "./state-machines";

export interface RagIndexJobRecord { jobId: string; jobType: string; indexSnapshotId?: string; productId?: string; status: RagJobStatus; payload: Record<string, unknown>; attempt: number; maxAttempts: number; }

export async function enqueueRagJob(input: { jobType: string; indexSnapshotId?: string; productId?: string; idempotencyKey: string; payload: Record<string, unknown>; createdBy: string; maxAttempts?: number }) {
  const pool = getV5GovernancePool();
  const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM rag_index_job WHERE idempotency_key = ? LIMIT 1", [input.idempotencyKey]);
  if (existing[0]) return { replayed: true, jobId: String(existing[0].id) };
  const jobId = `rag-job-${randomUUID()}`;
  await pool.query("INSERT INTO rag_index_job (id, job_type, index_snapshot_id, product_id, status, idempotency_key, payload, max_attempts, available_at, created_by) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, NOW(), ?)", [jobId, input.jobType, input.indexSnapshotId || null, input.productId || null, input.idempotencyKey, stringifyV5Json(input.payload), input.maxAttempts || 3, input.createdBy]);
  return { replayed: false, jobId };
}

export async function leaseNextRagJob(workerId: string, leaseSeconds = 60, jobTypes?: string[]): Promise<RagIndexJobRecord | undefined> {
  return withV5GovernanceTransaction(async (connection) => {
    const typeFilter = jobTypes?.length ? " AND job_type IN (?)" : "";
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM rag_index_job WHERE status IN ('queued','pending_config','partial_failed','failed') AND available_at <= NOW()
       AND (lease_expires_at IS NULL OR lease_expires_at < NOW()) AND attempt < max_attempts${typeFilter}
       ORDER BY available_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      jobTypes?.length ? [jobTypes] : []
    );
    const row = rows[0]; if (!row) return undefined;
    const nextAttempt = Number(row.attempt) + (String(row.status) === "pending_config" ? 0 : 1);
    await connection.query("UPDATE rag_index_job SET status = 'running', attempt = ?, lease_owner = ?, lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), started_at = COALESCE(started_at, NOW()), row_version = row_version + 1 WHERE id = ?", [nextAttempt, workerId, leaseSeconds, String(row.id)]);
    return { jobId: String(row.id), jobType: String(row.job_type), indexSnapshotId: row.index_snapshot_id ? String(row.index_snapshot_id) : undefined, productId: row.product_id ? String(row.product_id) : undefined, status: "running", payload: parseV5Json(row.payload, {}), attempt: nextAttempt, maxAttempts: Number(row.max_attempts) };
  });
}

export async function finishRagJob(input: { jobId: string; workerId: string; status: Extract<RagJobStatus, "completed" | "partial_failed" | "failed" | "pending_config" | "awaiting_validation">; failureCode?: string; failureMessage?: string }) {
  const result = await getV5GovernancePool().query(
    `UPDATE rag_index_job SET status = ?, failure_code = ?, failure_message = ?,
     attempt = IF(? = 'pending_config', 0, attempt),
     completed_at = IF(? IN ('completed','failed','pending_config'), NOW(), completed_at),
     available_at = CASE WHEN ? = 'pending_config' THEN DATE_ADD(NOW(), INTERVAL 5 MINUTE)
                         WHEN ? IN ('failed','partial_failed') THEN DATE_ADD(NOW(), INTERVAL 30 SECOND)
                         ELSE available_at END,
     lease_owner = NULL, lease_expires_at = NULL, row_version = row_version + 1
     WHERE id = ? AND lease_owner = ? AND status = 'running'`,
    [input.status, input.failureCode || null, input.failureMessage || null, input.status, input.status, input.status, input.status, input.jobId, input.workerId]
  );
  return result;
}

export async function readRagJobsForSnapshot(indexSnapshotId: string): Promise<RagIndexJobRecord[]> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM rag_index_job WHERE index_snapshot_id = ? ORDER BY created_at",
    [indexSnapshotId]
  );
  return rows.map((row) => ({
    jobId: String(row.id),
    jobType: String(row.job_type),
    indexSnapshotId: row.index_snapshot_id ? String(row.index_snapshot_id) : undefined,
    productId: row.product_id ? String(row.product_id) : undefined,
    status: String(row.status) as RagJobStatus,
    payload: parseV5Json(row.payload, {}),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts)
  }));
}

export async function cancelRagJob(input: { jobId: string; expectedStatus: RagJobStatus; actor: V5GovernanceActor; reasonCode: string }) {
  assertRagJobTransition(input.expectedStatus, "cancelled");
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM rag_index_job WHERE id = ? FOR UPDATE", [input.jobId]);
    const row = rows[0];
    if (!row || String(row.status) !== input.expectedStatus) throw new Error("RAG Job 状态已变化，请刷新后重试。");
    const [updated] = await connection.query<ResultSetHeader>(
      `UPDATE rag_index_job
       SET status = 'cancelled', failure_code = ?, failure_message = ?, completed_at = NOW(),
           lease_owner = NULL, lease_expires_at = NULL, row_version = row_version + 1
       WHERE id = ? AND status = ?`,
      [input.reasonCode, input.actor.auditReason, input.jobId, input.expectedStatus]
    );
    if (updated.affectedRows !== 1) throw new Error("RAG Job 状态已变化，请刷新后重试。");
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rag_job_cancelled",
      objectType: "rag_index_job",
      objectId: input.jobId,
      beforeSummary: { status: input.expectedStatus },
      afterSummary: { status: "cancelled", reasonCode: input.reasonCode },
      correlationId: input.jobId
    });
    return { jobId: input.jobId, status: "cancelled" as const };
  });
}
