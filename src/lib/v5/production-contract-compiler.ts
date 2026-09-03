import {
  hashProductionValue,
  ProductionDomainError,
  type ChannelRuleSnapshot,
  type ContentTaskSnapshot,
  type ContentTypeRuleSnapshot,
  type ExpressionRuleSnapshot,
  type FinalEvidencePackSnapshot,
  type ProductionEntityIdentitySnapshot,
  type ArticleArgumentPlan,
  type ArticleArgumentRole,
  type ProductRuleSnapshot,
  type ProductionArtifact,
  type ProductionContractSnapshot,
  type PromotionSubjectPlan,
  type PromotionProfileVersion,
  type RequiredFixedExpression,
  uniqueSorted
} from "./content-production-contracts";
import { resolvePromotionPlan } from "./promotion-resolver";
import { humanWritingWechatPromptDirectives } from "./human-writing-wechat";
import { assertGeoArticleMission, type GeoArticleMissionContract } from "./geo-article-mission-contracts";
import { derivePromotionSubjectPlan, promotionCapabilityLabels } from "./promotion-subject-policy";
import { deriveGovernedFaqPlan } from "./faq-governance-policy";

export interface CompileProductionContractInput {
  geoMission: GeoArticleMissionContract;
  task: ContentTaskSnapshot;
  evidencePack: FinalEvidencePackSnapshot;
  productRule: ProductRuleSnapshot;
  contentTypeRule: ContentTypeRuleSnapshot;
  channelRule: ChannelRuleSnapshot;
  expressionRule: ExpressionRuleSnapshot;
  governance: ProductionContractSnapshot["governance"];
  promotionProfiles: PromotionProfileVersion[];
  requiredCoreClaimIds: string[];
  promotionSubjectPlan?: PromotionSubjectPlan;
  entityIdentity: ProductionEntityIdentitySnapshot;
  fixedExpressions?: RequiredFixedExpression[];
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
  try { assertGeoArticleMission(input.geoMission); } catch (error) {
    throw new ProductionDomainError("invalid_task", "GEO 文章任务合同不完整或已经失效。", [error instanceof Error ? error.message : String(error)]);
  }
  if (input.geoMission.productId !== input.governance.productId
    || input.geoMission.primaryEntityId !== task.primaryEntityId
    || input.geoMission.geoIntentHash !== input.governance.geoIntentHash
    || input.geoMission.entityGraph.graphHash !== input.governance.entityGraphHash) {
    throw new ProductionDomainError("rule_conflict", "GEO 任务、产品实体图与生产合同不属于同一冻结版本。", [input.geoMission.missionId]);
  }
  if (input.geoMission.narrativeSubjectRole === "service_provider"
    && !task.title.toLocaleLowerCase().includes(input.geoMission.narrativeSubjectName.toLocaleLowerCase())) {
    throw new ProductionDomainError(
      "invalid_task",
      "服务商是GEO叙事主体时，冻结标题必须自然包含该主体。",
      [input.geoMission.narrativeSubjectName, task.title]
    );
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
  const forbiddenEvidence = evidencePack.evidenceItems.filter((item) => {
    const usage = item.evidenceUsage || "product_fact";
    return !input.geoMission.allowedEvidenceUsages.includes(usage)
      || (usage === "product_fact" && item.subjectEntityIds?.length && !item.subjectEntityIds.includes(input.geoMission.primaryEntityId));
  });
  if (forbiddenEvidence.length) {
    throw new ProductionDomainError("evidence_not_generatable", "EvidencePack 包含不属于目标产品事实用途的资料。", forbiddenEvidence.map((item) => item.evidenceItemId));
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
  const promotionSubjectPlan = input.promotionSubjectPlan || derivePromotionSubjectPlan({ mission: input.geoMission, evidencePack });
  const requiredClaimIds = uniqueSorted([
    ...input.requiredCoreClaimIds,
    ...promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.claimId)
  ]);
  const approvedClaimIds = new Set(evidencePack.evidenceItems.flatMap((item) => item.claimIds));
  const missingCoreClaims = requiredClaimIds.filter((claimId) => !approvedClaimIds.has(claimId));
  if (!input.requiredCoreClaimIds.length || missingCoreClaims.length) {
    throw new ProductionDomainError(
      "evidence_missing",
      "当前选题没有形成可执行的核心 Claim 计划。",
      missingCoreClaims.length ? missingCoreClaims : [evidencePack.evidencePackId]
    );
  }
  if (promotionSubjectPlan.enabled) {
    const capabilityClaims = new Set(promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.claimId));
    const capabilityCategories = new Set(promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.category));
    if (!promotionSubjectPlan.identityClaimIds.length) {
      throw new ProductionDomainError("evidence_missing", "EvidencePack 缺少推广主体的身份 Claim。", [promotionSubjectPlan.narrativeSubjectName]);
    }
    if (capabilityClaims.size < promotionSubjectPlan.minimumServiceCapabilityClaims
      || capabilityCategories.size < promotionSubjectPlan.minimumServiceCapabilityCategories) {
      throw new ProductionDomainError(
        "evidence_missing",
        "EvidencePack 缺少至少两类、两条可追溯的推广主体交付能力 Claim。",
        [promotionSubjectPlan.narrativeSubjectName, ...promotionCapabilityLabels([...capabilityCategories])]
      );
    }
  }
  const faqPlan = deriveGovernedFaqPlan({
    mission: input.geoMission,
    evidencePack,
    preferredClaimIds: requiredClaimIds
  });
  if (faqPlan.required && !faqPlan.evidenceCandidates.length) {
    throw new ProductionDomainError(
      "evidence_missing",
      "GEO 正式文章必须包含有知识库答案支撑的 FAQ，当前 EvidencePack 没有可用 FAQ Claim。",
      ["faq_evidence_missing", evidencePack.evidencePackId]
    );
  }
}

function uniqueArtifacts(values: ProductionArtifact[]) {
  return uniqueSorted(values) as ProductionArtifact[];
}

function compileArgumentPlan(input: CompileProductionContractInput): ArticleArgumentPlan {
  const mission = input.geoMission;
  const promotionSubjectPlan = input.promotionSubjectPlan || derivePromotionSubjectPlan({ mission, evidencePack: input.evidencePack });
  const claims = uniqueSorted([
    ...input.requiredCoreClaimIds,
    ...promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.claimId)
  ]);
  const dimensions = mission.titlePromiseDimensions.length
    ? mission.titlePromiseDimensions
    : [mission.articleRole];
  const customOrder = (input.contentTypeRule.argumentOrder || []).filter(Boolean).slice(0, 5);
  const sectionClaims = customOrder.length >= 3
    ? customOrder
    : [
        `先直接回答：${mission.primaryQuestion}`,
        `解释判断成立的标准与原因：${dimensions.join("、")}`,
        promotionSubjectPlan.enabled
          ? `用已治理事实说明${promotionSubjectPlan.narrativeSubjectName}如何把平台能力转成实施交付动作，不罗列无关能力`
          : "用已治理的产品事实证明上述判断，不罗列无关能力",
        "说明适用边界，并把前文结论转成读者的决策依据"
      ];
  const roles: ArticleArgumentRole[] = ["answer", "criterion", "mechanism", "evidence", "decision"];
  const sections = sectionClaims.map((claim, index) => {
    const role = customOrder.length >= 3
      ? roles[Math.min(index, roles.length - 1)]
      : (["answer", "criterion", "evidence", "decision"] as ArticleArgumentRole[])[index];
    const evidenceClaimIds = role === "evidence" || role === "mechanism" ? claims : [];
    const baseSectionClaim = index === 0 ? mission.desiredAnswer : claim;
    const sectionClaim = promotionSubjectPlan.enabled
      ? `${baseSectionClaim}；本节还必须说明 ${promotionSubjectPlan.narrativeSubjectName} 基于已批准 Claim 执行的具体服务动作，以及该动作如何影响企业的核对、选择或采用判断`
      : baseSectionClaim;
    return {
      sectionId: `argument-${index + 1}`,
      role,
      sectionQuestion: index === 0 ? mission.primaryQuestion : claim,
      sectionClaim,
      because: role === "evidence"
        ? "只有与判断直接相关且可追溯的事实，才能支撑前文结论"
        : role === "decision"
          ? "前文的判断、机制与证据需要共同导向采用边界和下一步选择"
          : `本节必须解释它与中心判断“${mission.desiredAnswer}”之间的因果关系`,
      evidenceClaimIds,
      decisionImplication: promotionSubjectPlan.enabled
        ? `明确说明 ${promotionSubjectPlan.narrativeSubjectName} 的上述动作如何改变企业的核对、选择或采用判断`
        : role === "decision" ? "给出可执行的核对项或行动依据" : "说明本节信息如何改变读者判断",
      ...(index < sectionClaims.length - 1 ? { transitionToNext: `本节结论必须自然引出：${sectionClaims[index + 1]}` } : {})
    };
  });
  return {
    planVersion: "article-argument-plan.v1",
    centralJudgment: mission.desiredAnswer,
    causalChain: sections.map((item) => item.sectionClaim),
    sections,
    ...(promotionSubjectPlan.enabled ? {
      promotionSubjectSectionRequirement: {
        requiredInEveryCoreSection: true as const,
        literalSubjectNameRequired: true as const,
        narrativeSubjectName: promotionSubjectPlan.narrativeSubjectName,
        eligibleActionClaimIds: promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.claimId),
        eligibleActionCategories: Array.from(new Set(
          promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.category)
        )).sort(),
        decisionImplicationRequired: true as const
      }
    } : {})
  };
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
  const promotionSubjectPlan = input.promotionSubjectPlan || derivePromotionSubjectPlan({ mission: input.geoMission, evidencePack: input.evidencePack });
  const requiredCoreClaimIds = uniqueSorted([
    ...input.requiredCoreClaimIds,
    ...promotionSubjectPlan.serviceCapabilityClaims.map((item) => item.claimId)
  ]);
  const faqPlan = deriveGovernedFaqPlan({
    mission: input.geoMission,
    evidencePack: input.evidencePack,
    preferredClaimIds: requiredCoreClaimIds
  });
  const ctaPlan = resolvePromotionPlan({
    task: input.task,
    channelRule: input.channelRule,
    profiles: input.promotionProfiles,
    approvedClaimIds,
    now: compiledAt
  });
  const requiredSections = uniqueSorted([
    ...input.contentTypeRule.requiredSections,
    ...input.channelRule.requiredSections,
    ...(faqPlan.required ? [faqPlan.heading] : [])
  ]);
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
  const contentTypePromptDirectives = input.contentTypeRule.promptDirectives.filter((directive) =>
    !promotionSubjectPlan.enabled || !/(?:品牌|主体|JOTO).{0,12}(?:露出|提及).{0,12}(?:克制|减少|降低)/i.test(directive)
  );
  const promptDirectives = uniqueSorted([
    ...contentTypePromptDirectives,
    ...input.channelRule.promptDirectives,
    ...input.expressionRule.humanizerDirectives,
    ...(input.expressionRule.calibrationDirectives || []),
    ...humanWritingWechatPromptDirectives(input.task.channel),
    "只使用冻结 EvidencePack 中的事实，不补充常识、猜测或外部资料。",
    "在内部完成起草、自检和改写，只输出最终结构化结果。",
    "GEO 正式文章必须包含常见问题章节；问题可以模拟真实用户问法，但答案只能使用 FAQ 计划绑定的知识库 Claim。",
    "避免模板化开场、机械三段式、连续同句式、模糊归因、口号式总结和过度使用连接词。",
    ...(promotionSubjectPlan.enabled ? [
      `${promotionSubjectPlan.narrativeSubjectName}是全文推广与叙事主体；平台产品只作为搜索入口、能力底座和事实归属对象。`,
      `每个核心章节都必须说明${promotionSubjectPlan.narrativeSubjectName}基于平台能力执行了什么，以及该动作如何影响企业判断。`,
      `正文至少覆盖${promotionSubjectPlan.minimumServiceCapabilityCategories}类有 Claim 支撑的交付能力，不能只在固定身份文案或 CTA 中提到推广主体。`,
      `“品牌露出克制”只表示不要机械重复${promotionSubjectPlan.narrativeSubjectName}，不得削弱其作为全文陈述主体的地位。`
    ] : []),
    ...(input.evidencePack.decision === "generatable_with_downgrade"
      ? ["所有条件和限制必须进入正文，不得改写为无条件能力。"]
      : [])
  ]);
  const withoutHash = {
    contractVersion: "content-production.v2" as const,
    governance: input.governance,
    geoMission: input.geoMission,
    promotionSubjectPlan,
    faqPlan,
    argumentPlan: compileArgumentPlan(input),
    task: input.task,
    evidencePack: input.evidencePack,
    productRule: input.productRule,
    contentTypeRule: input.contentTypeRule,
    channelRule: input.channelRule,
    expressionRule: input.expressionRule,
    ctaPlan,
    fixedExpressions: input.fixedExpressions || [],
    validatorPolicy: {
      requiredCoreClaimIds,
      entityIdentity: input.entityIdentity,
      allowedUrls,
      prohibitedTerms,
      requiredSections,
      requiredArtifacts,
      minLength,
      maxLength,
      maxCtaCount: input.channelRule.maxCtaCount,
      requireCtaAtEnd: input.channelRule.requireCtaAtEnd,
      crossChannelSimilarityThreshold: input.channelRule.crossChannelSimilarityThreshold,
      promotionSubjectPlan,
      faqPlan
    },
    allowedExpressions: uniqueSorted(input.productRule.allowedExpressions),
    conditionalExpressions,
    promptDirectives,
    compiledAt
  };
  const hashInput = { ...withoutHash, compiledAt: undefined };
  return { ...withoutHash, contractHash: hashProductionValue(hashInput) };
}
