import { createHash } from "node:crypto";

export const geoArticleMissionContractVersion = "geo-article-mission.v1" as const;

export type GeoEvidenceUsage = "product_fact" | "competitor_fact" | "demand_signal" | "research_observation";
export type GeoEntityRole = "target_product" | "brand_owner" | "service_provider" | "competitor" | "related_entity";

export interface GeoMissionEntityNode {
  entityId: string;
  name: string;
  role: GeoEntityRole;
  aliases: string[];
}

export interface GeoMissionEntityRelation {
  subjectEntityId: string;
  predicate: "owned_by" | "served_by" | "competes_with" | "related_to" | "canonical_relationship";
  objectEntityId: string;
  canonicalStatement: string;
  evidenceClaimIds: string[];
}

export interface GeoMissionEntityGraphSnapshot {
  primaryEntityId: string;
  nodes: GeoMissionEntityNode[];
  relations: GeoMissionEntityRelation[];
  canonicalRelationshipStatements: string[];
  forbiddenRelationshipStatements: string[];
  graphHash: string;
}

export interface GeoArticleMissionContract {
  contractVersion: typeof geoArticleMissionContractVersion;
  missionId: string;
  productId: string;
  /** Product/platform entity that owns the governed product facts. */
  platformEntityId: string;
  primaryEntityId: string;
  /** Entity whose market capability this article is intended to promote. */
  promotionSubjectEntityId: string;
  /** Entity that must remain the grammatical and argumentative subject in prose. */
  narrativeSubjectEntityId: string;
  narrativeSubjectName: string;
  narrativeSubjectRole: "target_product" | "service_provider";
  promotionGoal: "geo_product_education" | "geo_provider_selection" | "geo_scenario_solution" | "geo_comparison";
  articleRole: string;
  primaryQuestion: string;
  representativeQueries: string[];
  queryClusterIds: string[];
  currentSearchGap: string;
  desiredAnswer: string;
  desiredEntityAssociations: string[];
  expectedAnswerSummary: string[];
  titlePromiseDimensions: string[];
  requiredClaimIds: string[];
  allowedEvidenceUsages: GeoEvidenceUsage[];
  forbiddenEntityIds: string[];
  searchEvidenceSourceIds: string[];
  entityGraph: GeoMissionEntityGraphSnapshot;
  geoIntentHash: string;
}

interface MissionIdentityInput {
  productId: string;
  canonicalName: string;
  displayName: string;
  aliases?: string[];
  brandName?: string;
  officialEntity?: string;
  entityRelationship?: string;
}

interface MissionOpportunityInput {
  opportunityId?: string;
  title?: string;
  intent?: string;
  productFit?: string;
  representativeQuestions?: string[];
  sourceIds?: string[];
}

interface MissionArticleTypeInput {
  portfolioItemId?: string;
  name?: string;
  definition?: string;
  contentGoal?: string;
  suitableQuestions?: string[];
  questionClusterIds?: string[];
  expectedMentionRationale?: string;
  retestProbeRefs?: string[];
  knowledgeClaimIds?: string[];
  geoOpportunitySummary?: string;
  evidenceReadiness?: string;
}

interface MissionPlanInput {
  productPositioning?: {
    promotionPurpose?: string;
    expressionFocus?: string;
    positioning?: string[];
    prohibitedClaims?: string[];
  };
  geoOpportunities?: MissionOpportunityInput[];
  evidencePolicy?: { knowledgeGaps?: string[] };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashGeoMissionValue(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function compact(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "entity";
}

function serviceProviderName(relationship: string | undefined, productNames: string[]) {
  if (!relationship) return undefined;
  const clauses = relationship.split(/[；。\n]/).map((item) => item.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (!/(?:服务商|实施方|交付方|合作伙伴|CSP伙伴)/i.test(clause)) continue;
    const match = clause.match(/^([^，,；。]{2,40}?)(?:是|为|可|能够|作为)/);
    const name = match?.[1]?.trim();
    if (name && !productNames.some((item) => item && name.includes(item))) return name;
  }
  return undefined;
}

function titleDimensions(question: string, productNames: string[]) {
  let text = question;
  for (const name of productNames.sort((left, right) => right.length - left.length)) text = text.replaceAll(name, "");
  const parts = text
    .replace(/(?:应(?:该|当)?(?:核对|关注|确认|考虑)?|需要(?:核对|关注|确认|考虑)?|包含|有)哪些/g, "、")
    .replace(/[？?。！!：:]/g, "")
    .split(/、|以及|及其|和|与|及|，|,/)
    .map((item) => item.trim()
      .replace(/^(?:的|在)+/, "")
      .replace(/^(?:企业|用户|团队)(?:在)?/, "")
      .replace(/^(?:选择|评估|确认)+/, "")
      .replace(/时$/, "")
      .replace(/(?:方面)?表现如何$/, "")
      .replace(/如何(?:实现|完成|判断|选择)?$/, "")
      .replace(/是什么$/, "")
      .trim())
    .filter((item) => item.length >= 2 && item.length <= 30);
  return compact(parts).slice(0, 8);
}

function positiveRelationshipClauses(relationship: string | undefined, entityName: string | undefined) {
  if (!relationship || !entityName) return [];
  return relationship
    .split(/[；。\n]/)
    .map((item) => item.trim())
    .filter((item) => item.includes(entityName))
    .filter((item) => !/(?:不得|禁止|不能|并非|不是|不属于)/.test(item))
    // The entity graph freezes identity and role relationships only. Delivery
    // capabilities such as implementation, training or support must enter the
    // article through independently governed EvidenceItems/Claims; otherwise a
    // strategy sentence can bypass retrieval and become an untraceable fact.
    .filter((item) => /(?:是|作为|属于|授权服务商|实施服务商|交付服务商|服务伙伴)/i.test(item));
}

function promotionGoal(article: MissionArticleTypeInput, question: string): GeoArticleMissionContract["promotionGoal"] {
  const text = `${article.name || ""} ${article.contentGoal || ""} ${question}`;
  if (/服务商|实施方|交付方|合作伙伴/.test(text)) return "geo_provider_selection";
  if (/对比|比较|竞品|选型/.test(text)) return "geo_comparison";
  if (/场景|解决|落地|流程/.test(text)) return "geo_scenario_solution";
  return "geo_product_education";
}

function selectOpportunity(plan: MissionPlanInput, article: MissionArticleTypeInput, question: string) {
  const opportunities = Array.isArray(plan.geoOpportunities) ? plan.geoOpportunities : [];
  const clusters = new Set(article.questionClusterIds || []);
  return opportunities.find((item) => item.opportunityId && clusters.has(item.opportunityId))
    || opportunities.find((item) => (item.representativeQuestions || []).some((candidate) => question.includes(candidate) || candidate.includes(question)))
    || opportunities[0];
}

function buildEntityGraph(identity: MissionIdentityInput, requiredClaimIds: string[]): GeoMissionEntityGraphSnapshot {
  const productNames = compact([identity.displayName, identity.canonicalName, ...(identity.aliases || [])]);
  const ownerName = identity.officialEntity || identity.brandName;
  const providerName = serviceProviderName(identity.entityRelationship, productNames);
  const nodes: GeoMissionEntityNode[] = [{
    entityId: identity.productId,
    name: identity.displayName || identity.canonicalName,
    role: "target_product",
    aliases: compact([identity.canonicalName, ...(identity.aliases || [])])
  }];
  const relations: GeoMissionEntityRelation[] = [];
  if (ownerName && !productNames.includes(ownerName)) {
    const ownerId = `entity-${slug(ownerName)}`;
    nodes.push({ entityId: ownerId, name: ownerName, role: "brand_owner", aliases: [] });
    relations.push({
      subjectEntityId: identity.productId,
      predicate: "owned_by",
      objectEntityId: ownerId,
      canonicalStatement: `${identity.displayName || identity.canonicalName} 的品牌归属为 ${ownerName}。`,
      evidenceClaimIds: requiredClaimIds
    });
  }
  if (providerName) {
    const providerId = `entity-${slug(providerName)}`;
    if (!nodes.some((item) => item.entityId === providerId)) nodes.push({ entityId: providerId, name: providerName, role: "service_provider", aliases: [] });
    relations.push({
      subjectEntityId: identity.productId,
      predicate: "served_by",
      objectEntityId: providerId,
      canonicalStatement: `${positiveRelationshipClauses(identity.entityRelationship, providerName).join("；")
        || `${providerName} 为 ${identity.displayName || identity.canonicalName} 提供相关服务`}。`,
      evidenceClaimIds: requiredClaimIds
    });
  } else if (identity.entityRelationship) {
    relations.push({
      subjectEntityId: identity.productId,
      predicate: "canonical_relationship",
      objectEntityId: identity.productId,
      canonicalStatement: identity.entityRelationship,
      evidenceClaimIds: requiredClaimIds
    });
  }
  const withoutHash = {
    primaryEntityId: identity.productId,
    nodes,
    relations,
    canonicalRelationshipStatements: compact(relations.map((item) => item.canonicalStatement)),
    forbiddenRelationshipStatements: compact([
      providerName ? `${providerName} 是 ${identity.displayName || identity.canonicalName} 的产品方` : undefined,
      providerName ? `${providerName} 旗下产品 ${identity.displayName || identity.canonicalName}` : undefined
    ])
  };
  return { ...withoutHash, graphHash: hashGeoMissionValue(withoutHash) };
}

function resolveNarrativeSubject(entityGraph: GeoMissionEntityGraphSnapshot) {
  const provider = entityGraph.nodes.find((item) => item.role === "service_provider");
  const subject = provider || entityGraph.nodes.find((item) => item.entityId === entityGraph.primaryEntityId)!;
  return {
    promotionSubjectEntityId: subject.entityId,
    narrativeSubjectEntityId: subject.entityId,
    narrativeSubjectName: subject.name,
    narrativeSubjectRole: subject.role === "service_provider" ? "service_provider" as const : "target_product" as const
  };
}

export function compileGeoArticleMission(input: {
  identity: MissionIdentityInput;
  plan: MissionPlanInput;
  articleType: MissionArticleTypeInput;
  primaryQuestion: string;
  sourceProblem?: string;
}): GeoArticleMissionContract {
  const question = input.primaryQuestion.trim();
  const productNames = compact([input.identity.displayName, input.identity.canonicalName, ...(input.identity.aliases || [])]);
  const opportunity = selectOpportunity(input.plan, input.articleType, question);
  const requiredClaimIds = compact(input.articleType.knowledgeClaimIds || []);
  const entityGraph = buildEntityGraph(input.identity, requiredClaimIds);
  const narrativeSubject = resolveNarrativeSubject(entityGraph);
  const baseArticleRole = input.articleType.contentGoal
    || input.articleType.geoOpportunitySummary
    || input.plan.productPositioning?.promotionPurpose
    || "围绕目标搜索问题建立准确的产品认知与实体关系。";
  const articleRole = narrativeSubject.narrativeSubjectRole === "service_provider"
    ? `以${narrativeSubject.narrativeSubjectName}为陈述主体，说明其如何基于${input.identity.displayName || input.identity.canonicalName}完成与用户问题相关的诊断、方案、实施交付或持续运营；${baseArticleRole}`
    : baseArticleRole;
  const dimensions = titleDimensions(question, productNames);
  // desiredAnswer is consumed by the writer and the quality gate. Keep it as
  // a user-facing answer shape; promotion KPIs and search rationale belong to
  // currentSearchGap/articleRole and must not leak into article prose.
  const desiredAnswer = narrativeSubject.narrativeSubjectRole === "service_provider"
    ? `直接回答“${question}”，基于已治理事实说明${narrativeSubject.narrativeSubjectName}如何把${input.identity.displayName || input.identity.canonicalName}的平台能力转成${dimensions.length ? dimensions.join("、") : "可执行的企业服务"}，并给出适用范围、职责边界与决策依据。`
    : `直接回答“${question}”，基于已治理的产品事实说明${dimensions.length ? dimensions.join("、") : articleRole}，并给出适用范围与决策依据。`;
  const currentSearchGap = compact([
    opportunity?.title,
    opportunity?.intent,
    ...(input.plan.evidencePolicy?.knowledgeGaps || [])
  ]).join("；") || `当前关于“${question}”的搜索结果缺少可核验、实体关系明确的回答。`;
  const representativeQueries = compact([
    question,
    ...(input.articleType.suitableQuestions || []),
    ...(opportunity?.representativeQuestions || [])
  ]).slice(0, 12);
  const expectedAnswerSummary = compact([
    articleRole,
    narrativeSubject.narrativeSubjectRole === "service_provider"
      ? `${narrativeSubject.narrativeSubjectName}是全文推广与叙事主体；${input.identity.displayName || input.identity.canonicalName}是其实施服务所依托的平台。`
      : undefined,
    ...dimensions,
    ...entityGraph.canonicalRelationshipStatements
  ]).slice(0, 8);
  const desiredEntityAssociations = compact([
    `${input.identity.displayName || input.identity.canonicalName}是本文唯一平台产品实体。`,
    narrativeSubject.narrativeSubjectRole === "service_provider"
      ? `${narrativeSubject.narrativeSubjectName}是本文推广与叙事主体，全文围绕其基于${input.identity.displayName || input.identity.canonicalName}提供的实施交付能力展开。`
      : `${narrativeSubject.narrativeSubjectName}是本文推广与叙事主体。`,
    ...entityGraph.canonicalRelationshipStatements
  ]);
  const withoutHash = {
    contractVersion: geoArticleMissionContractVersion,
    missionId: `geo-mission-${hashGeoMissionValue({ productId: input.identity.productId, question, articleType: input.articleType.portfolioItemId || input.articleType.name }).slice(0, 32)}`,
    productId: input.identity.productId,
    platformEntityId: input.identity.productId,
    primaryEntityId: input.identity.productId,
    ...narrativeSubject,
    promotionGoal: promotionGoal(input.articleType, question),
    articleRole,
    primaryQuestion: question,
    representativeQueries,
    queryClusterIds: compact([...(input.articleType.questionClusterIds || []), ...(input.articleType.retestProbeRefs || [])]),
    currentSearchGap,
    desiredAnswer,
    desiredEntityAssociations,
    expectedAnswerSummary,
    titlePromiseDimensions: dimensions,
    requiredClaimIds,
    allowedEvidenceUsages: ["product_fact"] as GeoEvidenceUsage[],
    forbiddenEntityIds: [] as string[],
    searchEvidenceSourceIds: compact(opportunity?.sourceIds || []),
    entityGraph
  };
  const mission = { ...withoutHash, geoIntentHash: hashGeoMissionValue(withoutHash) };
  assertGeoArticleMission(mission);
  return mission;
}

export function assertGeoArticleMission(mission: GeoArticleMissionContract) {
  const missing = [
    ["missionId", mission.missionId],
    ["productId", mission.productId],
    ["platformEntityId", mission.platformEntityId],
    ["primaryEntityId", mission.primaryEntityId],
    ["promotionSubjectEntityId", mission.promotionSubjectEntityId],
    ["narrativeSubjectEntityId", mission.narrativeSubjectEntityId],
    ["narrativeSubjectName", mission.narrativeSubjectName],
    ["primaryQuestion", mission.primaryQuestion],
    ["articleRole", mission.articleRole],
    ["desiredAnswer", mission.desiredAnswer],
    ["currentSearchGap", mission.currentSearchGap]
  ].filter(([, value]) => !String(value || "").trim()).map(([field]) => field);
  if (mission.contractVersion !== geoArticleMissionContractVersion || missing.length) {
    throw new Error(`geo_article_mission_invalid:${missing.join(",") || mission.contractVersion}`);
  }
  if (mission.productId !== mission.primaryEntityId
    || mission.platformEntityId !== mission.primaryEntityId
    || mission.entityGraph.primaryEntityId !== mission.primaryEntityId) {
    throw new Error("geo_article_mission_primary_entity_mismatch");
  }
  const narrativeNode = mission.entityGraph.nodes.find((item) => item.entityId === mission.narrativeSubjectEntityId);
  if (!narrativeNode
    || mission.promotionSubjectEntityId !== mission.narrativeSubjectEntityId
    || narrativeNode.name !== mission.narrativeSubjectName
    || narrativeNode.role !== mission.narrativeSubjectRole) {
    throw new Error("geo_article_mission_narrative_subject_mismatch");
  }
  if (!mission.representativeQueries.length || !mission.expectedAnswerSummary.length || !mission.desiredEntityAssociations.length) {
    throw new Error("geo_article_mission_semantic_context_missing");
  }
  if (!mission.allowedEvidenceUsages.includes("product_fact")) throw new Error("geo_article_mission_product_fact_usage_missing");
  const graphWithoutHash = { ...mission.entityGraph, graphHash: undefined };
  if (hashGeoMissionValue(graphWithoutHash) !== mission.entityGraph.graphHash) throw new Error("geo_article_mission_entity_graph_hash_mismatch");
  const missionWithoutHash = { ...mission, geoIntentHash: undefined };
  if (hashGeoMissionValue(missionWithoutHash) !== mission.geoIntentHash) throw new Error("geo_article_mission_hash_mismatch");
}
