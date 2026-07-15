import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { V5ApprovalAction, V5GovernanceRole } from "./knowledge-governance-contracts";
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

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function approvalStatusForAction(action: V5ApprovalAction) {
  if (["approve", "approve_with_conditions", "accept_conservative_wording"].includes(action)) return "approved";
  if (action === "reject") return "rejected";
  if (action === "defer") return "deferred";
  return "changes_requested";
}

export async function listV5ProductClaimsRecord(input: {
  productId: string;
  reviewStatus?: string;
  claimType?: string;
}) {
  const conditions = ["product_id = ?"];
  const values: unknown[] = [input.productId];
  if (input.reviewStatus) {
    conditions.push("review_status = ?");
    values.push(input.reviewStatus);
  }
  if (input.claimType) {
    conditions.push("claim_type = ?");
    values.push(input.claimType);
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id, product_id, subject_type, claim_type, normalized_claim, source_id, source_revision_id, source_locator, authority_level, support_mode,
            capability_status, claim_scope, conditions, limitations, product_version, confidence, extractor_version, review_status, conflict_group_id,
            supersedes_claim_id, row_version, reviewed_by, reviewed_at, created_at
     FROM product_claim WHERE ${conditions.join(" AND ")} ORDER BY created_at, id`,
    values
  );
  return rows.map((row) => ({
    claimId: String(row.id),
    productId: String(row.product_id),
    subjectType: String(row.subject_type),
    claimType: String(row.claim_type),
    normalizedClaim: String(row.normalized_claim),
    sourceId: String(row.source_id),
    sourceRevisionId: String(row.source_revision_id),
    sourceLocator: parseV5Json<Record<string, unknown>>(row.source_locator, {}),
    originalQuoteAvailable: true,
    authorityLevel: String(row.authority_level),
    supportMode: String(row.support_mode),
    capabilityStatus: String(row.capability_status),
    claimScope: String(row.claim_scope),
    conditions: parseV5Json<string[]>(row.conditions, []),
    limitations: parseV5Json<string[]>(row.limitations, []),
    productVersion: row.product_version ? String(row.product_version) : undefined,
    confidence: Number(row.confidence),
    extractorVersion: String(row.extractor_version),
    reviewStatus: String(row.review_status),
    conflictGroupId: row.conflict_group_id ? String(row.conflict_group_id) : undefined,
    supersedesClaimId: row.supersedes_claim_id ? String(row.supersedes_claim_id) : undefined,
    rowVersion: Number(row.row_version),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : undefined,
    reviewedAt: asDate(row.reviewed_at),
    createdAt: asDate(row.created_at)
  }));
}

export async function readV5ProductReviewQueueRecord(productId: string) {
  const pool = getV5GovernancePool();
  const [claimRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, claim_type, normalized_claim, review_status, authority_level, source_id, row_version FROM product_claim WHERE product_id = ? AND review_status IN ('candidate', 'disputed') ORDER BY created_at",
    [productId]
  );
  const [conflictRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, conflict_type, subject, severity, required_roles, temporary_policy, status, row_version, created_at FROM claim_conflict WHERE product_id = ? AND status = 'open' ORDER BY created_at",
    [productId]
  );
  const [gapRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, gap_code, title, severity, owner_role, recommended_action, status, row_version, due_at, created_at FROM evidence_gap WHERE product_id = ? AND status IN ('open', 'in_progress') ORDER BY FIELD(severity, 'blocking', 'high', 'warning', 'info'), created_at",
    [productId]
  );
  const [versionRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, version, status, pending_roles, row_version, created_at FROM rule_package_version WHERE product_id = ? AND status LIKE 'draft_pending_%' ORDER BY created_at DESC",
    [productId]
  );
  const versionIds = versionRows.map((row) => String(row.id));
  let changes: Array<Record<string, unknown>> = [];
  if (versionIds.length > 0) {
    const placeholders = versionIds.map(() => "?").join(", ");
    const [changeRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, rule_package_version_id, section, field_path, change_type, reason, risk_level, required_roles, review_status, row_version
       FROM rule_package_change WHERE rule_package_version_id IN (${placeholders}) AND review_status IN ('pending', 'changes_requested')
       ORDER BY FIELD(risk_level, 'blocking', 'high', 'warning', 'info'), created_at`,
      versionIds
    );
    changes = changeRows.map((row) => ({
      changeId: String(row.id),
      rulePackageVersionId: String(row.rule_package_version_id),
      section: String(row.section),
      fieldPath: String(row.field_path),
      changeType: String(row.change_type),
      reason: String(row.reason),
      riskLevel: String(row.risk_level),
      requiredRoles: parseV5Json<string[]>(row.required_roles, []),
      reviewStatus: String(row.review_status),
      rowVersion: Number(row.row_version)
    }));
  }
  return {
    productId,
    claims: claimRows.map((row) => ({
      claimId: String(row.id),
      claimType: String(row.claim_type),
      normalizedClaim: String(row.normalized_claim),
      reviewStatus: String(row.review_status),
      authorityLevel: String(row.authority_level),
      sourceId: String(row.source_id),
      rowVersion: Number(row.row_version)
    })),
    conflicts: conflictRows.map((row) => ({
      conflictId: String(row.id),
      conflictType: String(row.conflict_type),
      subject: String(row.subject),
      severity: String(row.severity),
      requiredRoles: parseV5Json<string[]>(row.required_roles, []),
      temporaryPolicy: String(row.temporary_policy),
      status: String(row.status),
      rowVersion: Number(row.row_version),
      createdAt: asDate(row.created_at)
    })),
    evidenceGaps: gapRows.map((row) => ({
      gapId: String(row.id),
      gapCode: String(row.gap_code),
      title: String(row.title),
      severity: String(row.severity),
      ownerRole: String(row.owner_role),
      recommendedAction: String(row.recommended_action),
      status: String(row.status),
      rowVersion: Number(row.row_version),
      dueAt: asDate(row.due_at),
      createdAt: asDate(row.created_at)
    })),
    rulePackages: versionRows.map((row) => ({
      rulePackageVersionId: String(row.id),
      version: String(row.version),
      status: String(row.status),
      pendingRoles: parseV5Json<string[]>(row.pending_roles, []),
      rowVersion: Number(row.row_version),
      createdAt: asDate(row.created_at)
    })),
    ruleChanges: changes
  };
}

export async function resolveV5ClaimConflictRecord(input: {
  conflictId: string;
  action: "resolve" | "accept_risk";
  selectedClaimId?: string;
  applicableVersion?: string;
  temporaryPolicy: string;
  claimDecisions: Array<{ claimId: string; reviewStatus: "candidate" | "supported" | "conditional" | "rejected" | "superseded" }>;
  resolutionReason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, conflictId: replay.resourceId };
    const [conflictRows] = await connection.query<RowDataPacket[]>("SELECT * FROM claim_conflict WHERE id = ? FOR UPDATE", [input.conflictId]);
    const conflict = conflictRows[0];
    if (!conflict) throw new V5GovernanceRepositoryError("not_found", "ClaimConflict 不存在。", 404);
    if (Number(conflict.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("version_conflict", `ClaimConflict 当前 rowVersion 为 ${conflict.row_version}。`, 409);
    }
    if (String(conflict.status) !== "open") throw new V5GovernanceRepositoryError("invalid_state", "只有 open 冲突可以裁决。", 409);
    const requiredRoles = parseV5Json<string[]>(conflict.required_roles, []);
    if (!requiredRoles.includes(input.actor.actorRole) && input.actor.actorRole !== "product_owner") {
      throw new V5GovernanceRepositoryError("permission_denied", `该冲突需要角色：${requiredRoles.join(", ")}。`, 403);
    }
    const [itemRows] = await connection.query<RowDataPacket[]>("SELECT claim_id FROM claim_conflict_item WHERE conflict_id = ?", [input.conflictId]);
    const conflictClaimIds = itemRows.map((row) => String(row.claim_id));
    const decisionClaimIds = input.claimDecisions.map((decision) => decision.claimId);
    const uniqueDecisionClaimIds = new Set(decisionClaimIds);
    if (
      conflictClaimIds.length === 0 ||
      input.claimDecisions.length !== conflictClaimIds.length ||
      uniqueDecisionClaimIds.size !== input.claimDecisions.length ||
      decisionClaimIds.some((claimId) => !conflictClaimIds.includes(claimId))
    ) {
      throw new V5GovernanceRepositoryError(
        "invalid_contract",
        `${input.action} 必须且只能为冲突组内每条 Claim 提供一次明确处理结果。`,
        400
      );
    }
    if (input.selectedClaimId && !conflictClaimIds.includes(input.selectedClaimId)) {
      throw new V5GovernanceRepositoryError("invalid_contract", "selectedClaimId 不属于当前冲突组。", 400);
    }
    for (const decision of input.claimDecisions) {
      await connection.query(
        "UPDATE product_claim SET review_status = ?, conflict_group_id = NULL, reviewed_by = ?, reviewed_at = NOW(), row_version = row_version + 1 WHERE id = ?",
        [decision.reviewStatus, input.actor.actorId, decision.claimId]
      );
    }
    const status = input.action === "resolve" ? "resolved" : "accepted_risk";
    const resolution = {
      action: input.action,
      selectedClaimId: input.selectedClaimId || null,
      applicableVersion: input.applicableVersion || null,
      temporaryPolicy: input.temporaryPolicy,
      claimDecisions: input.claimDecisions,
      reason: input.resolutionReason,
      decidedBy: [{ actorId: input.actor.actorId, role: input.actor.actorRole }],
      decidedAt: new Date().toISOString()
    };
    await connection.query(
      "UPDATE claim_conflict SET status = ?, preferred_temporary_claim_id = ?, temporary_policy = ?, resolution = ?, resolved_at = NOW(), row_version = row_version + 1 WHERE id = ? AND row_version = ?",
      [status, input.selectedClaimId || null, input.temporaryPolicy, stringifyV5Json(resolution), input.conflictId, input.expectedVersion]
    );
    await connection.query(
      `INSERT INTO approval_record
        (id, object_type, object_id, confirmation_unit, role, action, status, actor_id, before_summary, after_summary, reason, evidence_source_ids, impact_summary)
       VALUES (?, 'conflict', ?, 'claim', ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
      [
        `approval-${randomUUID()}`,
        input.conflictId,
        input.actor.actorRole,
        input.action === "resolve" ? "accept_conservative_wording" : "approve_with_conditions",
        input.actor.actorId,
        stringifyV5Json({ status: "open", rowVersion: input.expectedVersion }),
        stringifyV5Json({ status, rowVersion: input.expectedVersion + 1, resolution }),
        input.resolutionReason,
        stringifyV5Json([]),
        stringifyV5Json({ affectsRulePackage: true, affectsMonthlyReadiness: true })
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "conflict_resolved",
      objectType: "claim_conflict",
      objectId: input.conflictId,
      beforeSummary: { status: "open", rowVersion: input.expectedVersion },
      afterSummary: { status, rowVersion: input.expectedVersion + 1, selectedClaimId: input.selectedClaimId || null },
      correlationId: input.conflictId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "resolve_claim_conflict",
      requestHash,
      resourceType: "claim_conflict",
      resourceId: input.conflictId,
      responseStatus: status,
      responseSummary: { conflictId: input.conflictId, status, rowVersion: input.expectedVersion + 1 }
    });
    return { replayed: false, conflictId: input.conflictId, status, rowVersion: input.expectedVersion + 1, resolution };
  });
}

export async function updateV5EvidenceGapRecord(input: {
  gapId: string;
  action: "start" | "resolve" | "accept_risk" | "reopen";
  resolvedBySourceIds: string[];
  resolutionNote: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, gapId: replay.resourceId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM evidence_gap WHERE id = ? FOR UPDATE", [input.gapId]);
    const gap = rows[0];
    if (!gap) throw new V5GovernanceRepositoryError("not_found", "EvidenceGap 不存在。", 404);
    if (Number(gap.row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("version_conflict", `EvidenceGap 当前 rowVersion 为 ${gap.row_version}。`, 409);
    if (![String(gap.owner_role), "product_owner"].includes(input.actor.actorRole)) {
      throw new V5GovernanceRepositoryError("permission_denied", `该缺口需要 ${gap.owner_role} 或 product_owner 处理。`, 403);
    }
    const currentStatus = String(gap.status);
    const allowedActions: Record<string, string[]> = {
      open: ["start", "resolve", "accept_risk"],
      in_progress: ["resolve", "accept_risk", "reopen"],
      resolved: ["reopen"],
      accepted_risk: ["reopen"]
    };
    if (!allowedActions[currentStatus]?.includes(input.action)) {
      throw new V5GovernanceRepositoryError(
        "invalid_state",
        `EvidenceGap 状态 ${currentStatus} 不允许执行 ${input.action}。`,
        409,
        "刷新缺口状态，并按 open → in_progress/closed 或 closed → reopen 的状态机处理。"
      );
    }
    const uniqueSourceIds = Array.from(new Set(input.resolvedBySourceIds));
    if (uniqueSourceIds.length !== input.resolvedBySourceIds.length) {
      throw new V5GovernanceRepositoryError("invalid_contract", "resolvedBySourceIds 不能包含重复来源。", 400);
    }
    if (input.action === "resolve" && input.resolvedBySourceIds.length === 0) {
      throw new V5GovernanceRepositoryError("invalid_contract", "解决证据缺口必须关联至少一份新增来源。", 400);
    }
    if (uniqueSourceIds.length > 0) {
      const placeholders = uniqueSourceIds.map(() => "?").join(", ");
      const [sourceRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, status, safety_status, product_candidates FROM source_asset WHERE id IN (${placeholders}) FOR UPDATE`,
        uniqueSourceIds
      );
      if (sourceRows.length !== uniqueSourceIds.length) {
        throw new V5GovernanceRepositoryError("invalid_contract", "resolvedBySourceIds 包含不存在的来源。", 400);
      }
      const invalidSource = sourceRows.find((source) => {
        const productCandidates = parseV5Json<string[]>(source.product_candidates, []);
        return (
          String(source.status) !== "approved_for_claim_extraction" ||
          !["passed", "restricted_approved"].includes(String(source.safety_status)) ||
          !productCandidates.includes(String(gap.product_id))
        );
      });
      if (invalidSource) {
        throw new V5GovernanceRepositoryError(
          "invalid_evidence_source",
          `来源 ${invalidSource.id} 尚未通过当前产品的提取与安全准入。`,
          409,
          "先完成 G0-G2 并确认产品归属，再用于关闭证据缺口。"
        );
      }
      const triggerSourceIds = parseV5Json<string[]>(gap.trigger_source_ids, []);
      if (input.action === "resolve" && !uniqueSourceIds.some((sourceId) => !triggerSourceIds.includes(sourceId))) {
        throw new V5GovernanceRepositoryError("invalid_contract", "关闭缺口至少需要一份不在 triggerSourceIds 中的新增来源。", 400);
      }
    }
    const status = input.action === "start" ? "in_progress" : input.action === "resolve" ? "resolved" : input.action === "accept_risk" ? "accepted_risk" : "open";
    const resolved = ["resolved", "accepted_risk"].includes(status);
    await connection.query(
      `UPDATE evidence_gap SET status = ?, resolved_by_source_ids = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [
        status,
        stringifyV5Json(input.resolvedBySourceIds),
        resolved ? input.actor.actorId : null,
        resolved ? new Date() : null,
        input.resolutionNote,
        input.gapId,
        input.expectedVersion
      ]
    );
    await connection.query(
      `INSERT INTO approval_record
        (id, object_type, object_id, confirmation_unit, role, action, status, actor_id, before_summary, after_summary, reason, evidence_source_ids, impact_summary)
       VALUES (?, 'evidence_gap', ?, 'claim', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `approval-${randomUUID()}`,
        input.gapId,
        input.actor.actorRole,
        input.action === "resolve" ? "approve" : input.action === "accept_risk" ? "approve_with_conditions" : input.action === "reopen" ? "request_more_evidence" : "defer",
        resolved ? "approved" : status === "open" ? "changes_requested" : "pending",
        input.actor.actorId,
        stringifyV5Json({ status: String(gap.status), rowVersion: input.expectedVersion }),
        stringifyV5Json({ status, rowVersion: input.expectedVersion + 1 }),
        input.resolutionNote,
        stringifyV5Json(input.resolvedBySourceIds),
        stringifyV5Json({ affectsRulePackage: true, affectsMonthlyReadiness: true })
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: status === "resolved" ? "evidence_gap_resolved" : "evidence_gap_status_changed",
      objectType: "evidence_gap",
      objectId: input.gapId,
      relatedSourceIds: input.resolvedBySourceIds,
      beforeSummary: { status: String(gap.status), rowVersion: input.expectedVersion },
      afterSummary: { status, rowVersion: input.expectedVersion + 1 },
      correlationId: input.gapId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "update_evidence_gap",
      requestHash,
      resourceType: "evidence_gap",
      resourceId: input.gapId,
      responseStatus: status,
      responseSummary: { gapId: input.gapId, status, rowVersion: input.expectedVersion + 1 }
    });
    return { replayed: false, gapId: input.gapId, status, rowVersion: input.expectedVersion + 1 };
  });
}

export async function readV5RulePackageVersionDetailRecord(rulePackageVersionId: string) {
  const pool = getV5GovernancePool();
  const [versionRows] = await pool.query<RowDataPacket[]>("SELECT * FROM rule_package_version WHERE id = ? LIMIT 1", [rulePackageVersionId]);
  const version = versionRows[0];
  if (!version) return undefined;
  const [changeRows] = await pool.query<RowDataPacket[]>("SELECT * FROM rule_package_change WHERE rule_package_version_id = ? ORDER BY created_at, id", [rulePackageVersionId]);
  const [approvalRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, object_type, object_id, role, action, status, actor_id, reason, created_at
     FROM approval_record WHERE (object_type = 'package' AND object_id = ?)
        OR (object_type = 'change' AND object_id IN (SELECT id FROM rule_package_change WHERE rule_package_version_id = ?))
     ORDER BY created_at`,
    [rulePackageVersionId, rulePackageVersionId]
  );
  const [claimRows] = await pool.query<RowDataPacket[]>(
    `SELECT pc.id, pc.claim_type, pc.normalized_claim, pc.review_status, pc.authority_level, rpc.usage_type
     FROM rule_package_claim rpc JOIN product_claim pc ON pc.id = rpc.claim_id
     WHERE rpc.rule_package_version_id = ? ORDER BY pc.created_at, pc.id`,
    [rulePackageVersionId]
  );
  return {
    rulePackageVersionId: String(version.id),
    rulePackageId: String(version.rule_package_id),
    productId: String(version.product_id),
    version: String(version.version),
    status: String(version.status),
    rowVersion: Number(version.row_version),
    pendingRoles: parseV5Json<string[]>(version.pending_roles, []),
    basedOnVersionId: version.based_on_version_id ? String(version.based_on_version_id) : undefined,
    sourceBatchIds: parseV5Json<string[]>(version.source_batch_ids, []),
    linkedKnowledgeBaseIds: parseV5Json<string[]>(version.linked_knowledge_base_ids, []),
    linkedSourceIds: parseV5Json<string[]>(version.linked_source_ids, []),
    linkedClaimIds: parseV5Json<string[]>(version.linked_claim_ids, []),
    productIdentity: parseV5Json(version.product_identity, {}),
    capabilities: parseV5Json(version.capabilities, []),
    allowedExpressions: parseV5Json(version.allowed_expressions, []),
    conditionalExpressions: parseV5Json(version.conditional_expressions, []),
    blockedExpressions: parseV5Json(version.blocked_expressions, []),
    evidenceRequirements: parseV5Json(version.evidence_requirements, []),
    channelBoundaries: parseV5Json(version.channel_boundaries, []),
    evidenceGapIds: parseV5Json<string[]>(version.evidence_gap_ids, []),
    conflictRefs: parseV5Json<string[]>(version.conflict_refs, []),
    monthlyMatrixScope: parseV5Json(version.monthly_matrix_scope, {}),
    sourceSnapshotHash: String(version.source_snapshot_hash),
    claims: claimRows.map((row) => ({
      claimId: String(row.id),
      claimType: String(row.claim_type),
      normalizedClaim: String(row.normalized_claim),
      reviewStatus: String(row.review_status),
      authorityLevel: String(row.authority_level),
      usageType: String(row.usage_type)
    })),
    changes: changeRows.map((row) => ({
      changeId: String(row.id),
      section: String(row.section),
      fieldPath: String(row.field_path),
      changeType: String(row.change_type),
      before: parseV5Json(row.before_value, null),
      after: parseV5Json(row.after_value, null),
      reason: String(row.reason),
      claimIds: parseV5Json<string[]>(row.claim_ids, []),
      sourceIds: parseV5Json<string[]>(row.source_ids, []),
      riskLevel: String(row.risk_level),
      requiredRoles: parseV5Json<string[]>(row.required_roles, []),
      reviewStatus: String(row.review_status),
      rowVersion: Number(row.row_version)
    })),
    approvals: approvalRows.map((row) => ({
      approvalId: String(row.id),
      objectType: String(row.object_type),
      objectId: String(row.object_id),
      role: String(row.role),
      action: String(row.action),
      status: String(row.status),
      actorId: String(row.actor_id),
      reason: String(row.reason),
      createdAt: asDate(row.created_at)
    }))
  };
}

export async function reviewV5RulePackageChangeRecord(input: {
  changeId: string;
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  reason: string;
  evidenceSourceIds: string[];
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({ ...input, actor: undefined });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) return { replayed: true, changeId: replay.resourceId };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM rule_package_change WHERE id = ? FOR UPDATE", [input.changeId]);
    const change = rows[0];
    if (!change) throw new V5GovernanceRepositoryError("not_found", "RulePackageChange 不存在。", 404);
    if (Number(change.row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("version_conflict", `规则变更当前 rowVersion 为 ${change.row_version}。`, 409);
    const requiredRoles = parseV5Json<string[]>(change.required_roles, []);
    if (!requiredRoles.includes(input.role) || input.actor.actorRole !== input.role) {
      throw new V5GovernanceRepositoryError("permission_denied", `该变更需要角色：${requiredRoles.join(", ")}。`, 403);
    }
    if (!["pending", "changes_requested"].includes(String(change.review_status))) {
      throw new V5GovernanceRepositoryError("invalid_state", `规则变更当前状态 ${change.review_status} 不允许继续复核。`, 409);
    }
    if (String(change.review_status) === "changes_requested") {
      throw new V5GovernanceRepositoryError(
        "invalid_state",
        "该规则变更已要求修改，不能在原变更记录上继续批准。",
        409,
        "生成包含修订内容的新 RulePackageChange，再重新发起多角色复核。"
      );
    }
    const [existingDecisionRows] = await connection.query<RowDataPacket[]>(
      "SELECT role, status FROM approval_record WHERE object_type = 'change' AND object_id = ? AND status <> 'deferred' FOR UPDATE",
      [input.changeId]
    );
    if (existingDecisionRows.some((row) => String(row.role) === input.role)) {
      throw new V5GovernanceRepositoryError(
        "already_reviewed",
        `${input.role} 已对该变更给出不可重复的复核结论。`,
        409,
        "刷新变更详情；如内容已修改，应创建新的 RulePackageChange。"
      );
    }
    const approvalStatus = approvalStatusForAction(input.action);
    const approvedRoles = new Set(existingDecisionRows.filter((row) => String(row.status) === "approved").map((row) => String(row.role)));
    if (approvalStatus === "approved") approvedRoles.add(input.role);
    const reviewStatus =
      approvalStatus === "rejected"
        ? "rejected"
        : approvalStatus === "changes_requested"
          ? "changes_requested"
          : approvalStatus === "approved" && requiredRoles.every((role) => approvedRoles.has(role))
            ? "approved"
            : "pending";
    await connection.query(
      "UPDATE rule_package_change SET review_status = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?",
      [reviewStatus, input.changeId, input.expectedVersion]
    );
    await connection.query(
      `INSERT INTO approval_record
        (id, object_type, object_id, confirmation_unit, role, action, status, actor_id, before_summary, after_summary, reason, evidence_source_ids, impact_summary)
       VALUES (?, 'change', ?, 'change', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `approval-${randomUUID()}`,
        input.changeId,
        input.role,
        input.action,
        approvalStatus,
        input.actor.actorId,
        stringifyV5Json({ reviewStatus: String(change.review_status), rowVersion: input.expectedVersion }),
        stringifyV5Json({ reviewStatus, approvalStatus, rowVersion: input.expectedVersion + 1 }),
        input.reason,
        stringifyV5Json(input.evidenceSourceIds),
        stringifyV5Json({ rulePackageVersionId: String(change.rule_package_version_id), affectsActivation: true })
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "rule_change_reviewed",
      objectType: "rule_package_change",
      objectId: input.changeId,
      relatedSourceIds: input.evidenceSourceIds,
      beforeSummary: { reviewStatus: String(change.review_status), rowVersion: input.expectedVersion },
      afterSummary: {
        reviewStatus,
        approvalStatus,
        approvedRoles: Array.from(approvedRoles),
        requiredRoles,
        rowVersion: input.expectedVersion + 1,
        role: input.role,
        action: input.action
      },
      correlationId: String(change.rule_package_version_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "review_rule_package_change",
      requestHash,
      resourceType: "rule_package_change",
      resourceId: input.changeId,
      responseStatus: reviewStatus,
      responseSummary: { changeId: input.changeId, reviewStatus, rowVersion: input.expectedVersion + 1 }
    });
    return { replayed: false, changeId: input.changeId, reviewStatus, rowVersion: input.expectedVersion + 1 };
  });
}
