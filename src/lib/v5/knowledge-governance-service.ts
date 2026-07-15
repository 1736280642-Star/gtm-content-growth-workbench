import type { V5GateCode, V5GovernanceRole, V5RulePackageVersionStatus } from "./knowledge-governance-contracts";
import {
  activateV5RulePackageVersionRecord,
  createV5GovernanceRunRecord,
  createV5IngestionBatchRecord,
  hashV5GovernancePayload,
  persistV5GateResult,
  readV5GovernanceRunRecord,
  readV5IngestionBatchRecord,
  readV5MonthlyReadinessRecord,
  readV5ReadinessContext,
  readV5RuleActivationContext,
  rollbackV5RulePackageVersionRecord,
  upsertV5MonthlyReadinessRecord,
  V5GovernanceRepositoryError,
  type V5GovernanceActor
} from "./knowledge-governance-repository";
import {
  evaluateG5,
  evaluateG6,
  evaluateV5GovernanceGate,
  type V5G5ApprovalInput,
  type V5GateResult
} from "./knowledge-governance-workflow";

export const V5_GOVERNANCE_EVALUATOR_VERSION = "v5-governance-gates-2026.07.14.1";
export const V5_READINESS_EVALUATOR_VERSION = "v5-monthly-readiness-2026.07.14.1";

export class V5GovernanceServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly nextAction?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "V5GovernanceServiceError";
  }
}

export interface V5WriteEnvelope {
  idempotencyKey: string;
  expectedVersion: number;
  actor: V5GovernanceActor;
}

function assertText(value: string | undefined, field: string) {
  if (!value?.trim()) throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId");
  assertText(actor.actorRole, "actorRole");
  assertText(actor.actorType, "actorType");
  assertText(actor.auditReason, "auditReason");
}

function assertEnvelope(envelope: V5WriteEnvelope) {
  assertText(envelope.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(envelope.expectedVersion) || envelope.expectedVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是非负整数。", 400, "读取最新资源版本后重试。");
  }
  assertActor(envelope.actor);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function hasTextValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function productIdentityComplete(identity: Record<string, unknown>) {
  const name = identity.productName || identity.canonicalName || identity.name;
  const category = identity.productCategory || identity.category;
  const definition = identity.productDefinition || identity.definition || identity.positioning;
  return hasTextValue(name) && hasTextValue(category) && hasTextValue(definition);
}

function isGlobalBlockingGap(gap: { severity: string; affectedRuleFields: string[] }) {
  if (gap.severity !== "blocking") return false;
  if (gap.affectedRuleFields.length === 0) return true;
  return gap.affectedRuleFields.some((field) => ["*", "productIdentity", "monthlyMatrixScope", "rulePackageActivation"].includes(field));
}

export function toV5GovernanceError(error: unknown) {
  if (error instanceof V5GovernanceServiceError || error instanceof V5GovernanceRepositoryError) {
    return {
      ok: false as const,
      status: error.code === "pending_config" ? "pending_config" : "failed",
      code: error.code,
      message: error.message,
      nextAction: error.nextAction,
      details: error instanceof V5GovernanceServiceError ? error.details : undefined,
      httpStatus: error.httpStatus
    };
  }

  return {
    ok: false as const,
    status: "failed",
    code: "unexpected_error",
    message: error instanceof Error ? error.message : "未知 V5 知识治理错误。",
    nextAction: "查看服务端治理审计并修复后重试；不要把失败结果标记为成功。",
    httpStatus: 500
  };
}

export async function createV5IngestionBatch(input: {
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
  assertText(input.idempotencyKey, "idempotencyKey");
  assertActor(input.actor);
  if (!Number.isInteger(input.sourceCount) || input.sourceCount < 1 || input.sourceCount > 100) {
    throw new V5GovernanceServiceError("invalid_contract", "sourceCount 必须是 1-100 的整数。", 400, "按一次真实导入批次的资料数量提交。");
  }
  if (!input.targetKnowledgeBaseId && !input.targetProductId) {
    throw new V5GovernanceServiceError("invalid_contract", "导入批次至少需要 targetKnowledgeBaseId 或 targetProductId。", 400);
  }
  const stored = await createV5IngestionBatchRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: stored.batch };
}

export async function getV5IngestionBatch(batchId: string) {
  assertText(batchId, "batchId");
  const result = await readV5IngestionBatchRecord(batchId);
  if (!result) throw new V5GovernanceServiceError("not_found", "导入批次不存在。", 404);
  return { ok: true as const, status: "success", data: result };
}

export async function createV5GovernanceRun(input: {
  batchId: string;
  productId?: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.batchId, "batchId");
  assertText(input.idempotencyKey, "idempotencyKey");
  assertActor(input.actor);
  const stored = await createV5GovernanceRunRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: stored.run };
}

export async function getV5GovernanceRun(runId: string) {
  assertText(runId, "runId");
  const result = await readV5GovernanceRunRecord(runId);
  if (!result) throw new V5GovernanceServiceError("not_found", "治理运行不存在。", 404);
  return { ok: true as const, status: "success", data: result };
}

export async function evaluateV5GovernanceRunGate(input: V5WriteEnvelope & {
  runId: string;
  gate: V5GateCode;
  gateInput: unknown;
  evaluatorVersion?: string;
}) {
  assertEnvelope(input);
  assertText(input.runId, "runId");
  if (!(["G0", "G1", "G2", "G3", "G4", "G5", "G6"] as string[]).includes(input.gate)) {
    throw new V5GovernanceServiceError("invalid_contract", "gate 必须是 G0-G6。", 400);
  }
  if (!input.gateInput || typeof input.gateInput !== "object") {
    throw new V5GovernanceServiceError("invalid_contract", `${input.gate} 缺少结构化输入。`, 400);
  }

  let gateResult: V5GateResult;
  try {
    gateResult = evaluateV5GovernanceGate(input.gate, input.gateInput);
  } catch (error) {
    throw new V5GovernanceServiceError(
      "invalid_gate_contract",
      `${input.gate} 输入不符合领域契约：${error instanceof Error ? error.message : "unknown"}`,
      400,
      "按 V5 G0-G6 输入契约补齐字段后重试。"
    );
  }
  const evaluatorVersion = input.evaluatorVersion || V5_GOVERNANCE_EVALUATOR_VERSION;
  const requestHash = hashV5GovernancePayload({ runId: input.runId, gate: input.gate, gateInput: input.gateInput, evaluatorVersion });
  const stored = await persistV5GateResult({
    runId: input.runId,
    gate: input.gate,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    evaluatorVersion,
    result: gateResult,
    actor: input.actor
  });
  return {
    ok: gateResult.ok,
    status: gateResult.status,
    data: { run: stored.run, gateResultId: stored.gateResultId, gateResult, replayed: stored.replayed }
  };
}

export async function activateV5RulePackageVersion(input: V5WriteEnvelope & { rulePackageVersionId: string }) {
  assertEnvelope(input);
  assertText(input.rulePackageVersionId, "rulePackageVersionId");
  if (input.actor.actorType !== "human" || !["product_owner", "business_owner"].includes(input.actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "permission_denied",
      "只有人工 product_owner 或 business_owner 可以执行规则包最终激活。",
      403,
      "知识库维护者可发起审批，但最终激活必须由对应产品/业务 Owner 完成。"
    );
  }
  const context = await readV5RuleActivationContext(input.rulePackageVersionId);
  if (!context) throw new V5GovernanceServiceError("not_found", "规则包版本不存在。", 404);

  const blockingGaps = context.gaps.filter(isGlobalBlockingGap);
  const gateResult = evaluateG5({
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    rulePackageVersionId: context.rulePackageVersionId,
    rulePackageStatus: context.status as V5RulePackageVersionStatus,
    productIdentityComplete: productIdentityComplete(context.productIdentity),
    approvedClaimCount: context.approvedClaimCount,
    pendingRoles: context.pendingRoles as V5GovernanceRole[],
    approvals: context.approvals as V5G5ApprovalInput[],
    unresolvedBlockingConflictCount: context.conflicts.filter((item) => item.severity === "blocking" && item.status === "open").length,
    unresolvedBlockingGapCount: blockingGaps.length,
    sourceSnapshotHash: context.sourceSnapshotHash
  });

  if (!gateResult.ok) {
    return { ok: false as const, status: gateResult.status, code: "approval_required", message: "G5 未通过，规则包保持草稿。", nextActions: gateResult.nextActions, data: { gateResult, context } };
  }

  const requestHash = hashV5GovernancePayload({
    rulePackageVersionId: input.rulePackageVersionId,
    expectedVersion: input.expectedVersion,
    actorId: input.actor.actorId,
    sourceSnapshotHash: context.sourceSnapshotHash
  });
  const stored = await activateV5RulePackageVersionRecord({
    rulePackageVersionId: input.rulePackageVersionId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    actor: input.actor,
    gateResult
  });
  return { ok: true as const, status: "active", data: { ...stored, gateResult } };
}

export async function rollbackV5RulePackageVersion(input: V5WriteEnvelope & {
  rulePackageVersionId: string;
  targetRulePackageVersionId: string;
  targetExpectedVersion: number;
}) {
  assertEnvelope(input);
  assertText(input.rulePackageVersionId, "rulePackageVersionId");
  assertText(input.targetRulePackageVersionId, "targetRulePackageVersionId");
  if (!Number.isInteger(input.targetExpectedVersion) || input.targetExpectedVersion < 1) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      "targetExpectedVersion 必须是正整数。",
      400,
      "读取明确的目标历史版本及其最新 rowVersion 后重试。"
    );
  }
  if (input.actor.actorType !== "human" || input.actor.actorRole !== "product_owner") {
    throw new V5GovernanceServiceError(
      "permission_denied",
      "只有人工 product_owner 可以执行规则包回滚。",
      403,
      "由对应产品 Owner 选择已批准且已冻结的历史版本，并填写回滚原因。"
    );
  }

  const requestHash = hashV5GovernancePayload({
    rulePackageVersionId: input.rulePackageVersionId,
    targetRulePackageVersionId: input.targetRulePackageVersionId,
    expectedVersion: input.expectedVersion,
    targetExpectedVersion: input.targetExpectedVersion,
    actorId: input.actor.actorId
  });
  const stored = await rollbackV5RulePackageVersionRecord({ ...input, requestHash });
  return { ok: true as const, status: stored.replayed ? "replayed" : "active", data: stored };
}

export async function evaluateV5MonthlyProductionReadiness(input: V5WriteEnvelope & {
  productId: string;
  governanceRunId?: string;
  evaluatorVersion?: string;
}) {
  assertEnvelope(input);
  assertText(input.productId, "productId");
  const context = await readV5ReadinessContext(input.productId);
  const evaluatorVersion = input.evaluatorVersion || V5_READINESS_EVALUATOR_VERSION;

  if (!context.rulePackageVersionId) {
    const gateResult = evaluateG6({
      productId: input.productId,
      rulePackageStatus: "draft_pending_confirmation",
      allowedContentTypes: [],
      conditionalContentTypes: [],
      blockedContentTypes: [],
      allowedChannels: [],
      requiredEvidenceRoles: [],
      evidenceGapIds: [],
      globalBlockingGapIds: [],
      maxMonthlyQuota: null,
      evaluatorVersion
    });
    return {
      ok: false as const,
      status: "blocked",
      code: "active_rule_package_required",
      message: "产品没有 active 规则包，不能计算为月度可生产。",
      nextActions: gateResult.nextActions,
      data: { gateResult, monthlyProductionReady: false }
    };
  }

  const scope = context.monthlyMatrixScope || {};
  const activeGaps = context.gaps.filter((gap) => ["open", "in_progress"].includes(gap.status));
  const globalBlockingGapIds = activeGaps.filter(isGlobalBlockingGap).map((gap) => gap.id);
  const evidenceGapIds = Array.from(new Set([...context.evidenceGapIds, ...activeGaps.map((gap) => gap.id)]));
  const gateResult = evaluateG6({
    productId: input.productId,
    rulePackageVersionId: context.rulePackageVersionId,
    rulePackageStatus: context.rulePackageStatus as V5RulePackageVersionStatus,
    sourceSnapshotHash: context.sourceSnapshotHash,
    allowedContentTypes: asStringArray(scope.allowedContentTypes),
    conditionalContentTypes: asStringArray(scope.conditionalContentTypes),
    blockedContentTypes: asStringArray(scope.blockedContentTypes),
    allowedChannels: asStringArray(scope.allowedChannels),
    requiredEvidenceRoles: asStringArray(scope.requiredEvidenceRoles),
    evidenceGapIds,
    globalBlockingGapIds,
    maxMonthlyQuota: typeof scope.maxMonthlyQuota === "number" ? scope.maxMonthlyQuota : null,
    evaluatorVersion
  });
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    rulePackageVersionId: context.rulePackageVersionId,
    sourceSnapshotHash: context.sourceSnapshotHash,
    scope,
    evidenceGapIds,
    evaluatorVersion
  });
  const stored = await upsertV5MonthlyReadinessRecord({
    productId: input.productId,
    rulePackageVersionId: context.rulePackageVersionId,
    sourceSnapshotId: context.sourceSnapshotId,
    sourceSnapshotHash: context.sourceSnapshotHash,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    evaluatorVersion,
    governanceRunId: input.governanceRunId,
    gateResult,
    actor: input.actor
  });
  return {
    ok: gateResult.ok,
    status: gateResult.status,
    data: { ...stored, gateResult, rulePackageVersionId: context.rulePackageVersionId, sourceSnapshotHash: context.sourceSnapshotHash }
  };
}

export async function getV5MonthlyProductionReadiness(productId: string) {
  assertText(productId, "productId");
  const readiness = await readV5MonthlyReadinessRecord(productId);
  if (!readiness) {
    return {
      ok: true as const,
      status: "not_evaluated",
      data: { productId, monthlyProductionReady: false, nextAction: "先激活规则包，再执行 G6 月度生产准备度评估。" }
    };
  }
  return { ok: true as const, status: "success", data: readiness };
}
