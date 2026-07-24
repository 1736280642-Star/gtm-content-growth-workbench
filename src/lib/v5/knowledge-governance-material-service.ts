import type {
  V5ApprovalAction,
  V5EvidenceGapSeverity,
  V5GovernanceRole
} from "./knowledge-governance-contracts";
import {
  approveV5RulePackageVersionRecord,
  classifyV5SourceAssetRecord,
  createV5ClaimConflictRecord,
  createV5EvidenceGapRecord,
  createV5RulePackageDraftRecord,
  createV5SourceRevisionRecord,
  insertV5ProductClaimsRecord,
  readV5KnowledgeBaseRegistryRecord,
  readV5ProductGovernanceSummary,
  registerV5SourceAssetsRecord,
  reviewV5ProductClaimRecord,
  upsertV5KnowledgeBaseRegistryRecord,
  upsertV5ProductEntityRecord,
  type V5ClaimWriteInput,
  type V5RuleDraftWriteInput,
  type V5SourceRegistrationInput
} from "./knowledge-governance-material-repository";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { V5GovernanceServiceError, type V5WriteEnvelope } from "./knowledge-governance-service";
import {
  evaluateG0,
  evaluateG1,
  evaluateG2,
  evaluateG3,
  evaluateG4,
  type V5G0Input,
  type V5G1Input,
  type V5G2Input,
  type V5G4ConflictInput,
  type V5G4GapInput
} from "./knowledge-governance-workflow";

function assertText(value: string | undefined, field: string) {
  if (!value?.trim()) throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId");
  assertText(actor.actorRole, "actorRole");
  assertText(actor.auditReason, "auditReason");
}

function assertEnvelope(envelope: V5WriteEnvelope) {
  assertText(envelope.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(envelope.expectedVersion) || envelope.expectedVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是非负整数。", 400);
  }
  assertActor(envelope.actor);
}

function requireHumanRole(actor: V5GovernanceActor, roles: string[]) {
  if (actor.actorType !== "human" || !roles.includes(actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "permission_denied",
      `当前操作只允许人工角色 ${roles.join(", ")}。`,
      403,
      "由对应责任角色完成人工判断；Agent 只能生成候选和草稿。"
    );
  }
}

export async function upsertV5KnowledgeBaseRegistry(input: V5WriteEnvelope & {
  knowledgeBaseId: string;
  name: string;
  type: string;
  trustLevel: string;
  status: string;
  updateMode: string;
  usageScope?: string;
  lastSyncedAt?: string;
}) {
  assertEnvelope(input);
  requireHumanRole(input.actor, ["knowledge_manager", "product_owner"]);
  assertText(input.knowledgeBaseId, "knowledgeBaseId");
  assertText(input.name, "name");
  assertText(input.type, "type");
  assertText(input.trustLevel, "trustLevel");
  const stored = await upsertV5KnowledgeBaseRegistryRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : input.expectedVersion === 0 ? "created" : "updated", data: stored };
}

export async function getV5KnowledgeBaseRegistry(knowledgeBaseId: string) {
  assertText(knowledgeBaseId, "knowledgeBaseId");
  const record = await readV5KnowledgeBaseRegistryRecord(knowledgeBaseId);
  if (!record) throw new V5GovernanceServiceError("not_found", "知识库登记不存在。", 404);
  return { ok: true as const, status: "success", data: record };
}

export async function upsertV5ProductEntity(input: V5WriteEnvelope & {
  productId: string;
  canonicalName: string;
  displayName: string;
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  productCategory?: string;
  aliases: string[];
  knowledgeBaseIds: string[];
}) {
  assertEnvelope(input);
  requireHumanRole(input.actor, ["product_owner", "business_owner"]);
  assertText(input.productId, "productId");
  assertText(input.canonicalName, "canonicalName");
  assertText(input.displayName, "displayName");
  if (input.knowledgeBaseIds.length === 0) throw new V5GovernanceServiceError("invalid_contract", "产品至少需要关联一个知识库。", 400);
  const stored = await upsertV5ProductEntityRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : input.expectedVersion === 0 ? "created" : "updated", data: stored };
}

export async function registerV5SourceAssets(input: V5WriteEnvelope & {
  batchId: string;
  sources: Array<V5SourceRegistrationInput & { g0: V5G0Input }>;
}) {
  assertEnvelope(input);
  assertText(input.batchId, "batchId");
  if (input.sources.length === 0 || input.sources.length > 100) throw new V5GovernanceServiceError("invalid_contract", "sources 必须包含 1-100 份资料。", 400);
  const gateResults = input.sources.map((source) => ({ sourceId: source.sourceId, result: evaluateG0(source.g0) }));
  const sources = input.sources.map(({ g0: _g0, ...source }) => {
    const gateResult = gateResults.find((item) => item.sourceId === source.sourceId)?.result;
    if (!gateResult) return source;
    if (gateResult.decision === "isolate") {
      return { ...source, status: "isolated", safetyStatus: "isolated" as const, isolatedReason: gateResult.reasonCodes.join(",") };
    }
    if (!gateResult.modelEligible && gateResult.status === "conditional") {
      return { ...source, status: "review_required", safetyStatus: "restricted_approved" as const };
    }
    return { ...source, safetyStatus: "passed" as const };
  });
  const stored = await registerV5SourceAssetsRecord({ ...input, sources });
  return {
    ok: true as const,
    status: stored.replayed ? "replayed" : "registered",
    data: { ...stored, gateResults, isolatedCount: gateResults.filter((item) => item.result.decision === "isolate").length }
  };
}

export async function createV5SourceRevision(input: V5WriteEnvelope & {
  sourceId: string;
  g1: V5G1Input;
  revision: {
    contentHash: string;
    rawAssetRef?: string;
    normalizedTextRef: string;
    titleSnapshot?: string;
    canonicalUrlSnapshot?: string;
    capturedAt: string;
    sourceUpdatedAt?: string;
    parserName: string;
    parserVersion: string;
    parseStatus: "parsed" | "parse_failed";
    qualityFlags: string[];
    contentLength: number;
  };
}) {
  assertEnvelope(input);
  assertText(input.sourceId, "sourceId");
  const gateResult = evaluateG1(input.g1);
  if (!gateResult.ok) {
    return { ok: false as const, status: gateResult.status, code: "source_gate_failed", message: "G1 未通过，未创建可供 Claim 使用的 SourceRevision。", data: { gateResult } };
  }
  const stored = await createV5SourceRevisionRecord({ ...input.revision, sourceId: input.sourceId, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, actor: input.actor });
  return { ok: true as const, status: stored.replayed ? "replayed" : "parsed", data: { ...stored, gateResult } };
}

export async function classifyV5SourceAsset(input: V5WriteEnvelope & {
  sourceId: string;
  g2: V5G2Input;
  classification: {
    documentType: string;
    authorityLevel: V5SourceRegistrationInput["authorityLevel"];
    lifecycleStatus: V5SourceRegistrationInput["lifecycleStatus"];
    visibility: V5SourceRegistrationInput["visibility"];
    productCandidates: string[];
    classificationConfidence: number;
    classificationReasons: string[];
    productId?: string;
  };
}) {
  assertEnvelope(input);
  const gateResult = evaluateG2(input.g2);
  if (!gateResult.ok) {
    return { ok: false as const, status: gateResult.status, code: "classification_review_required", message: "G2 未通过，来源保持待人工确认。", data: { gateResult } };
  }
  const stored = await classifyV5SourceAssetRecord({ ...input.classification, sourceId: input.sourceId, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, actor: input.actor });
  return { ok: true as const, status: stored.replayed ? "replayed" : "approved_for_claim_extraction", data: { ...stored, gateResult } };
}

export async function extractV5ProductClaims(input: {
  sourceRevisionId: string;
  claims: V5ClaimWriteInput[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.sourceRevisionId, "sourceRevisionId");
  assertText(input.idempotencyKey, "idempotencyKey");
  assertActor(input.actor);
  const gateResult = evaluateG3({
    sourceRevisionId: input.sourceRevisionId,
    extractorVersion: input.claims[0]?.extractorVersion,
    claims: input.claims.map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      normalizedClaim: claim.normalizedClaim,
      originalQuote: claim.originalQuote,
      sourceId: claim.sourceId,
      sourceRevisionId: claim.sourceRevisionId,
      sourceLocatorAvailable: Object.keys(claim.sourceLocator).length > 0,
      authorityLevel: claim.authorityLevel,
      supportMode: claim.supportMode,
      capabilityStatus: claim.capabilityStatus,
      claimScope: claim.claimScope,
      conditions: claim.conditions,
      limitations: claim.limitations,
      productVersion: claim.productVersion,
      reviewStatus: claim.reviewStatus,
      hasMetricTestConditions: claim.claimType !== "performance_metric" || (claim.conditions.length > 0 && Boolean(claim.productVersion))
    }))
  });
  if (!gateResult.ok) {
    return { ok: false as const, status: gateResult.status, code: "claim_contract_failed", message: "G3 未通过，Claim 未写入。", data: { gateResult } };
  }
  const stored = await insertV5ProductClaimsRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "claims_created", data: { ...stored, gateResult } };
}

export async function reviewV5ProductClaim(input: V5WriteEnvelope & {
  claimId: string;
  reviewStatus: "supported" | "conditional" | "rejected";
  conditions?: string[];
  limitations?: string[];
}) {
  assertEnvelope(input);
  requireHumanRole(input.actor, ["knowledge_manager", "product_owner", "technical_owner", "security_owner", "privacy_owner", "legal_owner", "delivery_owner"]);
  const stored = await reviewV5ProductClaimRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : input.reviewStatus, data: stored };
}

export async function createV5ClaimConflict(input: {
  conflictId?: string;
  productId: string;
  conflictType: string;
  subject: string;
  claimIds: string[];
  sourceIds: string[];
  preferredTemporaryClaimId?: string;
  temporaryPolicy: string;
  severity: V5EvidenceGapSeverity;
  requiredRoles: V5GovernanceRole[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertActor(input.actor);
  assertText(input.idempotencyKey, "idempotencyKey");
  if (input.claimIds.length < 2) throw new V5GovernanceServiceError("invalid_contract", "冲突组至少需要两条 Claim。", 400);
  const stored = await createV5ClaimConflictRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "open", data: stored };
}

export async function createV5EvidenceGap(input: {
  gapId?: string;
  productId: string;
  gapCode: string;
  title: string;
  description?: string;
  affectedRuleFields: string[];
  affectedClaimTypes: string[];
  triggerSourceIds: string[];
  severity: V5EvidenceGapSeverity;
  recommendedAction: string;
  ownerRole: V5GovernanceRole;
  dueAt?: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertActor(input.actor);
  assertText(input.idempotencyKey, "idempotencyKey");
  const stored = await createV5EvidenceGapRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "open", data: stored };
}

export async function createV5RulePackageDraft(input: {
  productId: string;
  draft: V5RuleDraftWriteInput;
  conflicts: V5G4ConflictInput[];
  gaps: V5G4GapInput[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertActor(input.actor);
  assertText(input.idempotencyKey, "idempotencyKey");
  const gateResult = evaluateG4({ conflicts: input.conflicts, gaps: input.gaps });
  if (!gateResult.ok) {
    return { ok: false as const, status: gateResult.status, code: "conflict_resolution_required", message: "G4 未通过，未生成可提交审批的规则包草稿。", data: { gateResult } };
  }
  const stored = await createV5RulePackageDraftRecord({ productId: input.productId, draft: input.draft, idempotencyKey: input.idempotencyKey, actor: input.actor });
  return { ok: true as const, status: stored.replayed ? "replayed" : stored.status, data: { ...stored, gateResult } };
}

export async function approveV5RulePackageVersion(input: V5WriteEnvelope & {
  rulePackageVersionId: string;
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  reason: string;
  evidenceSourceIds: string[];
}) {
  assertEnvelope(input);
  requireHumanRole(input.actor, [input.role]);
  assertText(input.reason, "reason");
  const stored = await approveV5RulePackageVersionRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : stored.approvalStatus, data: stored };
}

export async function getV5ProductGovernanceSummary(productId: string) {
  assertText(productId, "productId");
  const summary = await readV5ProductGovernanceSummary(productId);
  if (!summary) throw new V5GovernanceServiceError("not_found", "产品治理实体不存在。", 404);
  return { ok: true as const, status: "success", data: summary };
}
