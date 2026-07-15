import type {
  V5ApprovalAction,
  V5AuthorityLevel,
  V5EvidenceGapSeverity,
  V5GateCode,
  V5GovernanceRole,
  V5LifecycleStatus,
  V5ProductClaimStatus,
  V5RulePackageVersionStatus,
  V5SupportMode,
  V5Visibility
} from "./knowledge-governance-contracts";

export type V5GateStatus = "passed" | "conditional" | "pending_input" | "blocked" | "failed";
export type V5GateDecision = "advance" | "hold" | "isolate" | "activate" | "ready" | "block";

export interface V5GateResult<TOutput extends Record<string, unknown> = Record<string, unknown>> {
  gate: V5GateCode;
  ok: boolean;
  status: V5GateStatus;
  decision: V5GateDecision;
  nextGate?: V5GateCode;
  modelEligible: boolean;
  reasonCodes: string[];
  blockers: string[];
  warnings: string[];
  nextActions: string[];
  output: TOutput;
}

export interface V5G0Input {
  safetyScanCompleted: boolean;
  detectedRiskTypes: string[];
  visibility: V5Visibility;
  restrictedUseApproved: boolean;
  processingMode: "local_only" | "external_model";
  sourceAuthorized: boolean;
  isolatedSourceCount?: number;
  eligibleSourceCount?: number;
}

export interface V5G1Input {
  parseStatus: "parsed" | "parse_failed" | "pending";
  normalizedTextRef?: string;
  title?: string;
  contentHash?: string;
  canonicalResolved: boolean;
  sourceLocatorAvailable: boolean;
  contentLength: number;
  qualityFlags: string[];
}

export interface V5G2Input {
  documentType?: string;
  authorityLevel?: V5AuthorityLevel;
  lifecycleStatus?: V5LifecycleStatus;
  visibility?: V5Visibility;
  classificationConfidence: number;
  productMatchStatus: "confirmed" | "ambiguous" | "new_candidate" | "cross_product" | "unmatched";
  productId?: string;
  humanClassificationConfirmed: boolean;
  requiresHighRiskReview: boolean;
}

export interface V5G3ClaimInput {
  claimId?: string;
  claimType: string;
  normalizedClaim?: string;
  originalQuote?: string;
  sourceId?: string;
  sourceRevisionId?: string;
  sourceLocatorAvailable: boolean;
  authorityLevel?: V5AuthorityLevel;
  supportMode: V5SupportMode;
  capabilityStatus?: V5LifecycleStatus;
  claimScope?: string;
  conditions: string[];
  limitations: string[];
  productVersion?: string;
  reviewStatus: V5ProductClaimStatus;
  hasMetricTestConditions?: boolean;
}

export interface V5G3Input {
  claims: V5G3ClaimInput[];
  extractorVersion?: string;
  sourceRevisionId?: string;
}

export interface V5G4ConflictInput {
  conflictId: string;
  severity: V5EvidenceGapSeverity;
  status: "open" | "resolved" | "accepted_risk" | "superseded";
  temporaryPolicy?: string;
  requiredRoles: V5GovernanceRole[];
}

export interface V5G4GapInput {
  gapId: string;
  severity: V5EvidenceGapSeverity;
  status: "open" | "in_progress" | "resolved" | "accepted_risk" | "superseded";
  affectedRuleFields: string[];
  ownerRole?: V5GovernanceRole;
}

export interface V5G4Input {
  conflicts: V5G4ConflictInput[];
  gaps: V5G4GapInput[];
}

export interface V5G5ApprovalInput {
  role: V5GovernanceRole;
  action: V5ApprovalAction;
  status: "pending" | "approved" | "changes_requested" | "rejected" | "deferred";
}

export interface V5G5Input {
  actorType: "human" | "agent" | "scheduler" | "system";
  actorId?: string;
  rulePackageVersionId?: string;
  rulePackageStatus: V5RulePackageVersionStatus;
  productIdentityComplete: boolean;
  approvedClaimCount: number;
  pendingRoles: V5GovernanceRole[];
  approvals: V5G5ApprovalInput[];
  unresolvedBlockingConflictCount: number;
  unresolvedBlockingGapCount: number;
  sourceSnapshotHash?: string;
}

export interface V5G6Input {
  productId?: string;
  rulePackageVersionId?: string;
  rulePackageStatus: V5RulePackageVersionStatus;
  sourceSnapshotHash?: string;
  allowedContentTypes: string[];
  conditionalContentTypes: string[];
  blockedContentTypes: string[];
  allowedChannels: string[];
  requiredEvidenceRoles: string[];
  evidenceGapIds: string[];
  globalBlockingGapIds: string[];
  maxMonthlyQuota?: number | null;
  evaluatorVersion?: string;
}

export interface V5GovernanceWorkflowInput {
  G0?: V5G0Input;
  G1?: V5G1Input;
  G2?: V5G2Input;
  G3?: V5G3Input;
  G4?: V5G4Input;
  G5?: V5G5Input;
  G6?: V5G6Input;
}

export interface V5GovernanceWorkflowResult {
  ok: boolean;
  status: "completed" | "blocked" | "awaiting_input";
  currentGate: V5GateCode;
  completedGates: V5GateCode[];
  results: V5GateResult[];
  monthlyProductionReady: boolean;
  nextActions: string[];
}

const gateOrder: V5GateCode[] = ["G0", "G1", "G2", "G3", "G4", "G5", "G6"];
const nextGateByGate: Partial<Record<V5GateCode, V5GateCode>> = {
  G0: "G1",
  G1: "G2",
  G2: "G3",
  G3: "G4",
  G4: "G5",
  G5: "G6"
};

const blockingQualityFlags = new Set([
  "empty_content",
  "navigation_only",
  "blocked_page",
  "table_structure_lost",
  "sensitive_content",
  "parser_version_unknown"
]);
const highRiskClaimTypes = new Set([
  "performance_metric",
  "customer_outcome",
  "customer_case",
  "compliance_qualification",
  "data_flow_privacy",
  "security_control"
]);
const derivedForbiddenClaimTypes = new Set([
  "performance_metric",
  "customer_outcome",
  "compliance_qualification",
  "data_flow_privacy"
]);
const allowedTemporaryPolicies = new Set([
  "use_more_conservative_claim",
  "downgrade_to_conditional",
  "remove_metric",
  "limit_to_specific_version",
  "limit_to_specific_deployment",
  "mark_as_planned_or_unverified",
  "block_public_expression"
]);

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function result<TOutput extends Record<string, unknown>>(
  gate: V5GateCode,
  status: V5GateStatus,
  decision: V5GateDecision,
  details: {
    modelEligible?: boolean;
    reasonCodes?: string[];
    blockers?: string[];
    warnings?: string[];
    nextActions?: string[];
    output: TOutput;
  }
): V5GateResult<TOutput> {
  const ok = status === "passed" || status === "conditional";

  return {
    gate,
    ok,
    status,
    decision,
    nextGate: ok ? nextGateByGate[gate] : undefined,
    modelEligible: details.modelEligible ?? true,
    reasonCodes: unique(details.reasonCodes || []),
    blockers: unique(details.blockers || []),
    warnings: unique(details.warnings || []),
    nextActions: unique(details.nextActions || []),
    output: details.output
  };
}

export function evaluateG0(input: V5G0Input): V5GateResult {
  if (!input.safetyScanCompleted) {
    return result("G0", "pending_input", "hold", {
      modelEligible: false,
      reasonCodes: ["safety_scan_required"],
      blockers: ["尚未完成敏感信息、安全与授权边界扫描。"],
      nextActions: ["先执行 G0 扫描并只记录风险类型，不向普通页面返回敏感片段。"],
      output: { sourceStatus: "pending_parse" }
    });
  }

  if (!input.sourceAuthorized) {
    return result("G0", "blocked", "isolate", {
      modelEligible: false,
      reasonCodes: ["source_not_authorized"],
      blockers: ["来源超出授权范围。"],
      nextActions: ["隔离来源并由有权限的维护者确认授权、删除或重新选择资料。"],
      output: { sourceStatus: "isolated" }
    });
  }

  if (input.visibility === "unknown") {
    return result("G0", "pending_input", "hold", {
      modelEligible: false,
      reasonCodes: ["visibility_unknown"],
      blockers: ["资料公开与权限边界尚未确认。"],
      nextActions: ["确认资料属于 public、internal、restricted_customer 或 confidential。"],
      output: { sourceStatus: "review_required" }
    });
  }

  if (input.detectedRiskTypes.length > 0) {
    if (input.restrictedUseApproved && input.processingMode === "local_only") {
      return result("G0", "conditional", "advance", {
        modelEligible: false,
        reasonCodes: ["restricted_local_processing_only"],
        warnings: ["敏感或受限资料只获准在本地受限流程中使用，禁止发送给外部模型或向量服务。"],
        nextActions: ["保持受限可见性并在后续来源、Claim 和规则包中继承使用范围。"],
        output: { sourceStatus: "review_required", restrictedProcessing: true }
      });
    }

    return result("G0", "blocked", "isolate", {
      modelEligible: false,
      reasonCodes: ["sensitive_content_detected", ...input.detectedRiskTypes.map((risk) => `risk:${risk}`)],
      blockers: ["资料命中敏感、凭证、隐私、私有链接或未经授权客户数据风险。"],
      nextActions: ["隔离资料；完成删除、脱敏或受限使用审批后重新接入。"],
      output: { sourceStatus: "isolated", riskTypes: input.detectedRiskTypes }
    });
  }

  const partialIsolation = (input.isolatedSourceCount || 0) > 0;
  return result("G0", partialIsolation ? "conditional" : "passed", "advance", {
    modelEligible: input.processingMode === "external_model",
    reasonCodes: partialIsolation ? ["batch_contains_isolated_sources"] : [],
    warnings: partialIsolation ? [`批次中已有 ${input.isolatedSourceCount} 份资料被独立隔离；后续只处理 ${input.eligibleSourceCount || 0} 份通过 G0 的资料。`] : [],
    output: {
      sourceStatus: "pending_parse",
      restrictedProcessing: false,
      isolatedSourceCount: input.isolatedSourceCount || 0,
      eligibleSourceCount: input.eligibleSourceCount || 0
    }
  });
}

export function evaluateG1(input: V5G1Input): V5GateResult {
  const blockers: string[] = [];
  const reasonCodes: string[] = [];
  const matchedBlockingFlags = input.qualityFlags.filter((flag) => blockingQualityFlags.has(flag));

  if (input.parseStatus !== "parsed") {
    blockers.push(input.parseStatus === "parse_failed" ? "正文解析失败。" : "正文解析尚未完成。");
    reasonCodes.push(input.parseStatus === "parse_failed" ? "parse_failed" : "parse_pending");
  }
  if (!input.normalizedTextRef || input.contentLength <= 0) {
    blockers.push("缺少稳定的解析正文引用或正文为空。"), reasonCodes.push("normalized_text_missing");
  }
  if (!input.contentHash || !/^[a-f0-9]{64}$/i.test(input.contentHash)) {
    blockers.push("缺少稳定的 64 位正文 Hash。"), reasonCodes.push("content_hash_missing");
  }
  if (!input.canonicalResolved) {
    blockers.push("canonical、重定向或参数 URL 尚未归一化。"), reasonCodes.push("canonical_unresolved");
  }
  if (!input.sourceLocatorAvailable) {
    blockers.push("正文无法提供稳定原文定位。"), reasonCodes.push("source_locator_missing");
  }
  if (matchedBlockingFlags.length > 0) {
    blockers.push(`解析质量存在阻断标记：${matchedBlockingFlags.join(", ")}。`);
    reasonCodes.push(...matchedBlockingFlags.map((flag) => `quality:${flag}`));
  }

  if (blockers.length > 0) {
    return result("G1", input.parseStatus === "parse_failed" ? "failed" : "pending_input", "hold", {
      reasonCodes,
      blockers,
      nextActions: ["重试解析、补充正文或人工修正来源；错误页和空页不得进入事实抽取。"],
      output: { sourceStatus: input.parseStatus === "parse_failed" ? "parse_failed" : "pending_parse" }
    });
  }

  const warnings = input.title ? [] : ["来源标题缺失，应在分类审核时补充。"];
  return result("G1", warnings.length ? "conditional" : "passed", "advance", {
    warnings,
    reasonCodes: warnings.length ? ["missing_title"] : [],
    nextActions: warnings.length ? ["补充可追溯标题，但不得据此改写正文。"] : [],
    output: { sourceStatus: "parsed", qualityFlags: input.qualityFlags }
  });
}

export function evaluateG2(input: V5G2Input): V5GateResult {
  const missing = [
    input.documentType ? "" : "document_type_missing",
    input.authorityLevel ? "" : "authority_level_missing",
    input.lifecycleStatus ? "" : "lifecycle_status_missing",
    input.visibility ? "" : "visibility_missing"
  ].filter(Boolean);

  if (missing.length > 0) {
    return result("G2", "pending_input", "hold", {
      reasonCodes: missing,
      blockers: ["资料类型、权威等级、生命周期或公开边界不完整。"],
      nextActions: ["补齐五维来源分类，再进行产品实体确认。"],
      output: { sourceStatus: "review_required" }
    });
  }

  if (["ambiguous", "new_candidate", "unmatched"].includes(input.productMatchStatus)) {
    return result("G2", "pending_input", "hold", {
      reasonCodes: [`entity_${input.productMatchStatus}`],
      blockers: ["产品实体存在歧义、新产品候选或尚未匹配。"],
      nextActions: ["由产品或知识库负责人确认新实体、关联已有实体或拒绝候选。"],
      output: { sourceStatus: "review_required", entityStatus: input.productMatchStatus }
    });
  }

  if (!input.productId && input.productMatchStatus !== "cross_product") {
    return result("G2", "pending_input", "hold", {
      reasonCodes: ["product_id_missing"],
      blockers: ["资料尚未绑定稳定 productId。"],
      nextActions: ["确认产品实体并保存稳定 productId；不得使用产品名称代替主键。"],
      output: { sourceStatus: "review_required" }
    });
  }

  const needsHumanReview =
    input.requiresHighRiskReview ||
    input.productMatchStatus === "cross_product" ||
    input.authorityLevel === "A1" ||
    input.visibility !== "public" ||
    input.classificationConfidence < 0.85;

  if (needsHumanReview && !input.humanClassificationConfirmed) {
    return result("G2", "pending_input", "hold", {
      reasonCodes: ["human_classification_required"],
      blockers: ["高风险、跨产品、受限或低置信资料必须人工确认分类与归属。"],
      nextActions: ["保存人工修正前后值、角色和原因后，再批准事实抽取。"],
      output: { sourceStatus: "review_required" }
    });
  }

  return result("G2", input.productMatchStatus === "cross_product" ? "conditional" : "passed", "advance", {
    warnings: input.productMatchStatus === "cross_product" ? ["跨产品资料只能拆成按 productId 归属的独立 Claim；不可作为单产品整体验证。"] : [],
    reasonCodes: input.productMatchStatus === "cross_product" ? ["cross_product_claim_split_required"] : [],
    output: { sourceStatus: "approved_for_claim_extraction", productId: input.productId || null }
  });
}

export function evaluateG3(input: V5G3Input): V5GateResult {
  if (!input.extractorVersion || !input.sourceRevisionId) {
    return result("G3", "pending_input", "hold", {
      reasonCodes: ["extraction_version_or_revision_missing"],
      blockers: ["事实抽取缺少 sourceRevisionId 或 extractorVersion。"],
      nextActions: ["绑定不可变来源修订和抽取器版本后重试。"],
      output: { acceptedClaimCount: 0 }
    });
  }

  if (input.claims.length === 0) {
    return result("G3", "pending_input", "hold", {
      reasonCodes: ["no_claims_extracted"],
      blockers: ["当前来源没有形成可审查的原子事实。"],
      nextActions: ["人工检查正文是否为有效产品资料，或记录证据缺口而不是用模型常识补全。"],
      output: { acceptedClaimCount: 0 }
    });
  }

  const invalidClaims: string[] = [];
  const reviewRequiredClaims: string[] = [];
  for (const [index, claim] of input.claims.entries()) {
    const label = claim.claimId || `claim#${index + 1}`;
    const traceable =
      Boolean(claim.normalizedClaim && claim.originalQuote && claim.sourceId && claim.sourceRevisionId && claim.authorityLevel && claim.claimScope) &&
      claim.sourceLocatorAvailable;
    if (!traceable) invalidClaims.push(`${label}:traceability_incomplete`);
    if (claim.supportMode === "unsupported") invalidClaims.push(`${label}:unsupported`);
    if (claim.supportMode === "derived" && derivedForbiddenClaimTypes.has(claim.claimType)) invalidClaims.push(`${label}:derived_forbidden`);
    if (claim.claimType === "performance_metric" && !claim.hasMetricTestConditions) invalidClaims.push(`${label}:metric_conditions_missing`);
    if (["beta", "planned"].includes(claim.capabilityStatus || "") && claim.conditions.length === 0) invalidClaims.push(`${label}:lifecycle_condition_missing`);
    if (highRiskClaimTypes.has(claim.claimType) || ["B2", "C2", "D", "E"].includes(claim.authorityLevel || "")) reviewRequiredClaims.push(label);
  }

  if (invalidClaims.length > 0) {
    return result("G3", "blocked", "block", {
      reasonCodes: invalidClaims,
      blockers: ["存在缺少原文、定位、适用范围、测试条件或使用禁止推导方式的 Claim。"],
      nextActions: ["将不完整 Claim 降级为候选/证据不足，保留限制与否定事实后重新审核。"],
      output: { acceptedClaimCount: 0, rejectedClaimRefs: invalidClaims }
    });
  }

  const candidateCount = input.claims.filter((claim) => claim.reviewStatus === "candidate").length;
  return result("G3", reviewRequiredClaims.length || candidateCount ? "conditional" : "passed", "advance", {
    reasonCodes: reviewRequiredClaims.length ? ["high_risk_claim_review_required"] : candidateCount ? ["candidate_claim_review_required"] : [],
    warnings: reviewRequiredClaims.length ? [`${reviewRequiredClaims.length} 条高风险 Claim 必须由对应责任角色人工复核。`] : [],
    nextActions: reviewRequiredClaims.length || candidateCount ? ["逐条确认 Claim，不得把抽取置信度当作事实真实性。"] : [],
    output: { acceptedClaimCount: input.claims.length, reviewRequiredClaimRefs: unique(reviewRequiredClaims) }
  });
}

export function evaluateG4(input: V5G4Input): V5GateResult {
  const openConflicts = input.conflicts.filter((item) => item.status === "open");
  const blockingConflicts = openConflicts.filter((item) => item.severity === "blocking");
  const unsafeTemporaryPolicy = openConflicts.filter((item) => !item.temporaryPolicy || !allowedTemporaryPolicies.has(item.temporaryPolicy));
  const blockingGaps = input.gaps.filter((item) => item.status === "open" && item.severity === "blocking");
  const highGaps = input.gaps.filter((item) => ["open", "in_progress"].includes(item.status) && item.severity === "high");

  if (unsafeTemporaryPolicy.length > 0) {
    return result("G4", "blocked", "block", {
      reasonCodes: [
        ...unsafeTemporaryPolicy.map((item) => `temporary_policy_missing:${item.conflictId}`)
      ],
      blockers: ["未决冲突没有采用文档允许的保守临时口径。"],
      nextActions: ["由对应业务、技术、安全、隐私或法务角色裁决；不得选择营销效果更强的口径。"],
      output: { unresolvedBlockingConflictCount: blockingConflicts.length, unresolvedBlockingGapCount: blockingGaps.length }
    });
  }

  const conditional = openConflicts.length > 0 || blockingGaps.length > 0 || highGaps.length > 0;
  return result("G4", conditional ? "conditional" : "passed", "advance", {
    reasonCodes: [
      ...openConflicts.map((item) => `conservative_conflict:${item.conflictId}`),
      ...blockingGaps.map((item) => `blocking_gap:${item.gapId}`),
      ...highGaps.map((item) => `high_gap:${item.gapId}`)
    ],
    warnings: conditional ? ["未决缺口或非阻断冲突必须精确限制对应表达，不得污染已充分取证的字段。"] : [],
    nextActions: conditional ? ["把缺口、临时口径、责任角色和受影响规则字段写入规则包草稿。"] : [],
    output: {
      unresolvedBlockingConflictCount: blockingConflicts.length,
      unresolvedBlockingGapCount: blockingGaps.length,
      evidenceGapIds: input.gaps.filter((item) => !["resolved", "superseded"].includes(item.status)).map((item) => item.gapId)
    }
  });
}

export function evaluateG5(input: V5G5Input): V5GateResult {
  const blockers: string[] = [];
  const reasonCodes: string[] = [];
  if (input.actorType !== "human") blockers.push("规则包只能由人工激活。"), reasonCodes.push("human_activation_required");
  if (!input.actorId) blockers.push("缺少激活人。"), reasonCodes.push("actor_missing");
  if (!input.rulePackageVersionId) blockers.push("缺少规则包版本 ID。"), reasonCodes.push("rule_package_version_missing");
  if (!input.productIdentityComplete) blockers.push("产品身份必填项不完整。"), reasonCodes.push("product_identity_incomplete");
  if (input.approvedClaimCount <= 0) blockers.push("没有已批准的 supported/conditional Claim。"), reasonCodes.push("approved_claim_missing");
  if (input.pendingRoles.length > 0) blockers.push(`仍有待确认角色：${input.pendingRoles.join(", ")}。`), reasonCodes.push("required_approvals_pending");
  if (input.approvals.some((item) => item.status !== "approved" || !["approve", "approve_with_conditions", "accept_conservative_wording"].includes(item.action))) {
    blockers.push("审批明细中仍有待处理、退回、拒绝或延后动作。"), reasonCodes.push("approval_records_incomplete");
  }
  if (input.unresolvedBlockingConflictCount > 0) blockers.push("存在未解决阻断冲突。"), reasonCodes.push("blocking_conflict_unresolved");
  if (input.unresolvedBlockingGapCount > 0) blockers.push("存在阻断规则包生效的证据缺口。"), reasonCodes.push("blocking_gap_unresolved");
  if (!input.sourceSnapshotHash || !/^[a-f0-9]{64}$/i.test(input.sourceSnapshotHash)) blockers.push("缺少固定来源快照 Hash。"), reasonCodes.push("source_snapshot_missing");

  if (blockers.length > 0) {
    return result("G5", input.actorType === "agent" ? "blocked" : "pending_input", "hold", {
      reasonCodes,
      blockers,
      nextActions: ["完成逐条高风险项审批、冲突裁决和证据快照后，由人工再次发起激活。"],
      output: { rulePackageStatus: input.rulePackageStatus }
    });
  }

  return result("G5", "passed", "activate", {
    output: { rulePackageStatus: "active", activatedBy: input.actorId || null, sourceSnapshotHash: input.sourceSnapshotHash || null }
  });
}

export function evaluateG6(input: V5G6Input): V5GateResult {
  const blockers: string[] = [];
  const reasonCodes: string[] = [];
  if (!input.productId) blockers.push("缺少稳定 productId。"), reasonCodes.push("product_id_missing");
  if (!input.rulePackageVersionId || input.rulePackageStatus !== "active") blockers.push("产品没有 active 规则包版本。"), reasonCodes.push("active_rule_package_required");
  if (!input.sourceSnapshotHash || !/^[a-f0-9]{64}$/i.test(input.sourceSnapshotHash)) blockers.push("缺少固定来源快照。"), reasonCodes.push("source_snapshot_missing");
  if (input.allowedContentTypes.length === 0) blockers.push("没有任何证据可支撑的内容类型。"), reasonCodes.push("allowed_content_type_missing");
  if (input.allowedChannels.length === 0) blockers.push("没有任何已确认渠道。"), reasonCodes.push("allowed_channel_missing");
  if (!Number.isInteger(input.maxMonthlyQuota) || (input.maxMonthlyQuota || 0) <= 0) blockers.push("月度配额上限必须为正整数。"), reasonCodes.push("monthly_quota_invalid");
  if (input.globalBlockingGapIds.length > 0) blockers.push("存在阻断整个产品月度生产的证据缺口。"), reasonCodes.push("global_blocking_gap");
  if (!input.evaluatorVersion) blockers.push("缺少准备度评估器版本。"), reasonCodes.push("evaluator_version_missing");

  if (blockers.length > 0) {
    return result("G6", "blocked", "block", {
      reasonCodes,
      blockers,
      nextActions: ["保持产品在月度生产池之外；补齐规则包、来源快照、可生产范围或证据后重新评估。"],
      output: {
        monthlyProductionReady: false,
        allowedContentTypes: [],
        allowedChannels: [],
        maxMonthlyQuota: null
      }
    });
  }

  const conditional = input.conditionalContentTypes.length > 0 || input.evidenceGapIds.length > 0;
  return result("G6", conditional ? "conditional" : "passed", "ready", {
    reasonCodes: conditional ? ["content_scope_limited_by_evidence"] : [],
    warnings: conditional ? ["月度准入仅覆盖明确允许的内容类型和渠道；条件型与阻断型内容不得被目标配额放大。"] : [],
    output: {
      monthlyProductionReady: true,
      allowedContentTypes: input.allowedContentTypes,
      conditionalContentTypes: input.conditionalContentTypes,
      blockedContentTypes: input.blockedContentTypes,
      allowedChannels: input.allowedChannels,
      requiredEvidenceRoles: input.requiredEvidenceRoles,
      evidenceGapIds: input.evidenceGapIds,
      maxMonthlyQuota: input.maxMonthlyQuota || null,
      sourceSnapshotHash: input.sourceSnapshotHash || null,
      evaluatorVersion: input.evaluatorVersion || null
    }
  });
}

export function evaluateV5GovernanceGate(gate: V5GateCode, input: unknown): V5GateResult {
  switch (gate) {
    case "G0": return evaluateG0(input as V5G0Input);
    case "G1": return evaluateG1(input as V5G1Input);
    case "G2": return evaluateG2(input as V5G2Input);
    case "G3": return evaluateG3(input as V5G3Input);
    case "G4": return evaluateG4(input as V5G4Input);
    case "G5": return evaluateG5(input as V5G5Input);
    case "G6": return evaluateG6(input as V5G6Input);
  }
}

export function evaluateV5GovernanceWorkflow(input: V5GovernanceWorkflowInput): V5GovernanceWorkflowResult {
  const results: V5GateResult[] = [];
  const completedGates: V5GateCode[] = [];

  for (const gate of gateOrder) {
    const gateInput = input[gate];
    if (!gateInput) {
      return {
        ok: false,
        status: "awaiting_input",
        currentGate: gate,
        completedGates,
        results,
        monthlyProductionReady: false,
        nextActions: [`补充 ${gate} 输入后继续。`]
      };
    }

    const gateResult = evaluateV5GovernanceGate(gate, gateInput);
    results.push(gateResult);
    if (!gateResult.ok) {
      return {
        ok: false,
        status: gateResult.status === "pending_input" ? "awaiting_input" : "blocked",
        currentGate: gate,
        completedGates,
        results,
        monthlyProductionReady: false,
        nextActions: gateResult.nextActions
      };
    }
    completedGates.push(gate);
  }

  const readiness = results.at(-1)?.output.monthlyProductionReady === true;
  return {
    ok: readiness,
    status: readiness ? "completed" : "blocked",
    currentGate: "G6",
    completedGates,
    results,
    monthlyProductionReady: readiness,
    nextActions: unique(results.flatMap((item) => item.nextActions))
  };
}
