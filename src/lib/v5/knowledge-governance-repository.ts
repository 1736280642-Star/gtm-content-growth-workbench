import { createHash, randomUUID } from "node:crypto";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { V5GateCode } from "./knowledge-governance-contracts";
import type { V5GateResult } from "./knowledge-governance-workflow";

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"] as const;

interface GlobalWithV5Pool {
  __v5KnowledgeGovernancePool?: Pool;
}

export class V5GovernanceRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly nextAction?: string
  ) {
    super(message);
    this.name = "V5GovernanceRepositoryError";
  }
}

export interface V5GovernanceActor {
  actorId: string;
  actorRole: string;
  actorType: "human" | "agent" | "scheduler" | "system";
  auditReason: string;
}

export interface V5IngestionBatchRecord {
  batchId: string;
  idempotencyKey: string;
  purpose?: string;
  targetKnowledgeBaseId?: string;
  targetProductId?: string;
  status: string;
  currentGate: V5GateCode;
  rowVersion: number;
  sourceCount: number;
  successCount: number;
  failedCount: number;
  isolatedCount: number;
  pendingReviewCount: number;
  parserVersion?: string;
  classifierVersion?: string;
  extractorVersion?: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface V5GovernanceRunRecord {
  runId: string;
  batchId: string;
  productId?: string;
  status: string;
  currentGate: V5GateCode;
  rulePackageVersionId?: string;
  sourceSnapshotId?: string;
  readinessId?: string;
  idempotencyKey: string;
  version: number;
  startedAt: string;
  completedAt?: string;
}

export function getV5GovernancePool() {
  const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    throw new V5GovernanceRepositoryError(
      "pending_config",
      `V5 知识治理数据库尚未配置：${missingEnv.join(", ")}`,
      503,
      "配置 MySQL 环境变量后重试；不得回退到本地假数据冒充治理写入。"
    );
  }

  const globalObject = globalThis as unknown as GlobalWithV5Pool;
  if (!globalObject.__v5KnowledgeGovernancePool) {
    globalObject.__v5KnowledgeGovernancePool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      connectionLimit: 5,
      enableKeepAlive: true
    });
  }

  return globalObject.__v5KnowledgeGovernancePool;
}

export function hasV5GovernanceDatabaseConfig() {
  return requiredEnv.every((name) => Boolean(process.env[name]?.trim()));
}

export function hashV5GovernancePayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function stringifyV5Json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function parseV5Json<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

export async function withV5GovernanceTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
  const connection = await getV5GovernancePool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function readV5Idempotency(connection: PoolConnection, idempotencyKey: string, requestHash: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT request_hash, resource_type, resource_id, response_status, response_summary FROM governance_idempotency_record WHERE idempotency_key = ? FOR UPDATE",
    [idempotencyKey]
  );
  const existing = rows[0];
  if (!existing) return undefined;
  if (String(existing.request_hash) !== requestHash) {
    throw new V5GovernanceRepositoryError(
      "idempotency_conflict",
      "同一个 idempotencyKey 被用于不同请求。",
      409,
      "使用原请求重试，或为新的业务操作生成新的 idempotencyKey。"
    );
  }
  return {
    resourceType: existing.resource_type ? String(existing.resource_type) : undefined,
    resourceId: existing.resource_id ? String(existing.resource_id) : undefined,
    responseStatus: String(existing.response_status),
    responseSummary: parseV5Json(existing.response_summary, {})
  };
}

export async function writeV5Idempotency(
  connection: PoolConnection,
  input: {
    idempotencyKey: string;
    operationType: string;
    requestHash: string;
    resourceType?: string;
    resourceId?: string;
    responseStatus: string;
    responseSummary?: unknown;
  }
) {
  await connection.query(
    `INSERT INTO governance_idempotency_record
      (idempotency_key, operation_type, request_hash, resource_type, resource_id, response_status, response_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.idempotencyKey,
      input.operationType,
      input.requestHash,
      input.resourceType || null,
      input.resourceId || null,
      input.responseStatus,
      stringifyV5Json(input.responseSummary || {})
    ]
  );
}

export async function writeV5GovernanceAudit(
  connection: PoolConnection,
  input: V5GovernanceActor & {
    eventType: string;
    objectType: string;
    objectId: string;
    relatedSourceIds?: string[];
    beforeSummary?: unknown;
    afterSummary?: unknown;
    correlationId?: string;
  }
) {
  await connection.query(
    `INSERT INTO governance_audit_event
      (id, event_type, actor_id, actor_role, actor_type, object_type, object_id, related_source_ids, before_summary, after_summary, reason, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `audit-${randomUUID()}`,
      input.eventType,
      input.actorId,
      input.actorRole,
      input.actorType,
      input.objectType,
      input.objectId,
      stringifyV5Json(input.relatedSourceIds || []),
      input.beforeSummary === undefined ? null : stringifyV5Json(input.beforeSummary),
      input.afterSummary === undefined ? null : stringifyV5Json(input.afterSummary),
      input.auditReason,
      input.correlationId || null
    ]
  );
}

function mapBatch(row: RowDataPacket): V5IngestionBatchRecord {
  return {
    batchId: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    purpose: row.purpose ? String(row.purpose) : undefined,
    targetKnowledgeBaseId: row.target_knowledge_base_id ? String(row.target_knowledge_base_id) : undefined,
    targetProductId: row.target_product_id ? String(row.target_product_id) : undefined,
    status: String(row.status),
    currentGate: String(row.current_gate) as V5GateCode,
    rowVersion: Number(row.row_version),
    sourceCount: Number(row.source_count),
    successCount: Number(row.success_count),
    failedCount: Number(row.failed_count),
    isolatedCount: Number(row.isolated_count),
    pendingReviewCount: Number(row.pending_review_count),
    parserVersion: row.parser_version ? String(row.parser_version) : undefined,
    classifierVersion: row.classifier_version ? String(row.classifier_version) : undefined,
    extractorVersion: row.extractor_version ? String(row.extractor_version) : undefined,
    requestedBy: String(row.requested_by),
    createdAt: asDate(row.created_at) || "",
    updatedAt: asDate(row.updated_at) || ""
  };
}

function mapRun(row: RowDataPacket): V5GovernanceRunRecord {
  return {
    runId: String(row.id),
    batchId: String(row.batch_id),
    productId: row.product_id ? String(row.product_id) : undefined,
    status: String(row.status),
    currentGate: String(row.current_gate) as V5GateCode,
    rulePackageVersionId: row.rule_package_version_id ? String(row.rule_package_version_id) : undefined,
    sourceSnapshotId: row.source_snapshot_id ? String(row.source_snapshot_id) : undefined,
    readinessId: row.readiness_id ? String(row.readiness_id) : undefined,
    idempotencyKey: String(row.idempotency_key),
    version: Number(row.version),
    startedAt: asDate(row.started_at) || "",
    completedAt: asDate(row.completed_at)
  };
}

export async function createV5IngestionBatchRecord(input: {
  idempotencyKey: string;
  purpose?: string;
  targetKnowledgeBaseId?: string;
  targetProductId?: string;
  sourceCount: number;
  parserVersion?: string;
  classifierVersion?: string;
  extractorVersion?: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: { ...input.actor, auditReason: undefined } });

  return withV5GovernanceTransaction(async (connection) => {
    const existing = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (existing?.resourceId) {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM ingestion_batch WHERE id = ?", [existing.resourceId]);
      if (rows[0]) return { replayed: true, batch: mapBatch(rows[0]) };
    }

    const batchId = `ing-${randomUUID()}`;
    await connection.query(
      `INSERT INTO ingestion_batch
        (id, idempotency_key, purpose, target_knowledge_base_id, target_product_id, status, current_gate, source_count, parser_version, classifier_version, extractor_version, requested_by)
       VALUES (?, ?, ?, ?, ?, 'draft', 'G0', ?, ?, ?, ?, ?)`,
      [
        batchId,
        input.idempotencyKey,
        input.purpose || null,
        input.targetKnowledgeBaseId || null,
        input.targetProductId || null,
        input.sourceCount,
        input.parserVersion || null,
        input.classifierVersion || null,
        input.extractorVersion || null,
        input.actor.actorId
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "ingestion_batch_created",
      objectType: "ingestion_batch",
      objectId: batchId,
      afterSummary: { status: "draft", currentGate: "G0", sourceCount: input.sourceCount },
      correlationId: batchId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_ingestion_batch",
      requestHash,
      resourceType: "ingestion_batch",
      resourceId: batchId,
      responseStatus: "created",
      responseSummary: { batchId }
    });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM ingestion_batch WHERE id = ?", [batchId]);
    return { replayed: false, batch: mapBatch(rows[0]) };
  });
}

export async function readV5IngestionBatchRecord(batchId: string) {
  const pool = getV5GovernancePool();
  const [batchRows] = await pool.query<RowDataPacket[]>("SELECT * FROM ingestion_batch WHERE id = ? LIMIT 1", [batchId]);
  if (!batchRows[0]) return undefined;
  const [sourceRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, document_type, authority_level, lifecycle_status, visibility, status, safety_status, quality_flags, row_version, created_at, updated_at
     FROM source_asset WHERE batch_id = ? ORDER BY created_at, id`,
    [batchId]
  );
  const [runRows] = await pool.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE batch_id = ? ORDER BY started_at DESC", [batchId]);
  return {
    batch: mapBatch(batchRows[0]),
    sources: sourceRows.map((row) => ({
      sourceId: String(row.id),
      title: row.title ? String(row.title) : undefined,
      documentType: String(row.document_type),
      authorityLevel: String(row.authority_level),
      lifecycleStatus: String(row.lifecycle_status),
      visibility: String(row.visibility),
      status: String(row.status),
      safetyStatus: String(row.safety_status),
      qualityFlags: parseV5Json<string[]>(row.quality_flags, []),
      rowVersion: Number(row.row_version),
      createdAt: asDate(row.created_at),
      updatedAt: asDate(row.updated_at)
    })),
    runs: runRows.map(mapRun)
  };
}

export async function createV5GovernanceRunRecord(input: {
  batchId: string;
  productId?: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ batchId: input.batchId, productId: input.productId, actorId: input.actor.actorId });
  return withV5GovernanceTransaction(async (connection) => {
    const existing = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (existing?.resourceId) {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ?", [existing.resourceId]);
      if (rows[0]) return { replayed: true, run: mapRun(rows[0]) };
    }
    const [batchRows] = await connection.query<RowDataPacket[]>("SELECT id FROM ingestion_batch WHERE id = ? FOR UPDATE", [input.batchId]);
    if (!batchRows[0]) throw new V5GovernanceRepositoryError("not_found", "导入批次不存在。", 404);
    const runId = `govrun-${randomUUID()}`;
    await connection.query(
      `INSERT INTO knowledge_governance_run
        (id, batch_id, product_id, status, current_gate, idempotency_key, expected_version, version)
       VALUES (?, ?, ?, 'running', 'G0', ?, 1, 1)`,
      [runId, input.batchId, input.productId || null, input.idempotencyKey]
    );
    await connection.query("UPDATE ingestion_batch SET status = 'parsing', current_gate = 'G0', row_version = row_version + 1 WHERE id = ?", [input.batchId]);
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "knowledge_governance_run_created",
      objectType: "knowledge_governance_run",
      objectId: runId,
      afterSummary: { batchId: input.batchId, currentGate: "G0" },
      correlationId: runId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_governance_run",
      requestHash,
      resourceType: "knowledge_governance_run",
      resourceId: runId,
      responseStatus: "created",
      responseSummary: { runId }
    });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ?", [runId]);
    return { replayed: false, run: mapRun(rows[0]) };
  });
}

export async function readV5GovernanceRunRecord(runId: string) {
  const pool = getV5GovernancePool();
  const [runRows] = await pool.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ? LIMIT 1", [runId]);
  if (!runRows[0]) return undefined;
  const [gateRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, gate_code, attempt, status, decision, reason_codes, blockers, next_actions, payload_summary, evaluator_version, evaluated_at
     FROM knowledge_governance_gate_result WHERE run_id = ? ORDER BY evaluated_at, gate_code, attempt`,
    [runId]
  );
  return {
    run: mapRun(runRows[0]),
    gates: gateRows.map((row) => ({
      gateResultId: String(row.id),
      gate: String(row.gate_code),
      attempt: Number(row.attempt),
      status: String(row.status),
      decision: String(row.decision),
      reasonCodes: parseV5Json<string[]>(row.reason_codes, []),
      blockers: parseV5Json<string[]>(row.blockers, []),
      nextActions: parseV5Json<string[]>(row.next_actions, []),
      output: parseV5Json<Record<string, unknown>>(row.payload_summary, {}),
      evaluatorVersion: String(row.evaluator_version),
      evaluatedAt: asDate(row.evaluated_at)
    }))
  };
}

export async function persistV5GateResult(input: {
  runId: string;
  gate: V5GateCode;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  evaluatorVersion: string;
  result: V5GateResult;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const existing = await readV5Idempotency(connection, input.idempotencyKey, input.requestHash);
    if (existing?.resourceId) {
      const [runRows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ?", [input.runId]);
      const [gateRows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_gate_result WHERE id = ?", [existing.resourceId]);
      return { replayed: true, run: mapRun(runRows[0]), gateResultId: existing.resourceId, storedResult: gateRows[0] };
    }

    const [runRows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ? FOR UPDATE", [input.runId]);
    const run = runRows[0];
    if (!run) throw new V5GovernanceRepositoryError("not_found", "治理运行不存在。", 404);
    if (Number(run.version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `治理运行版本已变化，当前版本为 ${run.version}。`, 409, "刷新运行状态后，使用新的 expectedVersion 重试。");
    }
    if (String(run.current_gate) !== input.gate) {
      throw new V5GovernanceRepositoryError("gate_order_conflict", `当前应执行 ${run.current_gate}，不能直接写入 ${input.gate}。`, 409, "按 G0-G6 顺序执行；不得跳过前置闸门。");
    }

    const [attemptRows] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt FROM knowledge_governance_gate_result WHERE run_id = ? AND gate_code = ?",
      [input.runId, input.gate]
    );
    const attempt = Number(attemptRows[0]?.next_attempt || 1);
    const gateResultId = `gate-${randomUUID()}`;
    await connection.query(
      `INSERT INTO knowledge_governance_gate_result
        (id, run_id, gate_code, attempt, status, decision, input_fingerprint, reason_codes, blockers, next_actions, payload_summary, evaluator_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gateResultId,
        input.runId,
        input.gate,
        attempt,
        input.result.status,
        input.result.decision,
        input.requestHash,
        stringifyV5Json(input.result.reasonCodes),
        stringifyV5Json(input.result.blockers),
        stringifyV5Json(input.result.nextActions),
        stringifyV5Json(input.result.output),
        input.evaluatorVersion
      ]
    );

    const runStatus = input.result.ok ? (input.gate === "G6" ? "completed" : "running") : input.result.status === "pending_input" ? "awaiting_input" : "blocked";
    const nextGate = input.result.ok && input.result.nextGate ? input.result.nextGate : input.gate;
    const completedAt = runStatus === "completed" ? new Date() : null;
    const [updateResult] = await connection.query(
      `UPDATE knowledge_governance_run
       SET status = ?, current_gate = ?, expected_version = ?, version = version + 1, completed_at = ?
       WHERE id = ? AND version = ?`,
      [runStatus, nextGate, input.expectedVersion + 1, completedAt, input.runId, input.expectedVersion]
    );
    if ((updateResult as { affectedRows?: number }).affectedRows !== 1) {
      throw new V5GovernanceRepositoryError("version_conflict", "治理运行被并发修改。", 409, "刷新后重试。");
    }

    const batchStatus = input.result.ok
      ? input.gate === "G6"
        ? "completed"
        : input.gate === "G5"
          ? "awaiting_approval"
          : input.gate === "G4"
            ? "generating_rule_draft"
            : input.gate === "G3"
              ? "reviewing_conflicts"
              : input.gate === "G2"
                ? "extracting_claims"
                : input.gate === "G1"
                  ? "classifying"
                  : "parsing"
      : input.gate === "G0" && input.result.decision === "isolate"
        ? "blocked_sensitive_data"
        : input.gate === "G2"
          ? "blocked_entity_ambiguous"
          : input.gate === "G4"
            ? "blocked_evidence_conflict"
            : "partial_failed";
    await connection.query(
      "UPDATE ingestion_batch SET status = ?, current_gate = ?, row_version = row_version + 1, completed_at = ? WHERE id = ?",
      [batchStatus, nextGate, completedAt, String(run.batch_id)]
    );

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: `governance_gate_${input.gate.toLowerCase()}_evaluated`,
      objectType: "knowledge_governance_run",
      objectId: input.runId,
      beforeSummary: { status: String(run.status), currentGate: String(run.current_gate), version: Number(run.version) },
      afterSummary: { status: runStatus, currentGate: nextGate, version: input.expectedVersion + 1, gateStatus: input.result.status },
      correlationId: input.runId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: `evaluate_${input.gate.toLowerCase()}`,
      requestHash: input.requestHash,
      resourceType: "knowledge_governance_gate_result",
      resourceId: gateResultId,
      responseStatus: input.result.status,
      responseSummary: { runId: input.runId, gate: input.gate, gateResultId }
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM knowledge_governance_run WHERE id = ?", [input.runId]);
    return { replayed: false, run: mapRun(updatedRows[0]), gateResultId, storedResult: input.result };
  });
}

export async function readV5RuleActivationContext(rulePackageVersionId: string) {
  const pool = getV5GovernancePool();
  const [versionRows] = await pool.query<RowDataPacket[]>(
    `SELECT v.*, p.active_version_id
     FROM rule_package_version v
     JOIN product_expression_rule_package p ON p.id = v.rule_package_id
     WHERE v.id = ? LIMIT 1`,
    [rulePackageVersionId]
  );
  const version = versionRows[0];
  if (!version) return undefined;
  const productId = String(version.product_id);
  const [claimRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS approved_claim_count
     FROM rule_package_claim rpc
     JOIN product_claim pc ON pc.id = rpc.claim_id
     WHERE rpc.rule_package_version_id = ? AND pc.review_status IN ('supported', 'conditional')`,
    [rulePackageVersionId]
  );
  const [conflictRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, severity, status FROM claim_conflict WHERE product_id = ? AND status = 'open'",
    [productId]
  );
  const [gapRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, severity, status, affected_rule_fields FROM evidence_gap WHERE product_id = ? AND status IN ('open', 'in_progress')",
    [productId]
  );
  const [approvalRows] = await pool.query<RowDataPacket[]>(
    `SELECT role, action, status FROM approval_record
     WHERE (object_type = 'package' AND object_id = ?)
        OR (object_type = 'change' AND object_id IN (SELECT id FROM rule_package_change WHERE rule_package_version_id = ?))
     ORDER BY created_at`,
    [rulePackageVersionId, rulePackageVersionId]
  );
  return {
    rulePackageVersionId,
    rulePackageId: String(version.rule_package_id),
    productId,
    status: String(version.status),
    rowVersion: Number(version.row_version),
    pendingRoles: parseV5Json<string[]>(version.pending_roles, []),
    productIdentity: parseV5Json<Record<string, unknown>>(version.product_identity, {}),
    sourceSnapshotHash: version.source_snapshot_hash ? String(version.source_snapshot_hash) : undefined,
    approvedClaimCount: Number(claimRows[0]?.approved_claim_count || 0),
    conflicts: conflictRows.map((row) => ({ id: String(row.id), severity: String(row.severity), status: String(row.status) })),
    gaps: gapRows.map((row) => ({
      id: String(row.id),
      severity: String(row.severity),
      status: String(row.status),
      affectedRuleFields: parseV5Json<string[]>(row.affected_rule_fields, [])
    })),
    approvals: approvalRows.map((row) => ({ role: String(row.role), action: String(row.action), status: String(row.status) }))
  };
}

export async function activateV5RulePackageVersionRecord(input: {
  rulePackageVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  actor: V5GovernanceActor;
  gateResult: V5GateResult;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const existing = await readV5Idempotency(connection, input.idempotencyKey, input.requestHash);
    if (existing?.resourceId) return { replayed: true, rulePackageVersionId: existing.resourceId, status: "active" };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM rule_package_version WHERE id = ? FOR UPDATE", [input.rulePackageVersionId]);
    const version = rows[0];
    if (!version) throw new V5GovernanceRepositoryError("not_found", "规则包版本不存在。", 404);
    if (Number(version.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `规则包版本已变化，当前 rowVersion 为 ${version.row_version}。`, 409, "刷新差异和审批状态后重试。");
    }
    if (!input.gateResult.ok) throw new V5GovernanceRepositoryError("approval_required", "G5 未通过，规则包不能激活。", 409, input.gateResult.nextActions[0]);
    const rulePackageId = String(version.rule_package_id);
    await connection.query(
      "UPDATE rule_package_version SET status = 'deprecated', superseded_at = NOW(), row_version = row_version + 1 WHERE rule_package_id = ? AND status = 'active' AND id <> ?",
      [rulePackageId, input.rulePackageVersionId]
    );
    await connection.query(
      `UPDATE rule_package_version
       SET status = 'active', pending_roles = ?, approved_at = COALESCE(approved_at, NOW()), approved_by = ?, activated_at = NOW(), immutable_at = COALESCE(immutable_at, NOW()), row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [stringifyV5Json([]), input.actor.actorId, input.rulePackageVersionId, input.expectedVersion]
    );
    await connection.query(
      "UPDATE product_expression_rule_package SET active_version_id = ?, status = 'active', row_version = row_version + 1 WHERE id = ?",
      [input.rulePackageVersionId, rulePackageId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_package_activated",
      objectType: "rule_package_version",
      objectId: input.rulePackageVersionId,
      beforeSummary: { status: String(version.status), rowVersion: Number(version.row_version) },
      afterSummary: { status: "active", rowVersion: input.expectedVersion + 1 },
      correlationId: input.rulePackageVersionId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "activate_rule_package_version",
      requestHash: input.requestHash,
      resourceType: "rule_package_version",
      resourceId: input.rulePackageVersionId,
      responseStatus: "active",
      responseSummary: { rulePackageVersionId: input.rulePackageVersionId }
    });
    return { replayed: false, rulePackageVersionId: input.rulePackageVersionId, status: "active", rowVersion: input.expectedVersion + 1 };
  });
}

export async function rollbackV5RulePackageVersionRecord(input: {
  rulePackageVersionId: string;
  targetRulePackageVersionId: string;
  expectedVersion: number;
  targetExpectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, input.requestHash);
    if (replay?.resourceId) {
      const summary = replay.responseSummary as Record<string, unknown>;
      return {
        replayed: true,
        rulePackageVersionId: input.rulePackageVersionId,
        targetRulePackageVersionId: replay.resourceId,
        status: "active",
        currentRowVersion: Number(summary.currentRowVersion),
        targetRowVersion: Number(summary.targetRowVersion),
        suspendedProductionPoolEntryCount: Number(summary.suspendedProductionPoolEntryCount || 0)
      };
    }
    if (input.rulePackageVersionId === input.targetRulePackageVersionId) {
      throw new V5GovernanceRepositoryError("invalid_contract", "回滚目标必须是另一个明确的历史版本。", 400);
    }

    const [packageRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_expression_rule_package WHERE active_version_id = ? FOR UPDATE",
      [input.rulePackageVersionId]
    );
    const rulePackage = packageRows[0];
    if (!rulePackage) {
      throw new V5GovernanceRepositoryError(
        "invalid_state",
        "路径中的规则包版本不是该产品当前 active 版本。",
        409,
        "刷新规则包状态后，以当前 active 版本作为回滚起点。"
      );
    }

    const [versionRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM rule_package_version WHERE id IN (?, ?) ORDER BY id FOR UPDATE",
      [input.rulePackageVersionId, input.targetRulePackageVersionId]
    );
    const current = versionRows.find((row) => String(row.id) === input.rulePackageVersionId);
    const target = versionRows.find((row) => String(row.id) === input.targetRulePackageVersionId);
    if (!current || !target) throw new V5GovernanceRepositoryError("not_found", "当前版本或目标历史版本不存在。", 404);
    if (Number(current.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `当前 active 版本的 rowVersion 为 ${current.row_version}。`,
        409,
        "刷新当前规则包版本后重试。"
      );
    }
    if (Number(target.row_version) !== input.targetExpectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `回滚目标版本的 rowVersion 为 ${target.row_version}。`,
        409,
        "刷新目标历史版本后重试。"
      );
    }
    if (String(current.status) !== "active") {
      throw new V5GovernanceRepositoryError("invalid_state", "只有当前 active 版本可以作为回滚起点。", 409);
    }
    if (String(current.rule_package_id) !== String(target.rule_package_id) || String(rulePackage.id) !== String(target.rule_package_id)) {
      throw new V5GovernanceRepositoryError("invalid_contract", "回滚目标不属于当前产品的同一个规则包。", 400);
    }
    if (!["deprecated", "rolled_back"].includes(String(target.status))) {
      throw new V5GovernanceRepositoryError(
        "invalid_state",
        "回滚目标必须是 deprecated 或 rolled_back 的历史版本。",
        409,
        "草稿版本应先完成差异复核和 G5 激活，不能通过回滚绕过审批。"
      );
    }
    if (!target.immutable_at) {
      throw new V5GovernanceRepositoryError("invalid_state", "回滚目标尚未冻结，不能作为可信历史版本。", 409);
    }
    if (!target.approved_at || !target.approved_by || parseV5Json<string[]>(target.pending_roles, []).length > 0) {
      throw new V5GovernanceRepositoryError("approval_required", "回滚目标没有完整的历史人工批准记录。", 409);
    }

    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_snapshot WHERE product_id = ? AND snapshot_hash = ? LIMIT 1 FOR UPDATE",
      [String(target.product_id), String(target.source_snapshot_hash)]
    );
    if (!snapshotRows[0]) {
      throw new V5GovernanceRepositoryError(
        "snapshot_missing",
        "回滚目标对应的 source_snapshot 不存在。",
        409,
        "恢复目标版本的固定来源快照后再重试；不能用当前资料替代历史证据。"
      );
    }

    const [poolRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, status, version, readiness_id, monthly_plan_id FROM production_pool_entry WHERE product_id = ? AND status = 'approved' FOR UPDATE",
      [String(target.product_id)]
    );
    await connection.query(
      "UPDATE rule_package_version SET status = 'rolled_back', superseded_at = NOW(), row_version = row_version + 1 WHERE id = ? AND row_version = ?",
      [input.rulePackageVersionId, input.expectedVersion]
    );
    await connection.query(
      `UPDATE rule_package_version
       SET status = 'active', pending_roles = ?, activated_at = NOW(), superseded_at = NULL, row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [stringifyV5Json([]), input.targetRulePackageVersionId, input.targetExpectedVersion]
    );
    await connection.query(
      "UPDATE product_expression_rule_package SET active_version_id = ?, status = 'active', row_version = row_version + 1 WHERE id = ? AND active_version_id = ?",
      [input.targetRulePackageVersionId, String(rulePackage.id), input.rulePackageVersionId]
    );
    if (poolRows.length > 0) {
      await connection.query(
        "UPDATE production_pool_entry SET status = 'blocked', suspended_at = NOW(), version = version + 1 WHERE product_id = ? AND status = 'approved'",
        [String(target.product_id)]
      );
    }

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_package_rolled_back",
      objectType: "rule_package_version",
      objectId: input.rulePackageVersionId,
      beforeSummary: { status: "active", rowVersion: input.expectedVersion },
      afterSummary: {
        status: "rolled_back",
        rowVersion: input.expectedVersion + 1,
        rollbackTargetRulePackageVersionId: input.targetRulePackageVersionId
      },
      correlationId: input.rulePackageVersionId
    });
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_package_rollback_target_activated",
      objectType: "rule_package_version",
      objectId: input.targetRulePackageVersionId,
      beforeSummary: { status: String(target.status), rowVersion: input.targetExpectedVersion },
      afterSummary: {
        status: "active",
        rowVersion: input.targetExpectedVersion + 1,
        sourceSnapshotHash: String(target.source_snapshot_hash),
        rolledBackFromRulePackageVersionId: input.rulePackageVersionId
      },
      correlationId: input.rulePackageVersionId
    });
    for (const poolEntry of poolRows) {
      await writeV5GovernanceAudit(connection, {
        ...input.actor,
        eventType: "production_pool_suspended_by_rule_rollback",
        objectType: "production_pool_entry",
        objectId: String(poolEntry.id),
        beforeSummary: { status: String(poolEntry.status), version: Number(poolEntry.version), readinessId: String(poolEntry.readiness_id) },
        afterSummary: { status: "blocked", version: Number(poolEntry.version) + 1, monthlyPlanId: String(poolEntry.monthly_plan_id) },
        correlationId: input.rulePackageVersionId
      });
    }

    const responseSummary = {
      rulePackageVersionId: input.rulePackageVersionId,
      targetRulePackageVersionId: input.targetRulePackageVersionId,
      currentRowVersion: input.expectedVersion + 1,
      targetRowVersion: input.targetExpectedVersion + 1,
      suspendedProductionPoolEntryCount: poolRows.length
    };
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "rollback_rule_package_version",
      requestHash: input.requestHash,
      resourceType: "rule_package_version",
      resourceId: input.targetRulePackageVersionId,
      responseStatus: "active",
      responseSummary
    });
    return { replayed: false, status: "active", ...responseSummary };
  });
}

export async function readV5ReadinessContext(productId: string) {
  const pool = getV5GovernancePool();
  const [versionRows] = await pool.query<RowDataPacket[]>(
    `SELECT v.* FROM product_expression_rule_package p
     JOIN rule_package_version v ON v.id = p.active_version_id
     WHERE p.product_id = ? AND p.status = 'active' AND v.status = 'active' LIMIT 1`,
    [productId]
  );
  const version = versionRows[0];
  if (!version) return { productId };
  const [snapshotRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, snapshot_hash FROM source_snapshot WHERE product_id = ? AND snapshot_hash = ? LIMIT 1",
    [productId, String(version.source_snapshot_hash)]
  );
  const [gapRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, severity, status, affected_rule_fields FROM evidence_gap WHERE product_id = ? AND status IN ('open', 'in_progress')",
    [productId]
  );
  const [readinessRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, version FROM monthly_production_readiness WHERE product_id = ? AND rule_package_version_id = ? LIMIT 1",
    [productId, String(version.id)]
  );
  return {
    productId,
    rulePackageVersionId: String(version.id),
    rulePackageStatus: String(version.status),
    sourceSnapshotId: snapshotRows[0] ? String(snapshotRows[0].id) : undefined,
    sourceSnapshotHash: snapshotRows[0] ? String(snapshotRows[0].snapshot_hash) : undefined,
    monthlyMatrixScope: parseV5Json<Record<string, unknown>>(version.monthly_matrix_scope, {}),
    evidenceGapIds: parseV5Json<string[]>(version.evidence_gap_ids, []),
    gaps: gapRows.map((row) => ({
      id: String(row.id),
      severity: String(row.severity),
      status: String(row.status),
      affectedRuleFields: parseV5Json<string[]>(row.affected_rule_fields, [])
    })),
    existingReadinessId: readinessRows[0] ? String(readinessRows[0].id) : undefined,
    existingReadinessVersion: readinessRows[0] ? Number(readinessRows[0].version) : 0
  };
}

export async function readV5MonthlyReadinessRecord(productId: string) {
  const pool = getV5GovernancePool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM monthly_production_readiness
     WHERE product_id = ? ORDER BY evaluated_at DESC, updated_at DESC LIMIT 1`,
    [productId]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    readinessId: String(row.id),
    productId: String(row.product_id),
    rulePackageVersionId: String(row.rule_package_version_id),
    sourceSnapshotId: row.source_snapshot_id ? String(row.source_snapshot_id) : undefined,
    sourceSnapshotHash: row.source_snapshot_hash ? String(row.source_snapshot_hash) : undefined,
    monthlyProductionReady: Boolean(row.monthly_production_ready),
    allowedContentTypes: parseV5Json<string[]>(row.allowed_content_types, []),
    conditionalContentTypes: parseV5Json<string[]>(row.conditional_content_types, []),
    blockedContentTypes: parseV5Json<string[]>(row.blocked_content_types, []),
    allowedChannels: parseV5Json<string[]>(row.allowed_channels, []),
    requiredEvidenceRoles: parseV5Json<string[]>(row.required_evidence_roles, []),
    evidenceGapIds: parseV5Json<string[]>(row.evidence_gap_ids, []),
    maxMonthlyQuota: row.max_monthly_quota === null ? undefined : Number(row.max_monthly_quota),
    reasonCodes: parseV5Json<string[]>(row.reason_codes, []),
    status: String(row.status),
    evaluatedAt: asDate(row.evaluated_at),
    evaluatorVersion: row.evaluator_version ? String(row.evaluator_version) : undefined,
    governanceRunId: row.governance_run_id ? String(row.governance_run_id) : undefined,
    version: Number(row.version),
    approvedAt: asDate(row.approved_at),
    approvedBy: row.approved_by ? String(row.approved_by) : undefined
  };
}

export async function upsertV5MonthlyReadinessRecord(input: {
  productId: string;
  rulePackageVersionId: string;
  sourceSnapshotId?: string;
  sourceSnapshotHash?: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  evaluatorVersion: string;
  governanceRunId?: string;
  gateResult: V5GateResult;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const existingOperation = await readV5Idempotency(connection, input.idempotencyKey, input.requestHash);
    if (existingOperation?.resourceId) {
      return { replayed: true, readinessId: existingOperation.resourceId, monthlyProductionReady: existingOperation.responseStatus === "approved" };
    }
    const [existingRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM monthly_production_readiness WHERE product_id = ? AND rule_package_version_id = ? FOR UPDATE",
      [input.productId, input.rulePackageVersionId]
    );
    const existing = existingRows[0];
    const currentVersion = existing ? Number(existing.version) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `月度准备度当前版本为 ${currentVersion}。`, 409, "刷新准备度后使用新的 expectedVersion 重试。");
    }
    const output = input.gateResult.output;
    const ready = output.monthlyProductionReady === true;
    const status = ready ? "approved" : "blocked";
    const readinessId = existing ? String(existing.id) : `ready-${randomUUID()}`;
    const fields = {
      allowedContentTypes: parseV5Json<string[]>(output.allowedContentTypes, []),
      conditionalContentTypes: parseV5Json<string[]>(output.conditionalContentTypes, []),
      blockedContentTypes: parseV5Json<string[]>(output.blockedContentTypes, []),
      allowedChannels: parseV5Json<string[]>(output.allowedChannels, []),
      requiredEvidenceRoles: parseV5Json<string[]>(output.requiredEvidenceRoles, []),
      evidenceGapIds: parseV5Json<string[]>(output.evidenceGapIds, []),
      maxMonthlyQuota: typeof output.maxMonthlyQuota === "number" ? output.maxMonthlyQuota : null
    };

    if (existing) {
      await connection.query(
        `UPDATE monthly_production_readiness SET
          source_snapshot_id = ?, source_snapshot_hash = ?, monthly_production_ready = ?, allowed_content_types = ?, conditional_content_types = ?, blocked_content_types = ?,
          allowed_channels = ?, required_evidence_roles = ?, evidence_gap_ids = ?, max_monthly_quota = ?, reason_codes = ?, status = ?, evaluated_at = NOW(), evaluator_version = ?,
          governance_run_id = ?, approved_at = ?, approved_by = ?, version = version + 1
         WHERE id = ? AND version = ?`,
        [
          input.sourceSnapshotId || null,
          input.sourceSnapshotHash || null,
          ready,
          stringifyV5Json(fields.allowedContentTypes),
          stringifyV5Json(fields.conditionalContentTypes),
          stringifyV5Json(fields.blockedContentTypes),
          stringifyV5Json(fields.allowedChannels),
          stringifyV5Json(fields.requiredEvidenceRoles),
          stringifyV5Json(fields.evidenceGapIds),
          fields.maxMonthlyQuota,
          stringifyV5Json(input.gateResult.reasonCodes),
          status,
          input.evaluatorVersion,
          input.governanceRunId || null,
          ready ? new Date() : null,
          ready ? input.actor.actorId : null,
          readinessId,
          input.expectedVersion
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO monthly_production_readiness
          (id, product_id, rule_package_version_id, source_snapshot_id, source_snapshot_hash, monthly_production_ready, allowed_content_types, conditional_content_types,
           blocked_content_types, allowed_channels, required_evidence_roles, evidence_gap_ids, max_monthly_quota, reason_codes, status, evaluated_at, evaluator_version,
           governance_run_id, approved_at, approved_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, 1)`,
        [
          readinessId,
          input.productId,
          input.rulePackageVersionId,
          input.sourceSnapshotId || null,
          input.sourceSnapshotHash || null,
          ready,
          stringifyV5Json(fields.allowedContentTypes),
          stringifyV5Json(fields.conditionalContentTypes),
          stringifyV5Json(fields.blockedContentTypes),
          stringifyV5Json(fields.allowedChannels),
          stringifyV5Json(fields.requiredEvidenceRoles),
          stringifyV5Json(fields.evidenceGapIds),
          fields.maxMonthlyQuota,
          stringifyV5Json(input.gateResult.reasonCodes),
          status,
          input.evaluatorVersion,
          input.governanceRunId || null,
          ready ? new Date() : null,
          ready ? input.actor.actorId : null
        ]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "monthly_production_readiness_evaluated",
      objectType: "monthly_production_readiness",
      objectId: readinessId,
      beforeSummary: existing ? { status: String(existing.status), version: currentVersion } : undefined,
      afterSummary: { status, monthlyProductionReady: ready, version: currentVersion + 1, ...fields },
      correlationId: input.governanceRunId || readinessId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "evaluate_monthly_production_readiness",
      requestHash: input.requestHash,
      resourceType: "monthly_production_readiness",
      resourceId: readinessId,
      responseStatus: status,
      responseSummary: { readinessId, monthlyProductionReady: ready }
    });
    return { replayed: false, readinessId, monthlyProductionReady: ready, status, version: currentVersion + 1, ...fields };
  });
}
