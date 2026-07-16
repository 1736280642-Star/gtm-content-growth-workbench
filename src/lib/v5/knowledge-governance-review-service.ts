import type { V5ApprovalAction, V5GovernanceRole, V5RulePackageVersionStatus } from "./knowledge-governance-contracts";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { readV5RuleActivationContext } from "./knowledge-governance-repository";
import {
  listV5ProductClaimsRecord,
  readV5ProductReviewQueueRecord,
  readV5RulePackageVersionDetailRecord,
  resolveV5ClaimConflictRecord,
  reviewV5RulePackageChangeRecord,
  updateV5EvidenceGapRecord
} from "./knowledge-governance-review-repository";
import { V5GovernanceServiceError, type V5WriteEnvelope } from "./knowledge-governance-service";
import { evaluateG5, type V5G5ApprovalInput } from "./knowledge-governance-workflow";

function assertText(value: string | undefined, field: string) {
  if (!value?.trim()) throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId");
  assertText(actor.actorRole, "actorRole");
  assertText(actor.auditReason, "auditReason");
  if (actor.actorType !== "human") {
    throw new V5GovernanceServiceError("permission_denied", "人工治理动作不能由 Agent、Scheduler 或 System 代替。", 403);
  }
}

function assertEnvelope(input: V5WriteEnvelope) {
  assertText(input.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是非负整数。", 400);
  }
  assertActor(input.actor);
}

function hasTextValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function productIdentityComplete(identity: Record<string, unknown>) {
  const name = identity.productName || identity.canonicalName || identity.name;
  const category = identity.productCategory || identity.category;
  const definition = identity.productDefinition || identity.definition || identity.positioning;
  return hasTextValue(name) && hasTextValue(category) && hasTextValue(definition) && identity.evidenceStatus !== "blocking_gap";
}

function isGlobalBlockingGap(gap: { severity: string; affectedRuleFields: string[] }) {
  if (gap.severity !== "blocking") return false;
  if (gap.affectedRuleFields.length === 0) return true;
  return gap.affectedRuleFields.some((field) => ["*", "productIdentity", "monthlyMatrixScope", "rulePackageActivation"].includes(field));
}

export async function listV5ProductClaims(input: { productId: string; reviewStatus?: string; claimType?: string }) {
  assertText(input.productId, "productId");
  const claims = await listV5ProductClaimsRecord(input);
  return { ok: true as const, status: "success", data: { productId: input.productId, claims, count: claims.length } };
}

export async function getV5ProductReviewQueue(productId: string) {
  assertText(productId, "productId");
  const queue = await readV5ProductReviewQueueRecord(productId);
  return {
    ok: true as const,
    status: "success",
    data: {
      ...queue,
      counts: {
        claims: queue.claims.length,
        conflicts: queue.conflicts.length,
        evidenceGaps: queue.evidenceGaps.length,
        rulePackages: queue.rulePackages.length,
        ruleChanges: queue.ruleChanges.length
      }
    }
  };
}

export async function resolveV5ClaimConflict(input: V5WriteEnvelope & {
  conflictId: string;
  action: "resolve" | "accept_risk";
  selectedClaimId?: string;
  applicableVersion?: string;
  temporaryPolicy: string;
  claimDecisions: Array<{ claimId: string; reviewStatus: "candidate" | "supported" | "conditional" | "rejected" | "superseded" }>;
  resolutionReason: string;
}) {
  assertEnvelope(input);
  assertText(input.conflictId, "conflictId");
  assertText(input.temporaryPolicy, "temporaryPolicy");
  assertText(input.resolutionReason, "resolutionReason");
  const result = await resolveV5ClaimConflictRecord(input);
  return { ok: true as const, status: result.replayed ? "replayed" : result.status, data: result };
}

export async function updateV5EvidenceGap(input: V5WriteEnvelope & {
  gapId: string;
  action: "start" | "resolve" | "accept_risk" | "reopen";
  resolvedBySourceIds: string[];
  resolutionNote: string;
}) {
  assertEnvelope(input);
  assertText(input.gapId, "gapId");
  assertText(input.resolutionNote, "resolutionNote");
  const result = await updateV5EvidenceGapRecord(input);
  return { ok: true as const, status: result.replayed ? "replayed" : result.status, data: result };
}

export async function getV5RulePackageVersionDetail(rulePackageVersionId: string) {
  assertText(rulePackageVersionId, "rulePackageVersionId");
  const detail = await readV5RulePackageVersionDetailRecord(rulePackageVersionId);
  if (!detail) throw new V5GovernanceServiceError("not_found", "规则包版本不存在。", 404);
  return { ok: true as const, status: "success", data: detail };
}

export async function reviewV5RulePackageChange(input: V5WriteEnvelope & {
  changeId: string;
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  reason: string;
  evidenceSourceIds: string[];
}) {
  assertEnvelope(input);
  assertText(input.changeId, "changeId");
  assertText(input.role, "role");
  assertText(input.reason, "reason");
  const allowedActions: V5ApprovalAction[] = [
    "approve",
    "approve_with_conditions",
    "request_changes",
    "reject",
    "request_more_evidence",
    "accept_conservative_wording",
    "defer"
  ];
  if (!allowedActions.includes(input.action)) {
    throw new V5GovernanceServiceError("invalid_contract", `不支持的规则变更复核动作：${input.action}。`, 400);
  }
  const result = await reviewV5RulePackageChangeRecord(input);
  return { ok: true as const, status: result.replayed ? "replayed" : result.reviewStatus, data: result };
}

export async function previewV5RulePackageActivation(rulePackageVersionId: string) {
  assertText(rulePackageVersionId, "rulePackageVersionId");
  const context = await readV5RuleActivationContext(rulePackageVersionId);
  if (!context) throw new V5GovernanceServiceError("not_found", "规则包版本不存在。", 404);
  const blockingGaps = context.gaps.filter(isGlobalBlockingGap);
  const gateResult = evaluateG5({
    actorType: "human",
    actorId: "activation-preview",
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
  return {
    ok: true as const,
    status: gateResult.ok ? "activation_ready" : "blocked",
    data: {
      rulePackageVersionId,
      activationReady: gateResult.ok,
      gateResult,
      summary: {
        approvedClaimCount: context.approvedClaimCount,
        pendingRoles: context.pendingRoles,
        unresolvedBlockingConflictCount: context.conflicts.filter((item) => item.severity === "blocking" && item.status === "open").length,
        unresolvedGlobalBlockingGapCount: blockingGaps.length,
        sourceSnapshotHash: context.sourceSnapshotHash
      }
    }
  };
}
