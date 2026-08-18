import type { ProductKnowledgeProfile } from "./product-knowledge-profile";
import type {
  GeoSearchEntityClassification,
  GeoSearchEvidenceCandidate,
  GeoSearchQuery,
  MultiSearchEvidencePack
} from "./geo-search-contracts";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export interface GeoProductIdentityCard {
  productId: string;
  canonicalName: string;
  displayName: string;
  aliases: string[];
  brandName?: string;
  officialEntity?: string;
  officialUrl?: string;
  officialDomain?: string;
  productCategory?: string;
  entityRelationship?: string;
  serviceProvider?: {
    name: string;
    relationship: string;
    deliveryCapabilities: string[];
    evidenceBoundaries: string[];
  };
  positioning: string[];
  audiences: string[];
  capabilities: string[];
  scenarios: string[];
  boundaries: string[];
  profileSource: ProductKnowledgeProfile["source"];
  profileFactCount: number;
}

export interface GeoEntityResolution {
  candidateId: string;
  classification: GeoSearchEntityClassification;
  matchedIdentityAnchors: string[];
  contradictingIdentityAnchors: string[];
  competitorRelationshipSupported: boolean;
  overlapDimensions: string[];
  confidence: number;
}

function compact(values: Array<string | undefined>) {
  return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))];
}

function officialDomain(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function serviceProviderName(value?: string) {
  if (!value) return undefined;
  for (const segment of value.split(/[；。]/).map((item) => item.trim()).filter(Boolean)) {
    if (!/(?:服务商|合作伙伴|提供|支持|负责|实施|交付)/.test(segment)) continue;
    const match = segment.match(/^([A-Za-z][A-Za-z0-9._-]{1,30})\s*(?:是|作为|可|为|向|提供|支持|负责)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function serviceProviderFacts(profile: ProductKnowledgeProfile, provider: string) {
  const deliveryPattern = /实施|交付|验收|培训|系统接入|场景评估|任务共创|质量评测|持续运营|后续支持|项目范围/i;
  const facts = compact([
    ...profile.capabilities.map((item) => item.text),
    ...profile.scenarios.map((item) => item.text)
  ]).filter((item) => item.includes(provider) || deliveryPattern.test(item));
  const boundaries = compact(profile.boundaries.map((item) => item.text))
    .filter((item) => item.includes(provider) || /客户|案例|合同|承诺|官方|战略合作伙伴|不得|不能/.test(item));
  return { facts: facts.slice(0, 8), boundaries: boundaries.slice(0, 6) };
}

export function buildGeoProductIdentityCard(input: {
  product: {
    productId: string;
    canonicalName: string;
    displayName: string;
    aliases: string[];
    brandName?: string;
    officialEntity?: string;
    officialUrl?: string;
    productCategory?: string;
    entityRelationship?: string;
  };
  knowledgeProfile: ProductKnowledgeProfile;
}): GeoProductIdentityCard {
  const providerName = serviceProviderName(input.product.entityRelationship);
  const providerFacts = providerName
    ? serviceProviderFacts(input.knowledgeProfile, providerName)
    : undefined;
  return {
    ...input.product,
    aliases: compact([input.product.canonicalName, input.product.displayName, ...input.product.aliases]),
    officialDomain: officialDomain(input.product.officialUrl),
    positioning: input.knowledgeProfile.positioning.map((item) => item.text),
    audiences: input.knowledgeProfile.audiences.map((item) => item.text),
    capabilities: input.knowledgeProfile.capabilities.map((item) => item.text),
    scenarios: input.knowledgeProfile.scenarios.map((item) => item.text),
    boundaries: input.knowledgeProfile.boundaries.map((item) => item.text),
    serviceProvider: providerName ? {
      name: providerName,
      relationship: input.product.entityRelationship || "",
      deliveryCapabilities: providerFacts?.facts || [],
      evidenceBoundaries: providerFacts?.boundaries || []
    } : undefined,
    profileSource: input.knowledgeProfile.source,
    profileFactCount: input.knowledgeProfile.factCount
  };
}

export function assertGeoProductIdentityReady(card: GeoProductIdentityCard) {
  const ownershipAnchors = compact([card.brandName, card.officialEntity, card.officialDomain, card.entityRelationship]);
  const semanticAnchors = compact([
    card.productCategory,
    ...card.positioning.slice(0, 2),
    ...card.capabilities.slice(0, 3),
    ...card.scenarios.slice(0, 2)
  ]);
  const gaps = [
    ownershipAnchors.length === 0 ? "缺少品牌、归属实体、实体关系或官网域名" : undefined,
    semanticAnchors.length < 2 ? "解析后的定位、品类、能力和场景不足两个身份锚点" : undefined,
    card.profileFactCount < 1 ? "上传资料尚未形成可追溯产品事实" : undefined
  ].filter((item): item is string => Boolean(item));
  if (gaps.length) {
    throw new V5GovernanceRepositoryError(
      "geo_product_identity_insufficient",
      `GEO 调研缺少可区分同名产品的实体信息：${gaps.join("；")}。`,
      422,
      "先完成资料解析并确认产品品牌/归属、官网或实体关系，以及定位、能力和场景，再重新发起调研。"
    );
  }
}

function queryPart(value: string | undefined, maximum = 18) {
  return value?.replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function identityQueryAnchors(card: GeoProductIdentityCard) {
  return compact([
    card.displayName,
    card.brandName,
    card.officialEntity,
    card.officialDomain,
    card.serviceProvider?.name,
    card.productCategory,
    queryPart(card.positioning[0]),
    queryPart(card.capabilities[0]),
    queryPart(card.scenarios[0])
  ]);
}

function clipQuery(value: string) {
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, 70).join("");
}

export function compileIdentityAnchoredQueries(input: {
  taskType: string;
  identity: GeoProductIdentityCard;
  maxQueries: number;
  round?: number;
}): GeoSearchQuery[] {
  assertGeoProductIdentityReady(input.identity);
  const product = input.identity.displayName;
  const owner = input.identity.brandName
    || input.identity.officialEntity
    || input.identity.officialDomain
    || input.identity.entityRelationship
    || input.identity.canonicalName;
  const category = input.identity.productCategory || queryPart(input.identity.positioning[0]) || "已解析产品品类";
  const capability = queryPart(input.identity.capabilities[0])
    || queryPart(input.identity.scenarios[0])
    || queryPart(input.identity.positioning[1])
    || queryPart(input.identity.positioning[0])
    || category;
  const round = input.round || 0;
  const provider = input.identity.serviceProvider?.name;
  const relationship = queryPart(input.identity.serviceProvider?.relationship, 24);
  const suffix = round === 1 ? "官方 文档 条件 限制" : round === 2 ? "用户 争议 反例 评价" : "";
  type QuerySpec = [string, string[], string];
  const providerSelectionQuery: QuerySpec | undefined = provider
    ? [
        `"${product}" "${provider}" 实施服务商 选型 推荐 资质 交付 验收 案例`,
        compact([product, provider, owner, relationship]),
        "service_provider_selection"
      ]
    : undefined;
  const querySets: QuerySpec[] = input.taskType === "live_question_discovery"
    ? [
        ...(providerSelectionQuery ? [providerSelectionQuery] : []),
        [`"${product}" "${owner}" ${category} 用户问题 社区 评价`, [product, owner, category], "user_demand"],
        [`${category} ${capability} 选型 部署 集成 安全 常见问题`, [category, capability, owner], "user_demand"],
        [`"${product}" ${capability} 使用 故障 实施 支持`, [product, capability, category], "user_demand"]
      ]
    : input.taskType === "live_competitor_discovery"
      ? [
          ...(provider ? [[
            `"${product}" "${provider}" 实施伙伴 服务商推荐 选型比较`,
            compact([product, provider, owner]),
            "service_provider_landscape"
          ] as QuerySpec] : []),
          [`"${product}" "${owner}" ${category} 竞品 对比 替代方案`, [product, owner, category], "competitive_relationship"],
          [`${category} ${capability} 产品推荐 品牌比较`, [category, capability, owner], "competitive_relationship"],
          [`"${product}" ${capability} 市场评价 内容渠道`, [product, capability, category], "competitive_relationship"]
        ]
      : [
          ...(provider ? [[
            `企业如何选择 "${product}" 实施服务商 "${provider}" 交付 验收`,
            compact([product, provider, owner]),
            "service_provider_answer_baseline"
          ] as QuerySpec] : []),
          [`"${product}" "${owner}" ${category} 用户评价 常见问题`, [product, owner, category], "answer_engine_baseline"],
          [`${category} ${capability} 对比 推荐`, [category, capability, owner], "answer_engine_baseline"],
          [`"${product}" ${capability} 选型 真实体验`, [product, capability, category], "answer_engine_baseline"]
        ];
  return querySets.slice(0, input.maxQueries).map(([queryValue, anchors, evidenceRole], index) => ({
    queryId: `geo-query-${input.taskType}-${round ? `supplement-${round}-` : ""}${index + 1}`,
    query: clipQuery(`${queryValue} ${suffix}`),
    intent: round ? "evidence_gap_resolution" : input.taskType,
    expectedEvidenceRole: evidenceRole,
    freshnessRequirement: "year",
    stopCondition: "至少两家 Provider 返回两个通过产品实体校验的独立 URL",
    round,
    identityAnchors: compact(anchors as string[]),
    candidateAcceptanceRule: "来源必须与产品身份卡一致，或明确支持同一用户任务、品类需求或竞争关系。",
    candidateRejectionRule: "名称相同但品牌归属、品类、能力或场景不一致，以及身份不足的来源必须丢弃且不得留存。"
  }));
}

function acceptedClassification(taskType: string, classification: GeoSearchEntityClassification) {
  if (["homonym", "unrelated", "insufficient_evidence"].includes(classification)) return false;
  if (taskType === "live_competitor_discovery") {
    return ["target_match", "verified_competitor", "category_related"].includes(classification);
  }
  if (taskType === "live_question_discovery") {
    return ["target_match", "verified_competitor", "category_related", "user_demand"].includes(classification);
  }
  return ["target_match", "verified_competitor", "category_related", "user_demand"].includes(classification);
}

function isSameNameCandidate(candidate: GeoSearchEvidenceCandidate, identity: GeoProductIdentityCard) {
  const text = `${candidate.title || ""} ${candidate.excerpt || ""}`.toLocaleLowerCase();
  return identity.aliases.some((alias) => alias.length >= 3 && text.includes(alias.toLocaleLowerCase()));
}

function hasOwnershipProof(candidate: GeoSearchEvidenceCandidate, identity: GeoProductIdentityCard) {
  try {
    if (identity.officialDomain && new URL(candidate.canonicalUrl).hostname.toLowerCase() === identity.officialDomain) return true;
  } catch {
    return false;
  }
  const text = `${candidate.title || ""} ${candidate.publisher || ""} ${candidate.excerpt || ""}`.toLocaleLowerCase();
  return compact([identity.brandName, identity.officialEntity])
    .some((anchor) => anchor.length >= 2 && text.includes(anchor.toLocaleLowerCase()));
}

function recalculatePack(pack: MultiSearchEvidencePack, candidates: GeoSearchEvidenceCandidate[]): MultiSearchEvidencePack {
  const acceptedRunIds = new Set(candidates.flatMap((item) => item.providerRunIds));
  const providerRuns = pack.providerRuns.map((run) => ({
    ...run,
    sourceCount: acceptedRunIds.has(run.runId)
      ? candidates.filter((item) => item.providerRunIds.includes(run.runId)).length
      : 0
  }));
  const successfulProviders = [...new Set(providerRuns
    .filter((item) => item.status === "success" && item.sourceCount > 0)
    .map((item) => item.provider))];
  const configuredProviders = [...new Set(providerRuns
    .filter((item) => item.status !== "pending_config")
    .map((item) => item.provider))];
  const failedProviders = [...new Set(providerRuns
    .filter((item) => item.status === "failed")
    .map((item) => item.provider))];
  const gaps = [
    successfulProviders.length < 2 ? "通过实体校验并返回来源的 Provider 少于 2 家" : undefined,
    candidates.length < 2 ? "通过实体校验的独立原始来源少于 2 个" : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    ...pack,
    providerRuns,
    candidates,
    gate: {
      decision: gaps.length ? "blocked" : "passed",
      degraded: gaps.length === 0 && failedProviders.length > 0,
      failedProviders,
      successfulProviders,
      configuredProviders,
      independentSourceCount: candidates.length,
      requiredSuccessfulProviders: 2,
      requiredIndependentSources: 2,
      gaps
    }
  };
}

export function applyGeoEntityResolution(input: {
  taskType: string;
  identity: GeoProductIdentityCard;
  pack: MultiSearchEvidencePack;
  resolutions: GeoEntityResolution[];
}) {
  const byId = new Map(input.resolutions.map((item) => [item.candidateId, item]));
  const candidates = input.pack.candidates.flatMap((candidate) => {
    const resolution = byId.get(candidate.candidateId);
    if (!resolution || !acceptedClassification(input.taskType, resolution.classification)) return [];
    const nonNameAnchors = resolution.matchedIdentityAnchors.filter((item) => !/^name|alias$/i.test(item));
    const sameName = isSameNameCandidate(candidate, input.identity);
    if (sameName
      && resolution.classification !== "target_match") return [];
    if (sameName && (!hasOwnershipProof(candidate, input.identity)
      || nonNameAnchors.length < 2
      || resolution.contradictingIdentityAnchors.length > 0)) return [];
    if (resolution.classification === "verified_competitor"
      && (!resolution.competitorRelationshipSupported || resolution.overlapDimensions.length === 0)) return [];
    return [{
      ...candidate,
      entityClassification: resolution.classification as GeoSearchEvidenceCandidate["entityClassification"],
      matchedIdentityAnchors: resolution.matchedIdentityAnchors
    }];
  });
  return recalculatePack(input.pack, candidates);
}
