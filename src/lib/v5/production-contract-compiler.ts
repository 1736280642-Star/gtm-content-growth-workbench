import {
  hashProductionValue,
  ProductionDomainError,
  type ChannelRuleSnapshot,
  type ContentTaskSnapshot,
  type ContentTypeRuleSnapshot,
  type ExpressionRuleSnapshot,
  type FinalEvidencePackSnapshot,
  type ProductRuleSnapshot,
  type ProductionArtifact,
  type ProductionContractSnapshot,
  type PromotionProfileVersion,
  uniqueSorted
} from "./content-production-contracts";
import { resolvePromotionPlan } from "./promotion-resolver";

export interface CompileProductionContractInput {
  task: ContentTaskSnapshot;
  evidencePack: FinalEvidencePackSnapshot;
  productRule: ProductRuleSnapshot;
  contentTypeRule: ContentTypeRuleSnapshot;
  channelRule: ChannelRuleSnapshot;
  expressionRule: ExpressionRuleSnapshot;
  promotionProfiles: PromotionProfileVersion[];
  minTraceableFactCount?: number;
  requireHumanBoundary?: boolean;
  compiledAt?: string;
}

function assertTask(input: CompileProductionContractInput) {
  const { task, contentTypeRule, channelRule } = input;
  const missing = [
    ["taskId", task.taskId],
    ["title", task.title],
    ["channel", task.channel],
    ["contentType", task.contentType],
    ["targetAudience", task.targetAudience],
    ["coreProblem", task.coreProblem],
    ["coreJudgment", task.coreJudgment]
  ].filter(([, value]) => !String(value || "").trim()).map(([field]) => field);
  if (missing.length || task.taskVersion < 1 || !task.targetEntityIds.length) {
    throw new ProductionDomainError("invalid_task", "内容任务缺少正式生成所需的冻结字段。", missing);
  }
  if (channelRule.channel !== task.channel) {
    throw new ProductionDomainError("rule_conflict", "任务渠道与渠道规则版本不一致。", [task.channel, channelRule.channel]);
  }
  if (contentTypeRule.ctaIntent !== task.ctaIntent) {
    throw new ProductionDomainError("rule_conflict", "任务 CTA 意图与内容类型快照不一致。", [task.ctaIntent, contentTypeRule.ctaIntent]);
  }
}

function assertEvidence(input: CompileProductionContractInput) {
  const { evidencePack, productRule, contentTypeRule } = input;
  if (!(evidencePack.decision === "generatable" || evidencePack.decision === "generatable_with_downgrade")) {
    throw new ProductionDomainError("evidence_not_generatable", `EvidencePack 决策为 ${evidencePack.decision}。`, [
      ...evidencePack.gaps,
      ...evidencePack.conflicts,
      ...evidencePack.outdatedEvidence,
      ...evidencePack.unverifiedClaims
    ]);
  }
  if (!evidencePack.evidenceItems.length) {
    throw new ProductionDomainError("evidence_missing", "EvidencePack 没有可用于正文的证据。", [evidencePack.evidencePackId]);
  }
  const unsafeItems = evidencePack.evidenceItems.filter((item) => item.status !== "active" || item.lifecycleStatus !== "current" || item.visibility !== "public");
  if (unsafeItems.length) {
    throw new ProductionDomainError("evidence_not_generatable", "EvidencePack 包含未激活、非当前或非公开证据。", unsafeItems.map((item) => item.evidenceItemId));
  }
  if (productRule.sourceSnapshotHash !== evidencePack.sourceSnapshotHash) {
    throw new ProductionDomainError("rule_conflict", "产品规则包与 EvidencePack 不属于同一来源快照。", [productRule.sourceSnapshotHash, evidencePack.sourceSnapshotHash]);
  }
  const requiredRoles = uniqueSorted([...productRule.requiredEvidenceRoles, ...contentTypeRule.requiredEvidenceRoles]);
  const availableRoles = new Set(evidencePack.evidenceItems.flatMap((item) => item.allowedUsage));
  const missingRoles = requiredRoles.filter((role) => !availableRoles.has(role));
  if (missingRoles.length) {
    throw new ProductionDomainError("evidence_missing", "EvidencePack 缺少内容类型或产品规则要求的证据角色。", missingRoles);
  }
}

function uniqueArtifacts(values: ProductionArtifact[]) {
  return uniqueSorted(values) as ProductionArtifact[];
}

export function compileProductionContract(input: CompileProductionContractInput): ProductionContractSnapshot {
  assertTask(input);
  assertEvidence(input);

  const minLength = Math.max(input.contentTypeRule.minLength, input.channelRule.minLength || 0);
  const maxLength = Math.min(input.contentTypeRule.maxLength, input.channelRule.maxLength || Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 1 || maxLength < minLength) {
    throw new ProductionDomainError("rule_conflict", "内容类型和渠道规则没有可执行的篇幅交集。", [`${minLength}-${maxLength}`]);
  }

  const approvedClaimIds = uniqueSorted(input.evidencePack.evidenceItems.flatMap((item) => item.claimIds));
  const compiledAt = input.compiledAt || new Date().toISOString();
  const ctaPlan = resolvePromotionPlan({
    task: input.task,
    channelRule: input.channelRule,
    profiles: input.promotionProfiles,
    approvedClaimIds,
    now: compiledAt
  });
  const requiredSections = uniqueSorted([...input.contentTypeRule.requiredSections, ...input.channelRule.requiredSections]);
  const requiredArtifacts = uniqueArtifacts([...input.contentTypeRule.requiredArtifacts, ...input.channelRule.requiredArtifacts]);
  const prohibitedTerms = uniqueSorted([
    ...input.productRule.blockedExpressions,
    ...input.channelRule.prohibitedTerms,
    ...input.expressionRule.prohibitedTerms
  ]);
  const allowedUrls = uniqueSorted([
    ...input.evidencePack.evidenceItems.flatMap((item) => item.canonicalUrl ? [item.canonicalUrl] : []),
    ...ctaPlan.selectedVariants.map((item) => item.publicUrl)
  ]);
  const conditionalExpressions = uniqueSorted([
    ...input.productRule.conditionalExpressions,
    ...input.evidencePack.evidenceItems.flatMap((item) => [...item.conditions, ...item.limitations])
  ]);
  const promptDirectives = uniqueSorted([
    ...input.contentTypeRule.promptDirectives,
    ...input.channelRule.promptDirectives,
    ...input.expressionRule.humanizerDirectives,
    "只使用冻结 EvidencePack 中的事实，不补充常识、猜测或外部资料。",
    "在内部完成起草、自检和改写，只输出最终结构化结果。",
    ...(input.evidencePack.decision === "generatable_with_downgrade"
      ? ["所有条件和限制必须进入正文，不得改写为无条件能力。"]
      : [])
  ]);
  const withoutHash = {
    contractVersion: "content-production.v1" as const,
    task: input.task,
    evidencePack: input.evidencePack,
    productRule: input.productRule,
    contentTypeRule: input.contentTypeRule,
    channelRule: input.channelRule,
    expressionRule: input.expressionRule,
    ctaPlan,
    validatorPolicy: {
      minTraceableFactCount: input.minTraceableFactCount ?? 8,
      requireHumanBoundary: input.requireHumanBoundary ?? true,
      allowedUrls,
      prohibitedTerms,
      requiredSections,
      requiredArtifacts,
      minLength,
      maxLength,
      maxCtaCount: input.channelRule.maxCtaCount,
      requireCtaAtEnd: input.channelRule.requireCtaAtEnd,
      crossChannelSimilarityThreshold: input.channelRule.crossChannelSimilarityThreshold
    },
    allowedExpressions: uniqueSorted(input.productRule.allowedExpressions),
    conditionalExpressions,
    promptDirectives,
    compiledAt
  };
  const hashInput = { ...withoutHash, compiledAt: undefined };
  return { ...withoutHash, contractHash: hashProductionValue(hashInput) };
}
