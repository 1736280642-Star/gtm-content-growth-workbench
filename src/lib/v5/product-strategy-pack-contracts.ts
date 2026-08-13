import { createHash } from "node:crypto";
import type { GeoBlueprintVersion, GeoResearchProject } from "./geo-research-contracts";
import type { ProductKnowledgeProfile } from "./product-knowledge-profile";

export const productGeoStrategyContractVersion = "product-geo-strategy.v2" as const;

export type ProductGeoStrategyPackStatus =
  | "draft"
  | "pending_strategy_review"
  | "strategy_approved"
  | "pending_sample_review"
  | "production_ready"
  | "rejected"
  | "superseded"
  | "active";

export type ProductGeoStrategyDecision = "approve" | "reject";

export type FixedExpressionPosition = "opening" | "body" | "ending";

export interface ProductFixedExpressionRule {
  text: string;
  positions: FixedExpressionPosition[];
  channels: string[];
}

export interface ProductGeoStrategyOpportunity {
  opportunityId: string;
  title: string;
  intent: string;
  priority: "high" | "medium" | "low";
  productFit: string;
  evidenceReadiness: "ready" | "partial" | "blocked";
  representativeQuestions: string[];
  sourceIds: string[];
  raw: Record<string, unknown>;
}

export interface ProductGeoArticleTypePortfolioItem {
  portfolioItemId: string;
  origin: "matched" | "adapted" | "generated" | "research_recommended";
  articleTypeId?: string;
  articleTypeVersionId?: string;
  name: string;
  definition: string;
  suitableQuestions: string[];
  unsuitableQuestions: string[];
  targetAudience: string[];
  contentGoal: string;
  structureModules: Array<{ key: string; purpose: string; required: boolean }>;
  emphasisOrder: string[];
  style: string[];
  lengthRange: { min: number; max: number };
  evidencePreferences: string[];
  ctaIntent: string;
  channelFit: string[];
  questionClusterIds: string[];
  recommendationReason: string;
  confidence: number;
  evidenceReadiness: "ready" | "partial" | "blocked";
  proposedMonthlyShare: number;
  baseArticleTypeId?: string;
  baseArticleTypeVersionId?: string;
  definitionHash: string;
  raw: Record<string, unknown>;
}

export interface ProductGeoStrategyContentPlanV2 {
  contractVersion: typeof productGeoStrategyContractVersion;
  sourceSnapshotId: string;
  researchEvidencePackId: string;
  researchSnapshotHash: string;
  productPositioning: {
    positioning: string[];
    promotionPurpose: string;
    expressionFocus: string;
    targetAudience: string[];
    jobs: string[];
    differentiators: string[];
    applicableScenarios: string[];
    excludedScenarios: string[];
    prohibitedClaims: string[];
    targetMarkets: string[];
    languages: string[];
  };
  fixedExpression?: ProductFixedExpressionRule;
  geoOpportunities: ProductGeoStrategyOpportunity[];
  articleTypePortfolio: ProductGeoArticleTypePortfolioItem[];
  evidencePolicy: {
    requiredRoles: string[];
    conflictSummaries: string[];
    knowledgeGaps: string[];
    citationStrategy: Record<string, unknown>;
    evidenceRequirements: Record<string, unknown>;
  };
  expressionDirection: {
    keyMessages: string[];
    emphasisOrder: string[];
    prohibitedPatterns: string[];
    tone: string[];
  };
  channelPriorities: Array<{ channel: string; role: string; suitableArticleTypeIds: string[] }>;
  recommendedMonthlyMix: Array<{ articleTypeId: string; questionClusterIds: string[]; targetShare: number }>;
  retestBaseline: Record<string, unknown>;
  synthesis: {
    model: string;
    blueprintVersionId: string;
    blueprintVersionNumber: number;
    runId: string;
    promptVersion: string;
  };
  researchSynthesis: {
    questionStrategy: Record<string, unknown>;
    competitorLandscape: Record<string, unknown>;
    contentTypeStrategy: Record<string, unknown>;
  };
}

export interface ProductGeoStrategyPackRecord {
  id: string;
  productId: string;
  strategyVersion: number;
  geoBlueprintId?: string;
  sourceSnapshotId?: string;
  contractVersion: string;
  ruleVersion: string;
  status: ProductGeoStrategyPackStatus;
  contentPlan: ProductGeoStrategyContentPlanV2 | Record<string, unknown> | null;
  contentPlanHash?: string;
  rowVersion: number;
  strategyApprovedAt?: string;
  strategyApprovedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  decisionReason?: string;
  decisionIdempotencyKey?: string;
  decisionPayloadHash?: string;
  compiledAt: string;
  updatedAt: string;
}

export interface ProductStrategyArticleTypeVersionRecord {
  id: string;
  strategyPackId: string;
  productId: string;
  portfolioItemId: string;
  origin: "matched" | "adapted" | "generated";
  articleTypeId?: string;
  articleTypeVersionId: string;
  baseArticleTypeId?: string;
  baseArticleTypeVersionId?: string;
  name: string;
  definition: ProductGeoArticleTypePortfolioItem;
  definitionHash: string;
  status: "draft" | "evidence_pending" | "frozen" | "active" | "rejected" | "superseded";
  activatedAt?: string;
  activatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

const humanStrategyRoles = new Set([
  "product_owner",
  "content_growth",
  "knowledge_manager",
  "workbench_operator",
  "developer_admin"
]);

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function subjectText(value: string, productName?: string) {
  if (!productName?.trim() || !value) return value;
  const escaped = productName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`${escaped}\\s*[x×]\\s*[A-Za-z0-9._-]+`, "gi"), productName.trim());
}

function serviceProviderFromRelationship(value?: string) {
  if (!value) return "";
  return value.match(/([A-Za-z][A-Za-z0-9._-]{1,30})\s*(?:提供|支持|负责)/)?.[1] || "";
}

function serviceAwareQuestion(value: string, productName: string | undefined, provider: string) {
  if (!productName || !provider) return value;
  if (value.includes(`${productName}如何与企业现有系统集成`)) return `${provider} 如何帮助 ${productName} 接入企业现有系统？`;
  if (value.includes(`实施${productName}需要哪些技术准备`)) return `企业实施 ${productName} 前需要哪些技术准备，${provider} 可以提供哪些落地支持？`;
  if (value.includes(`${productName}的技术支持与售后服务质量如何`)) return `${provider} 为 ${productName} 提供哪些专项服务与持续运营支持？`;
  if (value.includes(`${productName}的实施过程中常见问题`)) return `由 ${provider} 支持 ${productName} 落地时，常见问题和双方分工是什么？`;
  return value;
}

function serviceAwareArticleType(item: ProductGeoArticleTypePortfolioItem, productName: string | undefined, provider: string) {
  if (!productName || !provider || item.origin === "matched") return item;
  if (item.name === "实施指南") {
    return { ...item, name: `${provider} ${productName} 专项落地指南`, definition: `说明 ${provider} 如何支持企业完成 ${productName} 的前置评估、接入实施、验收与持续运营。` };
  }
  if (item.name.includes(`${productName}行业解决方案`)) {
    return { ...item, name: `${provider} ${productName} 场景落地方案`, definition: `围绕企业业务场景说明 ${productName} 的产品能力、适用条件，以及 ${provider} 提供的专项落地支持。` };
  }
  if (item.name.includes(`${productName}实施案例集`)) {
    return { ...item, name: `${provider} ${productName} 落地案例`, definition: `仅基于已核验案例，说明 ${productName} 的产品应用与 ${provider} 的实施服务分别承担什么。` };
  }
  return item;
}

function recordCandidates(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.map((item) => typeof item === "string" ? { title: item } : recordValue(item)).filter((item) => Object.keys(item).length);
    }
  }
  return [];
}

function normalizedPriority(value: unknown): ProductGeoStrategyOpportunity["priority"] | undefined {
  const priority = stringValue(value).toLowerCase();
  return priority === "high" || priority === "medium" || priority === "low" ? priority : undefined;
}

function normalizedEvidenceReadiness(value: unknown): "ready" | "partial" | "blocked" | undefined {
  const readiness = stringValue(value).toLowerCase();
  return readiness === "ready" || readiness === "partial" || readiness === "blocked" ? readiness : undefined;
}

function normalizedOrigin(value: unknown, item: Record<string, unknown>): ProductGeoArticleTypePortfolioItem["origin"] {
  const origin = stringValue(value);
  if (["matched", "adapted", "generated"].includes(origin)) return origin as ProductGeoArticleTypePortfolioItem["origin"];
  if (stringValue(item.articleTypeVersionId)) return "matched";
  if (stringValue(item.baseArticleTypeVersionId)) return "adapted";
  return "generated";
}

function normalizedStructureModules(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ key: entry.trim(), purpose: entry.trim(), required: true }];
    }
    const record = recordValue(entry);
    const key = stringValue(record.key) || stringValue(record.name) || `module-${index + 1}`;
    if (!key) return [];
    return [{ key, purpose: stringValue(record.purpose) || key, required: record.required !== false }];
  }).slice(0, 12);
}

function normalizedLengthRange(value: unknown) {
  const record = recordValue(value);
  const min = Number(record.min || 1200);
  const max = Number(record.max || 2400);
  return {
    min: Number.isFinite(min) ? Math.min(10000, Math.max(300, Math.floor(min))) : 1200,
    max: Number.isFinite(max) ? Math.min(10000, Math.max(300, Math.floor(max))) : 2400
  };
}

const opportunityAffinityGroups = [
  { cluster: ["竞品", "对比", "比较", "优势", "差异"], question: ["相比", "对比", "区别", "优势", "差异", "竞争"] },
  { cluster: ["选型", "采购", "决策", "依据"], question: ["评估", "适合", "定价", "价格", "采购", "选择", "售后", "支持"] },
  { cluster: ["功能", "价值", "能力", "场景", "特点"], question: ["解决", "功能", "能力", "场景", "行业", "集成"] },
  { cluster: ["实施", "部署", "集成", "架构", "技术"], question: ["实施", "部署", "集成", "技术", "架构", "常见问题"] }
];

function opportunityQuestionScore(title: string, question: string) {
  return opportunityAffinityGroups.reduce((score, group) => {
    if (!group.cluster.some((keyword) => title.includes(keyword))) return score;
    return score + group.question.filter((keyword) => question.includes(keyword)).length;
  }, 0);
}

function normalizeOpportunities(questionStrategy: Record<string, unknown>) {
  const recommendedQuestions = stringArray(questionStrategy.recommendedQuestions);
  const candidates = recordCandidates(questionStrategy, ["questionClusters", "priorityClusters", "opportunities", "questions", "questionStrategy"]);
  const fallbackAssignments = candidates.map(() => [] as string[]);
  for (const question of recommendedQuestions) {
    const scored = candidates.map((item, index) => ({
      index,
      score: opportunityQuestionScore(
        stringValue(item.title) || stringValue(item.question) || stringValue(item.name),
        question
      ),
      assigned: fallbackAssignments[index].length
    })).sort((left, right) => right.score - left.score || left.assigned - right.assigned || left.index - right.index);
    if (scored[0]) fallbackAssignments[scored[0].index].push(question);
  }
  return candidates
    .map((item, index): ProductGeoStrategyOpportunity => ({
      opportunityId: stringValue(item.questionClusterId) || stringValue(item.id) || `research-opportunity-${index + 1}`,
      title: stringValue(item.title) || stringValue(item.question) || stringValue(item.name) || `问题机会 ${index + 1}`,
      intent: stringValue(item.intent) || "product_research",
      priority: normalizedPriority(item.priority) || (index === 0 ? "high" : "medium"),
      productFit: stringValue(item.productFit) || stringValue(item.fit) || "需结合正式产品事实判断适配范围",
      evidenceReadiness: normalizedEvidenceReadiness(item.evidenceReadiness) || "partial",
      representativeQuestions: stringArray(item.representativeQuestions).length
        ? stringArray(item.representativeQuestions)
        : (stringArray(item.questions).length ? stringArray(item.questions) : fallbackAssignments[index]),
      sourceIds: stringArray(item.sourceIds),
      raw: item
    }));
}

function sanitizeEvidenceRequirements(evidence: Record<string, unknown>) {
  const claimsRequiringEvidence = stringArray(evidence.claimsRequiringEvidence).length
    ? stringArray(evidence.claimsRequiringEvidence)
    : stringArray(evidence.requiredClaims);
  const { requiredClaims: _requiredClaims, ...rest } = evidence;
  return {
    ...rest,
    blockedClaims: [...new Set([...stringArray(evidence.blockedClaims), ...claimsRequiringEvidence])],
    claimsRequiringEvidence
  };
}

function sanitizeCompetitorLandscape(landscape: Record<string, unknown>) {
  const competitors = Array.isArray(landscape.competitors)
    ? landscape.competitors.map(recordValue).filter((item) => {
      const reason = stringValue(item.reason);
      return !/(?:名称相似|可能|疑似|推测|或许|name\s+similar|possibly)/i.test(reason);
    })
    : [];
  return { ...landscape, competitors };
}

function governedCitationStrategy(strategy: Record<string, unknown>) {
  return {
    productClaimPolicy: "产品能力、价格、客户案例和技术架构只使用知识库中通过治理的 A1/A2 来源",
    comparativeClaimPolicy: "竞品差异必须同时具备目标产品正式资料与竞品可追溯资料；社区或转载内容只能作为问题信号",
    ...strategy
  };
}

function normalizeArticleTypePortfolio(contentTypeStrategy: Record<string, unknown>) {
  const candidates = recordCandidates(contentTypeStrategy, ["articleTypes", "recommendations", "contentTypes", "types"]);
  const seen = new Set<string>();
  const portfolio = candidates.flatMap((item, index): ProductGeoArticleTypePortfolioItem[] => {
    const name = stringValue(item.name) || stringValue(item.title) || stringValue(item.type) || `文章类型 ${index + 1}`;
    const definition = stringValue(item.definition) || stringValue(item.description) || stringValue(item.semanticDescription);
    const semanticKey = `${name}:${definition}`.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    if (seen.has(semanticKey)) return [];
    seen.add(semanticKey);
    const definitionHash = createHash("sha256").update(JSON.stringify(item)).digest("hex");
    const origin = normalizedOrigin(item.origin, item);
    const articleTypeId = stringValue(item.articleTypeId) || (origin === "generated" ? `product-article-type-${definitionHash.slice(0, 24)}` : undefined);
    const articleTypeVersionId = stringValue(item.articleTypeVersionId) || `strategy-article-type-version-${definitionHash.slice(0, 32)}`;
    const lengthRange = normalizedLengthRange(item.lengthRange);
    if (lengthRange.max < lengthRange.min) lengthRange.max = lengthRange.min;
    return [{
      portfolioItemId: stringValue(item.portfolioItemId) || stringValue(item.id) || `research-article-type-${index + 1}`,
      origin,
      articleTypeId,
      articleTypeVersionId,
      baseArticleTypeId: stringValue(item.baseArticleTypeId) || undefined,
      baseArticleTypeVersionId: stringValue(item.baseArticleTypeVersionId) || undefined,
      name,
      definition,
      suitableQuestions: stringArray(item.suitableQuestions),
      unsuitableQuestions: stringArray(item.unsuitableQuestions),
      targetAudience: stringArray(item.targetAudience),
      contentGoal: stringValue(item.contentGoal) || stringValue(item.goal) || "回答目标问题并支持读者判断",
      structureModules: normalizedStructureModules(item.structureModules || item.structure),
      emphasisOrder: stringArray(item.emphasisOrder),
      style: stringArray(item.style).length ? stringArray(item.style) : stringArray(item.styleTraits),
      lengthRange,
      evidencePreferences: stringArray(item.evidencePreferences),
      ctaIntent: stringValue(item.ctaIntent) || stringValue(item.cta),
      channelFit: stringArray(item.channelFit).length ? stringArray(item.channelFit) : stringArray(item.channels),
      questionClusterIds: stringArray(item.questionClusterIds),
      recommendationReason: stringValue(item.recommendationReason) || stringValue(item.reason) || "基于问题意图、证据准备度与渠道适配生成",
      confidence: Number.isFinite(Number(item.confidence)) ? Math.min(1, Math.max(0, Number(item.confidence))) : 0.5,
      evidenceReadiness: normalizedEvidenceReadiness(item.evidenceReadiness) || "partial",
      proposedMonthlyShare: Number.isFinite(Number(item.proposedMonthlyShare)) ? Math.min(1, Math.max(0, Number(item.proposedMonthlyShare))) : 0,
      definitionHash,
      raw: item
    }];
  }).slice(0, 6);
  if (portfolio.length < 2) throw new Error("product_strategy_article_type_portfolio_too_small");
  return portfolio;
}

const evidenceSensitiveTypePattern = /竞品|对比|比较|架构|底层|案例|客户|ROI|投资回报|价格|定价|合规|安全/i;

function applyEvidenceReadinessPolicy(
  portfolio: ProductGeoArticleTypePortfolioItem[],
  claimsRequiringEvidence: string[]
) {
  if (!claimsRequiringEvidence.length) return portfolio;
  return portfolio.map((item) => {
    const semanticText = [item.name, item.definition, item.contentGoal, item.recommendationReason].join(" ");
    return item.evidenceReadiness === "ready" && evidenceSensitiveTypePattern.test(semanticText)
      ? { ...item, evidenceReadiness: "partial" as const }
      : item;
  });
}

function addGovernedCapabilityBoundaryType(
  portfolio: ProductGeoArticleTypePortfolioItem[],
  profile: ProductKnowledgeProfile | undefined
) {
  if (portfolio.some((item) => item.evidenceReadiness === "ready")) return portfolio;
  if (!profile || profile.status !== "ready" || !profile.positioning.length || !profile.capabilities.length || !profile.boundaries.length) {
    return portfolio;
  }
  const raw = {
    origin: "adapted",
    name: "产品能力与适用边界",
    knowledgeClaimIds: [...profile.positioning, ...profile.capabilities, ...profile.boundaries].map((fact) => fact.claimId)
  };
  const definitionHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const safeShare = 0.25;
  const replacementIndex = portfolio.length >= 6
    ? portfolio.reduce((selected, item, index, items) => (
      item.evidenceReadiness !== "ready" && item.proposedMonthlyShare <= items[selected].proposedMonthlyShare ? index : selected
    ), 0)
    : -1;
  const boundedPortfolio = replacementIndex >= 0
    ? portfolio.filter((_, index) => index !== replacementIndex)
    : portfolio;
  const configuredShare = boundedPortfolio.reduce((sum, item) => sum + Math.max(0, item.proposedMonthlyShare), 0);
  const scaledPortfolio = boundedPortfolio.map((item) => ({
    ...item,
    proposedMonthlyShare: configuredShare > 0
      ? item.proposedMonthlyShare / configuredShare * (1 - safeShare)
      : (1 - safeShare) / boundedPortfolio.length
  }));
  const safeItem: ProductGeoArticleTypePortfolioItem = {
    portfolioItemId: "governed-product-capability-boundary",
    origin: "adapted",
    articleTypeId: undefined,
    articleTypeVersionId: `strategy-article-type-version-${definitionHash.slice(0, 32)}`,
    baseArticleTypeId: "system-template-scenario-solution",
    baseArticleTypeVersionId: "system-template-scenario-solution-v1",
    name: "产品能力与适用边界",
    definition: "基于已治理的产品定位、能力、场景与边界事实，解释产品能做什么、适合谁，以及采用前需要确认什么。",
    suitableQuestions: ["产品能解决什么问题？", "产品适合哪些团队和场景？", "采用前需要确认哪些条件和边界？"],
    unsuitableQuestions: ["不适合回答竞品优劣、客户案例、ROI、价格或未公开技术架构。"],
    targetAudience: ["业务负责人", "项目负责人", "产品评估人员"],
    contentGoal: "帮助读者基于正式产品事实判断能力、场景与适用边界",
    structureModules: [
      { key: "真实任务背景", purpose: "从用户需要完成的工作出发", required: true },
      { key: "已验证能力", purpose: "仅陈述知识库支持的产品能力", required: true },
      { key: "适用场景", purpose: "说明已验证的团队与业务场景", required: true },
      { key: "采用路径", purpose: "解释从场景梳理到接入与运营的路径", required: true },
      { key: "适用边界", purpose: "明确权限、数据、治理与资料不足边界", required: true },
      { key: "判断清单", purpose: "给出不含夸大承诺的评估清单", required: true }
    ],
    emphasisOrder: ["真实任务", "已验证能力", "适用场景", "采用路径", "适用边界"],
    style: ["客观", "具体", "少宣传", "证据优先"],
    lengthRange: { min: 1600, max: 2400 },
    evidencePreferences: ["知识库已治理产品事实", "官方产品资料", "条件与限制"],
    ctaIntent: "基于当前业务任务核对适用条件",
    channelFit: ["wechat", "official_website"],
    questionClusterIds: ["产品能力与适用边界"],
    recommendationReason: "当前正式知识库足以支撑产品能力、场景和边界解释，但不足以支撑竞品优劣、案例或 ROI 结论。",
    confidence: 0.95,
    evidenceReadiness: "ready",
    proposedMonthlyShare: safeShare,
    definitionHash,
    raw
  };
  return [...scaledPortfolio, safeItem];
}

function addGovernedCapabilityBoundaryOpportunity(
  opportunities: ProductGeoStrategyOpportunity[],
  portfolio: ProductGeoArticleTypePortfolioItem[]
) {
  const safeType = portfolio.find((item) => item.portfolioItemId === "governed-product-capability-boundary" && item.evidenceReadiness === "ready");
  if (!safeType || opportunities.some((item) => item.opportunityId === "产品能力与适用边界")) return opportunities;
  const safeOpportunity: ProductGeoStrategyOpportunity = {
    opportunityId: "产品能力与适用边界",
    title: "基于正式资料判断产品能力、适用场景与人机协作边界",
    intent: "adoption_evaluation",
    priority: "high",
    productFit: "由已治理的产品定位、能力、场景和边界事实直接支持",
    evidenceReadiness: "ready",
    representativeQuestions: [
      "产品能解决哪些真实工作问题？",
      "哪些环节可由 AI 执行，哪些判断仍应由人负责？",
      "采用前需要确认哪些条件和适用边界？"
    ],
    sourceIds: [],
    raw: { source: "governed_product_knowledge_profile" }
  };
  return [safeOpportunity, ...opportunities];
}

export function compileProductGeoStrategyContentPlan(input: {
  project: GeoResearchProject;
  blueprint: GeoBlueprintVersion;
  sourceSnapshotId: string;
  synthesisModel?: string;
  productKnowledgeProfile?: ProductKnowledgeProfile;
  productName?: string;
  entityRelationship?: string;
}): ProductGeoStrategyContentPlanV2 {
  const { project, blueprint } = input;
  const monthly = recordValue(blueprint.monthlyStrategyInput);
  const evidence = recordValue(blueprint.evidenceRequirements);
  const competitorLandscape = recordValue(blueprint.competitorLandscape);
  const safeCompetitorLandscape = sanitizeCompetitorLandscape(competitorLandscape);
  const safeEvidenceRequirements = sanitizeEvidenceRequirements(evidence);
  const expression = recordValue(monthly.expressionDirection);
  const initialPortfolio = normalizeArticleTypePortfolio(recordValue(blueprint.contentTypeStrategy));
  const monthlyObjectives = stringArray(monthly.objectives);
  const evidenceGaps = stringArray(evidence.knowledgeGaps).length
    ? stringArray(evidence.knowledgeGaps)
    : (stringArray(evidence.gaps).length ? stringArray(evidence.gaps) : stringArray(evidence.sourceGaps));
  const requiredRoles = stringArray(evidence.requiredRoles).length
    ? stringArray(evidence.requiredRoles)
    : (stringArray(safeEvidenceRequirements.claimsRequiringEvidence).length ? ["product_fact", "public_source"] : []);
  const portfolio = addGovernedCapabilityBoundaryType(
    applyEvidenceReadinessPolicy(initialPortfolio, stringArray(safeEvidenceRequirements.claimsRequiringEvidence)),
    input.productKnowledgeProfile
  );
  const opportunities = addGovernedCapabilityBoundaryOpportunity(
    normalizeOpportunities(recordValue(blueprint.questionStrategy)),
    portfolio
  ).map((item) => ({
    ...item,
    title: subjectText(item.title, input.productName),
    productFit: subjectText(item.productFit, input.productName),
    representativeQuestions: item.representativeQuestions.map((question) => subjectText(question, input.productName))
  }));
  const normalizedPortfolio = portfolio.map((item) => {
    const normalized = {
      ...item,
      name: subjectText(item.name, input.productName),
      definition: subjectText(item.definition, input.productName),
      suitableQuestions: item.suitableQuestions.map((question) => subjectText(question, input.productName)),
      unsuitableQuestions: item.unsuitableQuestions.map((question) => subjectText(question, input.productName)),
      contentGoal: subjectText(item.contentGoal, input.productName),
      recommendationReason: subjectText(item.recommendationReason, input.productName),
      questionClusterIds: item.questionClusterIds.map((question) => subjectText(question, input.productName))
    };
    if (item.origin === "matched") return normalized;
    const definitionHash = createHash("sha256").update(JSON.stringify({
      ...normalized,
      articleTypeId: undefined,
      articleTypeVersionId: undefined,
      definitionHash: undefined
    })).digest("hex");
    return {
      ...normalized,
      definitionHash,
      articleTypeId: item.origin === "generated" ? `product-article-type-${definitionHash.slice(0, 24)}` : item.articleTypeId,
      articleTypeVersionId: `strategy-article-type-version-${definitionHash.slice(0, 32)}`
    };
  });
  const provider = serviceProviderFromRelationship(input.entityRelationship);
  const relationshipAwareOpportunities = opportunities.map((item) => ({
    ...item,
    title: provider && input.productName && item.title.includes("企业AI服务 选型依据")
      ? `${input.productName} 采用与 ${provider} 落地服务选型依据`
      : item.title,
    representativeQuestions: item.representativeQuestions.map((question) => serviceAwareQuestion(question, input.productName, provider))
  }));
  const relationshipAwarePortfolio = normalizedPortfolio.map((item) => {
    const adjusted = serviceAwareArticleType(item, input.productName, provider);
    const relationshipAware = {
      ...adjusted,
      suitableQuestions: adjusted.suitableQuestions.map((question) => serviceAwareQuestion(question, input.productName, provider)),
      questionClusterIds: adjusted.questionClusterIds.map((question) => serviceAwareQuestion(question, input.productName, provider))
    };
    if (relationshipAware.origin === "matched") return relationshipAware;
    const definitionHash = createHash("sha256").update(JSON.stringify({
      ...relationshipAware,
      articleTypeId: undefined,
      articleTypeVersionId: undefined,
      definitionHash: undefined
    })).digest("hex");
    return {
      ...relationshipAware,
      definitionHash,
      articleTypeId: relationshipAware.origin === "generated" ? `product-article-type-${definitionHash.slice(0, 24)}` : relationshipAware.articleTypeId,
      articleTypeVersionId: `strategy-article-type-version-${definitionHash.slice(0, 32)}`
    };
  });
  const promotionPurpose = input.productName && provider
    ? `围绕 ${input.productName} 的真实用户问题、适用场景与采用条件，建立 ${provider} 在 ${input.productName} 专项落地服务方面的 GEO 可见性。`
    : subjectText(project.expressionFocus, input.productName);
  const inferredAudience = [...new Set(portfolio.flatMap((item) => item.targetAudience))];
  return {
    contractVersion: productGeoStrategyContractVersion,
    sourceSnapshotId: input.sourceSnapshotId,
    researchEvidencePackId: `research-evidence-${blueprint.researchSnapshotHash}`,
    researchSnapshotHash: blueprint.researchSnapshotHash,
    productPositioning: {
      positioning: (input.productKnowledgeProfile?.positioning || []).map((fact) => fact.text),
      promotionPurpose,
      expressionFocus: promotionPurpose,
      targetAudience: stringArray(monthly.targetAudience).length ? stringArray(monthly.targetAudience) : inferredAudience,
      jobs: stringArray(monthly.jobs),
      differentiators: stringArray(monthly.differentiators).length
        ? stringArray(monthly.differentiators)
        : stringArray(competitorLandscape.differentiationAngles),
      applicableScenarios: stringArray(monthly.applicableScenarios),
      excludedScenarios: stringArray(monthly.excludedScenarios),
      prohibitedClaims: [...new Set([...project.forbiddenFocus, ...stringArray(safeEvidenceRequirements.claimsRequiringEvidence)])],
      targetMarkets: [...project.researchMarkets],
      languages: [...project.languages]
    },
    fixedExpression: undefined,
    geoOpportunities: relationshipAwareOpportunities,
    articleTypePortfolio: relationshipAwarePortfolio,
    evidencePolicy: {
      requiredRoles,
      conflictSummaries: stringArray(evidence.conflictSummaries).length ? stringArray(evidence.conflictSummaries) : stringArray(evidence.conflicts),
      knowledgeGaps: evidenceGaps,
      citationStrategy: governedCitationStrategy(recordValue(blueprint.citationStrategy)),
      evidenceRequirements: safeEvidenceRequirements
    },
    expressionDirection: {
      keyMessages: stringArray(expression.keyMessages).length
        ? stringArray(expression.keyMessages)
        : (monthlyObjectives.length ? monthlyObjectives.map((item) => subjectText(item, input.productName)) : [promotionPurpose]),
      emphasisOrder: stringArray(expression.emphasisOrder).length
        ? stringArray(expression.emphasisOrder)
        : (monthlyObjectives.length ? monthlyObjectives.map((item) => subjectText(item, input.productName)) : [promotionPurpose]),
      prohibitedPatterns: [...project.forbiddenFocus, ...stringArray(expression.prohibitedPatterns)],
      tone: stringArray(expression.tone).length
        ? stringArray(expression.tone)
        : (stringArray(expression.style).length ? stringArray(expression.style) : ["客观", "具体", "证据优先"])
    },
    channelPriorities: project.targetChannels.map((channel) => ({
      channel,
      role: stringValue(recordValue(monthly.channelRoles)[channel]) || "产品 GEO 内容分发",
      suitableArticleTypeIds: relationshipAwarePortfolio.filter((item) => !item.channelFit.length || item.channelFit.includes(channel))
        .map((item) => item.articleTypeId || item.articleTypeVersionId as string)
    })),
    recommendedMonthlyMix: relationshipAwarePortfolio.map((item) => ({
      articleTypeId: item.articleTypeId || item.articleTypeVersionId as string,
      questionClusterIds: item.questionClusterIds,
      targetShare: item.proposedMonthlyShare
    })),
    retestBaseline: recordValue(blueprint.retestBaseline),
    synthesis: {
      model: input.synthesisModel || "zhipu",
      blueprintVersionId: blueprint.blueprintVersionId,
      blueprintVersionNumber: blueprint.versionNumber,
      runId: blueprint.runId,
      promptVersion: "geo-strategy-synthesis-v2"
    },
    researchSynthesis: {
      questionStrategy: recordValue(blueprint.questionStrategy),
      competitorLandscape: safeCompetitorLandscape,
      contentTypeStrategy: recordValue(blueprint.contentTypeStrategy)
    }
  };
}

export function assertHumanProductStrategyDecision(actor: { actorType: string; actorRole: string }) {
  if (actor.actorType !== "human") {
    throw new Error("human_strategy_approval_required");
  }
  if (!humanStrategyRoles.has(actor.actorRole)) {
    throw new Error("product_strategy_role_forbidden");
  }
}

export function assertProductGeoStrategyContentPlanV2(plan: ProductGeoStrategyContentPlanV2) {
  if (plan.contractVersion !== productGeoStrategyContractVersion) throw new Error("product_strategy_contract_version_invalid");
  if (!plan.geoOpportunities.length) throw new Error("product_strategy_geo_opportunities_missing");
  if (!plan.expressionDirection.keyMessages.length || !plan.expressionDirection.emphasisOrder.length || !plan.expressionDirection.tone.length) {
    throw new Error("product_strategy_expression_direction_incomplete");
  }
  if (plan.articleTypePortfolio.length < 2 || plan.articleTypePortfolio.length > 6) {
    throw new Error("product_strategy_article_type_portfolio_invalid");
  }
  const itemIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const item of plan.articleTypePortfolio) {
    if (itemIds.has(item.portfolioItemId)) throw new Error("product_strategy_article_type_item_duplicate");
    itemIds.add(item.portfolioItemId);
    if (!item.articleTypeVersionId || versionIds.has(item.articleTypeVersionId)) {
      throw new Error("product_strategy_article_type_version_invalid");
    }
    versionIds.add(item.articleTypeVersionId);
    if (!["matched", "adapted", "generated"].includes(item.origin)) throw new Error("product_strategy_article_type_origin_invalid");
    if (!item.name.trim() || !item.definition.trim() || !item.contentGoal.trim() || !item.recommendationReason.trim()) {
      throw new Error("product_strategy_article_type_definition_incomplete");
    }
    if (!item.structureModules.length || item.structureModules.some((module) => !module.key.trim() || !module.purpose.trim())) {
      throw new Error("product_strategy_article_type_structure_invalid");
    }
    if (item.lengthRange.min < 300 || item.lengthRange.max > 10000 || item.lengthRange.min > item.lengthRange.max) {
      throw new Error("product_strategy_article_type_length_invalid");
    }
    if (item.origin === "matched" && (!item.articleTypeId || !item.articleTypeVersionId)) {
      throw new Error("product_strategy_matched_article_type_reference_missing");
    }
    if (item.origin === "adapted" && (!item.baseArticleTypeId || !item.baseArticleTypeVersionId)) {
      throw new Error("product_strategy_adapted_article_type_base_missing");
    }
  }
  const monthlyShare = plan.articleTypePortfolio.reduce((sum, item) => sum + item.proposedMonthlyShare, 0);
  if (monthlyShare < 0.99 || monthlyShare > 1.01) throw new Error("product_strategy_monthly_mix_invalid");
}

export function deriveProductStrategyMonthlyTypeQuotas(
  plan: ProductGeoStrategyContentPlanV2,
  totalArticleCount: number
) {
  if (!Number.isInteger(totalArticleCount) || totalArticleCount < 1 || totalArticleCount > 500) {
    throw new Error("monthly_article_count_invalid");
  }
  const eligible = plan.articleTypePortfolio.filter((item) => item.evidenceReadiness === "ready");
  if (!eligible.length) throw new Error("monthly_article_type_evidence_blocked");
  const configuredWeight = eligible.reduce((sum, item) => sum + Math.max(0, item.proposedMonthlyShare), 0);
  const allocations = eligible.map((item) => {
    const weight = configuredWeight > 0 ? Math.max(0, item.proposedMonthlyShare) / configuredWeight : 1 / eligible.length;
    const exact = weight * totalArticleCount;
    return { item, exact, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = totalArticleCount - allocations.reduce((sum, item) => sum + item.count, 0);
  for (const allocation of [...allocations].sort((left, right) => right.remainder - left.remainder
    || left.item.portfolioItemId.localeCompare(right.item.portfolioItemId))) {
    if (remaining <= 0) break;
    allocation.count += 1;
    remaining -= 1;
  }
  return allocations.map(({ item, count }) => ({
    portfolioItemId: item.portfolioItemId,
    articleTypeId: item.articleTypeId,
    articleTypeVersionId: item.articleTypeVersionId as string,
    count,
    questionClusterIds: item.questionClusterIds
  })).filter((item) => item.count > 0);
}

export function resolveProductStrategyDecisionStatus(
  currentStatus: ProductGeoStrategyPackStatus,
  decision: ProductGeoStrategyDecision
): ProductGeoStrategyPackStatus {
  if (currentStatus !== "pending_strategy_review") {
    throw new Error("product_strategy_not_reviewable");
  }
  return decision === "approve" ? "strategy_approved" : "rejected";
}

export function isProductStrategyReviewable(status: ProductGeoStrategyPackStatus) {
  return status === "pending_strategy_review";
}

export function isProductStrategyProductionReady(status: ProductGeoStrategyPackStatus) {
  return status === "production_ready" || status === "active";
}
