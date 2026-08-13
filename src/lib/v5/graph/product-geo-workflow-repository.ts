import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "../knowledge-governance-repository";
import type { ProductGeoGraphExecutionMode, ProductGeoGraphStateValue, ProductGeoGraphStatus } from "./product-geo-workflow-contracts";

export interface ProductGeoGraphWorkflowRunRecord {
  id: string;
  threadId: string;
  productId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  researchPolicyVersion: string;
  executionMode: ProductGeoGraphExecutionMode;
  status: ProductGeoGraphStatus;
  currentNode?: string;
  stateRefs: Partial<ProductGeoGraphStateValue>;
  researchAttempt: number;
  supplementaryRound: number;
  errorCodes: string[];
  rowVersion: number;
  startedBy: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

function date(value: unknown) {
  return new Date(value as string | number | Date).toISOString();
}

function mapRun(row: RowDataPacket): ProductGeoGraphWorkflowRunRecord {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    productId: String(row.product_id),
    sourceSnapshotId: String(row.source_snapshot_id),
    sourceSnapshotHash: String(row.source_snapshot_hash),
    researchPolicyVersion: String(row.research_policy_version),
    executionMode: String(row.execution_mode) as ProductGeoGraphExecutionMode,
    status: String(row.status) as ProductGeoGraphStatus,
    currentNode: row.current_node ? String(row.current_node) : undefined,
    stateRefs: parseV5Json(row.state_refs, {}),
    researchAttempt: Number(row.research_attempt || 0),
    supplementaryRound: Number(row.supplementary_round || 0),
    errorCodes: parseV5Json<string[]>(row.error_codes, []),
    rowVersion: Number(row.row_version || 1),
    startedBy: String(row.started_by),
    startedAt: date(row.started_at),
    updatedAt: date(row.updated_at),
    completedAt: row.completed_at ? date(row.completed_at) : undefined
  };
}

export function createProductGeoGraphThreadId(input: { productId: string; sourceSnapshotHash: string; researchPolicyVersion: string }) {
  const raw = `${input.productId}:${input.sourceSnapshotHash}:${input.researchPolicyVersion}`;
  return raw.length <= 191 ? raw : `geo:${createHash("sha256").update(raw).digest("hex")}`;
}

export async function claimProductGeoGraphWorkflow(input: {
  productId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  researchPolicyVersion: string;
  executionMode: ProductGeoGraphExecutionMode;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  if (input.executionMode !== "shadow") throw new V5GovernanceRepositoryError("graph_active_cutover_blocked", "Graph 尚未通过正式切流门禁，只允许 Shadow 模式。", 409);
  const threadId = createProductGeoGraphThreadId(input);
  const id = `geo-graph-${createHash("sha256").update(`${threadId}:${input.idempotencyKey}`).digest("hex").slice(0, 48)}`;
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_graph_workflow_run WHERE product_id = ? AND idempotency_key = ? FOR UPDATE",
      [input.productId, input.idempotencyKey]
    );
    if (existing[0]) return mapRun(existing[0]);
    try {
      await connection.query(
        `INSERT INTO geo_graph_workflow_run
         (id, thread_id, product_id, source_snapshot_id, source_snapshot_hash, research_policy_version,
          execution_mode, status, state_refs, research_attempt, supplementary_round, error_codes,
          idempotency_key, row_version, started_by, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'shadow', 'running', JSON_OBJECT(), 0, 0, JSON_ARRAY(), ?, 1, ?, NOW())`,
        [id, threadId, input.productId, input.sourceSnapshotId, input.sourceSnapshotHash, input.researchPolicyVersion, input.idempotencyKey, input.actor.actorId]
      );
    } catch (error) {
      const duplicate = error as { code?: string };
      if (duplicate.code !== "ER_DUP_ENTRY") throw error;
      const [sameThread] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_graph_workflow_run WHERE thread_id = ? LIMIT 1", [threadId]);
      if (sameThread[0]) return mapRun(sameThread[0]);
      throw error;
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_graph_shadow_started",
      objectType: "geo_graph_workflow_run",
      objectId: id,
      afterSummary: { threadId, executionMode: "shadow", status: "running" }
    });
    const [created] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_graph_workflow_run WHERE id = ?", [id]);
    return mapRun(created[0]);
  });
}

export async function readProductGeoGraphWorkflow(workflowId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM geo_graph_workflow_run WHERE id = ? LIMIT 1", [workflowId]);
  return rows[0] ? mapRun(rows[0]) : undefined;
}

export async function readLatestProductGeoGraphWorkflow(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM geo_graph_workflow_run WHERE product_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [productId]
  );
  return rows[0] ? mapRun(rows[0]) : undefined;
}

export async function readProductGeoGraphNodeEvents(workflowId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT node_name, attempt, status, input_refs, output_refs, error_code, duration_ms, created_at
     FROM geo_graph_node_event WHERE workflow_run_id = ? ORDER BY id`,
    [workflowId]
  );
  return rows.map((row) => ({
    nodeName: String(row.node_name),
    attempt: Number(row.attempt),
    status: String(row.status),
    inputRefs: parseV5Json<Record<string, unknown>>(row.input_refs, {}),
    outputRefs: parseV5Json<Record<string, unknown>>(row.output_refs, {}),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    durationMs: Number(row.duration_ms || 0),
    createdAt: date(row.created_at)
  }));
}

export async function syncProductGeoGraphWorkflow(input: { workflowId: string; expectedVersion: number; state: ProductGeoGraphStateValue }) {
  const terminal = ["completed", "failed"].includes(input.state.status);
  const [result] = await getV5GovernancePool().query<ResultSetHeader>(
    `UPDATE geo_graph_workflow_run
     SET status = ?, current_node = ?, state_refs = ?, research_attempt = ?, supplementary_round = ?,
         error_codes = ?, row_version = row_version + 1, completed_at = IF(?, NOW(), completed_at)
     WHERE id = ? AND row_version = ?`,
    [input.state.status, input.state.currentNode || null, stringifyV5Json(input.state), input.state.researchAttempt,
      input.state.supplementaryRound, stringifyV5Json(input.state.exceptionCodes), terminal, input.workflowId, input.expectedVersion]
  );
  if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("graph_workflow_stale_version", "Graph 工作流状态已变化，请刷新后重试。", 409);
  const updated = await readProductGeoGraphWorkflow(input.workflowId);
  if (!updated) throw new V5GovernanceRepositoryError("graph_workflow_not_found", "Graph 工作流不存在。", 404);
  return updated;
}

export async function recordProductGeoGraphNodeEvent(input: {
  workflowId: string;
  threadId: string;
  nodeName: string;
  status: "completed" | "failed";
  inputRefs: Record<string, unknown>;
  outputRefs: Record<string, unknown>;
  durationMs: number;
  errorCode?: string;
}) {
  const [attempts] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt FROM geo_graph_node_event WHERE workflow_run_id = ? AND node_name = ?",
    [input.workflowId, input.nodeName]
  );
  await getV5GovernancePool().query(
    `INSERT INTO geo_graph_node_event
     (workflow_run_id, thread_id, node_name, attempt, status, input_refs, output_refs, error_code, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.workflowId, input.threadId, input.nodeName, Number(attempts[0]?.next_attempt || 1), input.status,
      stringifyV5Json(input.inputRefs), stringifyV5Json(input.outputRefs), input.errorCode || null, Math.max(0, Math.floor(input.durationMs))]
  );
}

export function newProductGeoGraphWorkflowId() {
  return `geo-graph-${randomUUID()}`;
}
