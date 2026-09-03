import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  readV5Idempotency,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "./knowledge-governance-repository";
import type {
  CreateHostedPromotionOrderInput,
  HostedMaterialSummary,
  HostedOrderStatus,
  HostedPromotionOrderRecord,
  HostedSampleProgress
} from "./hosted-managed-contracts";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : "";
}

function mapOrder(row: RowDataPacket): HostedPromotionOrderRecord {
  const lastErrorCode = row.last_error_code ? String(row.last_error_code) : undefined;
  return {
    orderId: String(row.id),
    workspaceId: String(row.workspace_id || "local-default"),
    userId: String(row.user_id || row.created_by || "local-workbench-user"),
    productId: String(row.product_id),
    productName: String(row.product_name || row.display_name || row.canonical_name || row.product_id),
    contactEmail: String(row.contact_email),
    contactEmailVerified: Boolean(row.contact_email_verified_at),
    status: String(row.status) as HostedOrderStatus,
    channels: parseV5Json(row.channel_preferences_json, []),
    dailyCaps: parseV5Json(row.daily_caps_json, {}),
    notificationPreferences: parseV5Json(row.notification_preferences_json, { dailyDigest: true, actionRequired: true, monthlyCompleted: true }),
    materialSummary: parseV5Json<HostedMaterialSummary>(row.material_summary_json, {
      fileNames: [], acceptedSourceCount: 0, failedSources: [], importStatus: "not_required"
    }),
    timezone: String(row.timezone || "Asia/Shanghai"),
    currentMonthlyPlanId: row.current_monthly_plan_id ? String(row.current_monthly_plan_id) : undefined,
    currentStrategyPackId: row.current_strategy_pack_id ? String(row.current_strategy_pack_id) : undefined,
    currentSampleTaskId: row.current_sample_task_id ? String(row.current_sample_task_id) : undefined,
    currentSampleOperationId: row.current_sample_operation_id ? String(row.current_sample_operation_id) : undefined,
    currentActionType: row.current_action_type ? String(row.current_action_type) : undefined,
    pauseReason: row.pause_reason ? String(row.pause_reason) : undefined,
    lastError: lastErrorCode ? { code: lastErrorCode, message: String(row.last_error_message || "需要你处理一项问题。") } : undefined,
    rowVersion: Number(row.row_version || 1),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

const orderSelect = `SELECT order_row.*, product.display_name AS product_name, product.canonical_name
  FROM hosted_promotion_order order_row
  JOIN product_entity product ON product.id = order_row.product_id`;

export async function createHostedPromotionOrderRecord(input: CreateHostedPromotionOrderInput) {
  const requestHash = hashV5GovernancePayload({
    workspaceId: input.workspaceId,
    userId: input.userId,
    productId: input.productId,
    contactEmail: input.contactEmail.toLocaleLowerCase(),
    channels: input.channels,
    materialSummary: input.materialSummary,
    timezone: input.timezone
  });
  return withV5GovernanceTransaction(async (connection) => {
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `${orderSelect} WHERE order_row.workspace_id = ? AND order_row.idempotency_key = ? LIMIT 1 FOR UPDATE`,
      [input.workspaceId, input.idempotencyKey]
    );
    if (existingRows[0]) {
      if (String(existingRows[0].request_hash) !== requestHash) {
        throw new V5GovernanceRepositoryError("hosted_order_idempotency_conflict", "相同提交标识对应了不同托管内容。", 409);
      }
      return { order: mapOrder(existingRows[0]), replayed: true };
    }

    const orderId = `hosted-order-${randomUUID()}`;
    const dailyCaps = Object.fromEntries(input.channels.flatMap((item) => item.dailyCap ? [[item.channel, item.dailyCap]] : []));
    await connection.query(
      `INSERT INTO hosted_promotion_order
       (id, workspace_id, user_id, product_id, contact_email, contact_email_verified_at, status, channel_preferences_json, daily_caps_json,
        notification_preferences_json, material_summary_json, timezone, row_version, idempotency_key, request_hash, created_by)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [orderId, input.workspaceId, input.userId, input.productId, input.contactEmail.toLocaleLowerCase(), input.status || "preparing",
        stringifyV5Json(input.channels), stringifyV5Json(dailyCaps), stringifyV5Json({ dailyDigest: true, actionRequired: true, monthlyCompleted: true }), stringifyV5Json(input.materialSummary),
        input.timezone, input.idempotencyKey, requestHash, input.actorId]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "product_owner",
      actorType: "human",
      auditReason: "用户提交 GEO 托管委托",
      eventType: "hosted_promotion_order_created",
      objectType: "hosted_promotion_order",
      objectId: orderId,
      afterSummary: {
        workspaceId: input.workspaceId,
        productId: input.productId,
        channelCount: input.channels.length,
        materialSourceCount: input.materialSummary.acceptedSourceCount,
        status: input.status || "preparing"
      },
      correlationId: input.productId
    });
    const [createdRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [orderId]);
    return { order: mapOrder(createdRows[0]), replayed: false };
  });
}

export async function readHostedPromotionOrderRecord(orderId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [orderId]);
  return rows[0] ? mapOrder(rows[0]) : undefined;
}

export async function readHostedProductActiveResearchRun(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id, status, created_at
     FROM geo_research_run
     WHERE product_id = ?
       AND status IN ('planned', 'queued', 'running', 'awaiting_frontend', 'synthesizing')
     ORDER BY run_version DESC
     LIMIT 1`,
    [productId]
  );
  return rows[0] ? {
    runId: String(rows[0].id),
    status: String(rows[0].status),
    createdAt: iso(rows[0].created_at)
  } : undefined;
}

export async function readHostedOrderHasInvalidatedWorkflowBinding(order: HostedPromotionOrderRecord) {
  if (!order.currentStrategyPackId && !order.currentSampleTaskId && !order.currentSampleOperationId) return false;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT 1
     FROM product_sample_article_task task
     LEFT JOIN single_article_operation operation ON operation.task_id = task.id
     JOIN final_evidence_pack pack ON pack.id = COALESCE(operation.final_evidence_pack_id, task.final_evidence_pack_id)
     WHERE task.product_id = ?
       AND (
         task.product_strategy_pack_id = ?
         OR task.id = ?
         OR operation.id = ?
       )
       AND pack.invalidated_at IS NOT NULL
     LIMIT 1`,
    [order.productId, order.currentStrategyPackId || "", order.currentSampleTaskId || "", order.currentSampleOperationId || ""]
  );
  return Boolean(rows[0]);
}

export async function readHostedOrderSampleProgress(order: HostedPromotionOrderRecord): Promise<{
  strategyStatus?: string;
  sample?: HostedSampleProgress;
} | undefined> {
  const [strategyRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT strategy.id, strategy.status
     FROM product_strategy_packs strategy
     WHERE strategy.product_id = ?
       AND strategy.id = COALESCE(?, (
         SELECT review.target_id
         FROM hosted_review_request review
         WHERE review.order_id = ? AND review.gate_type = 'strategy'
           AND review.status = 'acted' AND review.decision = 'approve'
         ORDER BY review.acted_at DESC LIMIT 1
       ))
       AND NOT EXISTS (
         SELECT 1 FROM product_sample_article_task invalid_sample
         JOIN final_evidence_pack invalid_pack ON invalid_pack.id = invalid_sample.final_evidence_pack_id
         WHERE invalid_sample.product_strategy_pack_id = strategy.id
           AND invalid_pack.invalidated_at IS NOT NULL
       )
       AND (
         ? IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM geo_research_run newer_research
           WHERE newer_research.product_id = strategy.product_id
             AND newer_research.created_at > strategy.created_at
             AND newer_research.status NOT IN ('failed', 'cancelled')
         )
       )
     LIMIT 1`,
    [order.productId, order.currentStrategyPackId || null, order.orderId, order.currentStrategyPackId || null]
  );
  const strategy = strategyRows[0];
  if (!strategy) return undefined;
  const strategyPackId = String(strategy.id);
  const [sampleRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT task.id AS task_id, task.review_status,
            operation.id AS operation_id, operation.status AS operation_status,
            operation.progress_stage, operation.attempt_count, operation.error_code,
            operation.error_message, operation.next_action,
            draft.copy_allowed
     FROM product_sample_article_task task
     LEFT JOIN single_article_operation operation ON operation.id = COALESCE(?, (
       SELECT candidate.id FROM single_article_operation candidate
       WHERE candidate.task_id = task.id ORDER BY candidate.created_at DESC LIMIT 1
     ))
     LEFT JOIN draft_version draft ON draft.id = operation.draft_version_id AND draft.test_only = FALSE
     WHERE task.product_id = ? AND task.product_strategy_pack_id = ?
       AND task.id = COALESCE(?, (
         SELECT candidate_task.id FROM product_sample_article_task candidate_task
         WHERE candidate_task.product_strategy_pack_id = ?
         ORDER BY candidate_task.updated_at DESC LIMIT 1
       ))
     LIMIT 1`,
    [order.currentSampleOperationId || null, order.productId, strategyPackId,
      order.currentSampleTaskId || null, strategyPackId]
  );
  const row = sampleRows[0];
  if (!row) return { strategyStatus: String(strategy.status) };
  const error = row.error_code ? {
    code: String(row.error_code),
    message: String(row.error_message || "代表样文生成失败。"),
    nextAction: row.next_action ? String(row.next_action) : undefined
  } : undefined;
  return {
    strategyStatus: String(strategy.status),
    sample: {
      strategyPackId,
      taskId: String(row.task_id),
      operationId: row.operation_id ? String(row.operation_id) : undefined,
      operationStatus: row.operation_status ? String(row.operation_status) : undefined,
      progressStage: row.progress_stage ? String(row.progress_stage) : undefined,
      attemptCount: Number(row.attempt_count || 0),
      reviewStatus: row.review_status ? String(row.review_status) : undefined,
      hasReviewableDraft: Boolean(row.copy_allowed) && String(row.review_status || "") !== "approved",
      error
    }
  };
}

export async function listHostedPromotionOrderRecords(workspaceId: string, limit = 8) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `${orderSelect} WHERE order_row.workspace_id = ?
     ORDER BY CASE WHEN order_row.status = 'completed' THEN 1 ELSE 0 END, order_row.updated_at DESC LIMIT ?`,
    [workspaceId, safeLimit]
  );
  return rows.map(mapOrder);
}

export async function bindHostedPromotionOrderMonthlyPlan(input: {
  orderId: string;
  monthlyPlanId: string;
  expectedVersion: number;
  actorId: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1 FOR UPDATE`, [input.orderId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
    if (String(rows[0].current_monthly_plan_id || "") === input.monthlyPlanId) return mapOrder(rows[0]);
    if (Number(rows[0].row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管状态已经变化，请刷新后重试。", 409);
    }
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE hosted_promotion_order SET current_monthly_plan_id = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [input.monthlyPlanId, input.orderId, input.expectedVersion]
    );
    if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管状态已经变化，请刷新后重试。", 409);
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: "将托管委托绑定到当前正式 MonthlyPlan",
      eventType: "hosted_promotion_order_monthly_plan_bound",
      objectType: "hosted_promotion_order",
      objectId: input.orderId,
      beforeSummary: { monthlyPlanId: rows[0].current_monthly_plan_id || null, rowVersion: input.expectedVersion },
      afterSummary: { monthlyPlanId: input.monthlyPlanId, rowVersion: input.expectedVersion + 1 },
      correlationId: String(rows[0].product_id)
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
    return mapOrder(updatedRows[0]);
  });
}

export async function updateHostedPromotionOrderStatus(input: {
  orderId: string;
  expectedVersion: number;
  status: HostedOrderStatus;
  currentActionType?: string;
  lastError?: { code: string; message: string };
  workflowBinding?: {
    strategyPackId?: string;
    sampleTaskId?: string;
    sampleOperationId?: string;
  };
  clearWorkflowBinding?: boolean;
  actorId: string;
  auditReason: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `${orderSelect} WHERE order_row.id = ? LIMIT 1 FOR UPDATE`,
      [input.orderId]
    );
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
    if (Number(rows[0].row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管状态已经变化，请刷新后重试。", 409);
    }
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE hosted_promotion_order
       SET status = ?, current_action_type = ?, last_error_code = ?, last_error_message = ?,
           current_strategy_pack_id = CASE WHEN ? THEN NULL ELSE COALESCE(?, current_strategy_pack_id) END,
           current_sample_task_id = CASE WHEN ? THEN NULL ELSE COALESCE(?, current_sample_task_id) END,
           current_sample_operation_id = CASE WHEN ? THEN NULL ELSE COALESCE(?, current_sample_operation_id) END,
           row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [input.status, input.currentActionType || null, input.lastError?.code || null,
        input.lastError?.message || null, Boolean(input.clearWorkflowBinding), input.workflowBinding?.strategyPackId || null,
        Boolean(input.clearWorkflowBinding), input.workflowBinding?.sampleTaskId || null,
        Boolean(input.clearWorkflowBinding), input.workflowBinding?.sampleOperationId || null,
        input.orderId, input.expectedVersion]
    );
    if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管状态已经变化，请刷新后重试。", 409);
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: input.auditReason,
      eventType: "hosted_promotion_order_status_changed",
      objectType: "hosted_promotion_order",
      objectId: input.orderId,
      beforeSummary: { status: String(rows[0].status), rowVersion: input.expectedVersion },
      afterSummary: {
        status: input.status,
        rowVersion: input.expectedVersion + 1,
        currentActionType: input.currentActionType,
        workflowBindingCleared: Boolean(input.clearWorkflowBinding),
        strategyPackId: input.workflowBinding?.strategyPackId,
        sampleTaskId: input.workflowBinding?.sampleTaskId,
        sampleOperationId: input.workflowBinding?.sampleOperationId
      },
      correlationId: String(rows[0].product_id)
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
    return mapOrder(updatedRows[0]);
  });
}

export async function setHostedPromotionOrderPauseState(input: {
  orderId: string;
  paused: boolean;
  reason?: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ orderId: input.orderId, paused: input.paused, reason: input.reason?.trim() || "" });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) {
      const [replayedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
      if (!replayedRows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
      return { order: mapOrder(replayedRows[0]), replayed: true };
    }
    const [rows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1 FOR UPDATE`, [input.orderId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
    if (Number(rows[0].row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管状态已经变化，请刷新后重试。", 409);
    const nextStatus = input.paused ? "paused" : "preparing";
    await connection.query(
      `UPDATE hosted_promotion_order SET status = ?, pause_reason = ?, current_action_type = NULL,
       row_version = row_version + 1 WHERE id = ? AND row_version = ?`,
      [nextStatus, input.paused ? input.reason?.trim() || "用户主动暂停" : null, input.orderId, input.expectedVersion]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.paused ? "hosted_promotion_order_paused" : "hosted_promotion_order_resumed",
      objectType: "hosted_promotion_order",
      objectId: input.orderId,
      beforeSummary: { status: String(rows[0].status), rowVersion: input.expectedVersion },
      afterSummary: { status: nextStatus, rowVersion: input.expectedVersion + 1 },
      correlationId: String(rows[0].product_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      requestHash,
      operationType: input.paused ? "pause_hosted_order" : "resume_hosted_order",
      resourceType: "hosted_promotion_order",
      resourceId: input.orderId,
      responseStatus: "success",
      responseSummary: { status: nextStatus, rowVersion: input.expectedVersion + 1 }
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
    return { order: mapOrder(updatedRows[0]), replayed: false };
  });
}

export async function updateHostedPromotionOrderPreferences(input: {
  orderId: string;
  channels: Array<{ channel: string; dailyCap?: number }>;
  dailyDigest: boolean;
  monthlyCompleted: boolean;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    orderId: input.orderId,
    channels: input.channels,
    dailyDigest: input.dailyDigest,
    monthlyCompleted: input.monthlyCompleted
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) {
      const [replayedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
      if (!replayedRows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
      return { order: mapOrder(replayedRows[0]), replayed: true };
    }
    const [rows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1 FOR UPDATE`, [input.orderId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
    if (Number(rows[0].row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管设置已经变化，请刷新后重试。", 409);
    const dailyCaps = Object.fromEntries(input.channels.flatMap((item) => item.dailyCap ? [[item.channel, item.dailyCap]] : []));
    const notificationPreferences = { dailyDigest: input.dailyDigest, actionRequired: true as const, monthlyCompleted: input.monthlyCompleted };
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE hosted_promotion_order SET channel_preferences_json = ?, daily_caps_json = ?,
       notification_preferences_json = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?`,
      [stringifyV5Json(input.channels), stringifyV5Json(dailyCaps), stringifyV5Json(notificationPreferences), input.orderId, input.expectedVersion]
    );
    if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_order_version_conflict", "托管设置已经变化，请刷新后重试。", 409);
    const cancellableEvents = [
      ...(!input.dailyDigest ? ["daily_batch_closed", "daily_batch_delta"] : []),
      ...(!input.monthlyCompleted ? ["monthly_completed"] : [])
    ];
    let cancelledNotificationCount = 0;
    if (cancellableEvents.length) {
      const [cancelled] = await connection.query<ResultSetHeader>(
        `UPDATE hosted_notification_outbox SET status = 'cancelled', row_version = row_version + 1
         WHERE order_id = ? AND status IN ('pending', 'retry')
           AND event_type IN (${cancellableEvents.map(() => "?").join(", ")})`,
        [input.orderId, ...cancellableEvents]
      );
      cancelledNotificationCount = cancelled.affectedRows;
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "hosted_promotion_order_preferences_updated",
      objectType: "hosted_promotion_order",
      objectId: input.orderId,
      beforeSummary: { channelPreferences: parseV5Json(rows[0].channel_preferences_json, []), dailyCaps: parseV5Json(rows[0].daily_caps_json, {}) },
      afterSummary: { channelPreferences: input.channels, dailyCaps, notificationPreferences, cancelledNotificationCount },
      correlationId: String(rows[0].product_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      requestHash,
      operationType: "update_hosted_order_preferences",
      resourceType: "hosted_promotion_order",
      resourceId: input.orderId,
      responseStatus: "success",
      responseSummary: { rowVersion: input.expectedVersion + 1 }
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(`${orderSelect} WHERE order_row.id = ? LIMIT 1`, [input.orderId]);
    return { order: mapOrder(updatedRows[0]), replayed: false };
  });
}
