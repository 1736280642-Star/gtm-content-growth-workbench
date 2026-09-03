import type { ProductKnowledgeProfile } from "./product-knowledge-profile";
import type {
  GeoSearchEntityClassification,
  GeoSearchEvidenceCandidate,
  GeoSearchEvidenceUsage,
  GeoSearchQuery,
  MultiSearchEvidencePack
} from "./geo-search-contracts";
import { recomputeChannelStats } from "./geo-search-adapters";
import type { GeoChannelRule } from "./geo-channel-rule-pack";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export const JOTO_ADP_CSP_IDENTITY = "JOTO是腾讯云ADP CSP授权服务商";

/**
 * Removes model-authored inverted duplicates while preserving the governed
 * exact identity sentence assembled by the system. This is also applied when
 * reading legacy accepted drafts so their immutable audit record stays intact
 * while the user-facing copy reflects the current expression rule.
 */
export function normalizeJotoAdpIdentityPhrasing(
  markdown: string,
  options: { exactIdentityWillBeAssembled?: boolean } = {}
) {
  if (!options.exactIdentityWillBeAssembled && !markdown.includes(JOTO_ADP_CSP_IDENTITY)) return markdown;
  return markdown
    .replace(/作为\s*腾讯云\s*ADP\s*CSP\s*授权服务商[，,]\s*(?=JOTO)/gi, "")
    .replace(/JOTO\s*作为\s*腾讯云\s*ADP\s*CSP\s*授权服务商[，,]\s*/gi, "JOTO ");
}

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

const productCategoryQueryLabels: Record<string, string> = {
  enterprise_ai_service: "企业级 AI 智能体平台",
  ai_product: "AI 产品"
};

function queryPart(value: string | undefined, maximum = 24) {
  if (!value) return undefined;
  const categoryLabel = productCategoryQueryLabels[value.trim().toLocaleLowerCase()];
  const cleaned = (categoryLabel || value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|]/g, " ")
    .replace(/_/g, " ")
    .replace(/^[^，。；]{0,20}(?:全新升级|重磅升级)[，：:\s]*/i, "")
    .replace(/^(?:核心)?打造\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const segment = cleaned.split(/[。；;\n]/).map((item) => item.trim()).find((item) => item.length >= 4) || cleaned;
  return Array.from(segment).slice(0, maximum).join("") || undefined;
}

function firstQueryPart(values: Array<string | undefined>, maximum = 24) {
  return values.map((value) => queryPart(value, maximum)).find(Boolean);
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

/** 实体命名表：由身份卡确定性派生，LLM 只能引用不能发明 */
export interface GeoEntityNamingStandard {
  /** 允许出现的全部规范实体表述（产品名/别名 + 品牌与角色名） */
  canonicalNames: string[];
  /** 禁止出现的生造拼接变体（角色名+产品名组合且不属于别名集合） */
  forbiddenPatterns: string[];
}

export function deriveEntityNamingStandard(identity: GeoProductIdentityCard): GeoEntityNamingStandard {
  const productNames = compact([identity.canonicalName, identity.displayName, ...identity.aliases]);
  const roleNames = compact([identity.brandName, identity.officialEntity, identity.serviceProvider?.name]);
  const aliasSet = new Set(productNames.map((item) => item.toLowerCase()));
  const forbiddenPatterns: string[] = [];
  for (const role of roleNames) {
    for (const product of productNames) {
      for (const combo of [`${role}${product}`, `${role} ${product}`, `${product}${role}`, `${product} ${role}`]) {
        if (aliasSet.has(combo.toLowerCase())) continue;
        forbiddenPatterns.push(combo);
      }
    }
  }
  return {
    canonicalNames: [...productNames, ...roleNames],
    forbiddenPatterns: [...new Set(forbiddenPatterns)].slice(0, 24)
  };
}

/** 校验实体名称类字段未混入生造复合实体（返回违规名称；空数组=通过） */
export function findEntityNamingViolations(
  names: string[],
  namingStandard: GeoEntityNamingStandard
): string[] {
  const violations: string[] = [];
  for (const name of names) {
    const normalized = name.replace(/\s+/g, "").toLowerCase();
    if (!normalized) continue;
    for (const pattern of namingStandard.forbiddenPatterns) {
      const normalizedPattern = pattern.replace(/\s+/g, "").toLowerCase();
      if (normalized === normalizedPattern) {
        violations.push(name);
        break;
      }
    }
  }
  return violations;
}

/** 补充轮定向缺口：按证据缺口选择补搜方向，替代原固定后缀 */
export type GeoSupplementaryGap =
  | "platform_evidence"
  | "independent_sources"
  | "metric_evidence"
  | "misconception_evidence";

export function compileIdentityAnchoredQueries(input: {
  taskType: string;
  identity: GeoProductIdentityCard;
  maxQueries: number;
  round?: number;
  /** 渠道规则包中的渠道（配置后启用平台感知查询） */
  channelRules?: GeoChannelRule[];
  /** 补充轮定向缺口（round>0 时生效；缺省保持旧版固定后缀，向后兼容） */
  evidenceGap?: GeoSupplementaryGap;
}): GeoSearchQuery[] {
  assertGeoProductIdentityReady(input.identity);
  const product = input.identity.displayName;
  const owner = input.identity.brandName
    || input.identity.officialEntity
    || input.identity.officialDomain
    || input.identity.entityRelationship
    || input.identity.canonicalName;
  const category = queryPart(input.identity.productCategory)
    || firstQueryPart(input.identity.positioning)
    || "已解析产品品类";
  const capability = firstQueryPart([
    ...input.identity.capabilities,
    ...input.identity.scenarios,
    ...input.identity.positioning.slice(1),
    input.identity.positioning[0]
  ])
    || category;
  const round = input.round || 0;
  const provider = input.identity.serviceProvider?.name;
  const relationship = queryPart(input.identity.serviceProvider?.relationship, 24);
  const channelRules = input.channelRules || [];

  const gapSuffix: Record<GeoSupplementaryGap, string> = {
    platform_evidence: "收录 干货 原创实践",
    independent_sources: round === 2 ? "用户 争议 反例 评价" : "官方 文档 条件 限制",
    metric_evidence: "案例 成效 数据 量化",
    misconception_evidence: "踩坑 避坑 误区 失败"
  };
  const suffix = round
    ? (input.evidenceGap ? gapSuffix[input.evidenceGap] : round === 1 ? "官方 文档 条件 限制" : "用户 争议 反例 评价")
    : "";
  // 平台感知补充轮：对配置渠道做定向收录格局补搜
  const platformGapQueries: GeoSearchQuery[] = round && input.evidenceGap === "platform_evidence"
    ? channelRules.map((channel, index): GeoSearchQuery => ({
        queryId: `geo-query-${input.taskType}-supplement-${round}-platform-${index + 1}`,
        query: clipQuery(`site:${channel.domains[0]} "${product}" ${suffix}`.trim()),
        intent: "evidence_gap_resolution",
        expectedEvidenceRole: "platform_inclusion_landscape",
        freshnessRequirement: "year",
        stopCondition: `该平台返回至少一条通过产品实体校验的收录样本`,
        round,
        identityAnchors: compact([product, owner, channel.channelKey]),
        candidateAcceptanceRule: "来源域名必须命中该渠道规则包域名；产品事实只能来自 target_match，category_related 与 user_demand 只能作为需求信号。",
        candidateRejectionRule: "非该平台域名、名称相同但身份不一致的来源必须丢弃。",
        channelKey: channel.channelKey
      }))
    : [];

  type QuerySpec = [string, string[], string, string?];
  const providerSelectionQuery: QuerySpec | undefined = provider
    ? [
        `"${product}" "${provider}" 实施服务商 选型 推荐 资质 交付 验收 案例`,
        compact([product, provider, owner, relationship]),
        "service_provider_selection"
      ]
    : undefined;
  /** 平台收录格局查询：每个配置渠道一条 site: 约束查询 */
  const platformQueries: QuerySpec[] = channelRules.map((channel) => [
    `site:${channel.domains[0]} "${product}" 实操 经验`,
    compact([product, owner, channel.channelKey]),
    "platform_inclusion_landscape",
    channel.channelKey
  ]);
  const querySets: QuerySpec[] = input.taskType === "live_question_discovery"
    ? [
        ...(providerSelectionQuery ? [providerSelectionQuery] : []),
        [`"${product}" "${owner}" ${category} 用户问题 社区 评价`, [product, owner, category], "user_demand"],
        [`"${product}" ${capability} 使用 故障 实施 支持`, [product, capability, category], "user_demand"],
        [`"${product}" 误区 常见错误 使用率 采购`, [product, owner, category], "misconception"],
        [`${category} ${capability} 落地 效率 提升 数据 案例`, [category, capability, owner], "metric_benchmark"],
        [`"${product}" 踩坑 失败 教训 权限 集成`, [product, capability, category], "pitfall_evidence"],
        [`${category} ${capability} 选型 部署 集成 安全 常见问题`, [category, capability, owner], "user_demand"]
      ]
    : input.taskType === "live_competitor_discovery"
      ? [
          ...(provider ? [[
            `"${product}" "${provider}" 实施伙伴 服务商推荐 选型比较`,
            compact([product, provider, owner]),
            "service_provider_landscape"
          ] as QuerySpec] : []),
          [`"${product}" "${owner}" ${category} 竞品 对比 替代方案`, [product, owner, category], "competitive_relationship"],
          [`${category} ${capability} 开源自建 对比 推荐`, [category, capability, owner], "selection_alternative"],
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
  const compileQuerySpecs = (specs: QuerySpec[]) => specs.map(([queryValue, anchors, evidenceRole, channelKey], index): GeoSearchQuery => ({
    queryId: `geo-query-${input.taskType}-${round ? `supplement-${round}-` : ""}${index + 1}`,
    query: clipQuery(`${queryValue} ${suffix}`),
    intent: round ? "evidence_gap_resolution" : input.taskType,
    expectedEvidenceRole: evidenceRole,
    freshnessRequirement: "year",
    stopCondition: channelKey
      ? `该平台返回至少一条通过产品实体校验的收录样本，且至少两家 Provider 返回两个独立 URL`
      : "至少两家 Provider 返回两个通过产品实体校验的独立 URL",
    round,
    identityAnchors: compact(anchors as string[]),
    candidateAcceptanceRule: "产品事实只接受 target_match；verified_competitor 只证明竞品事实；category_related 与 user_demand 只证明需求、选型或搜索关系。",
    candidateRejectionRule: "名称相同但品牌归属、品类、能力或场景不一致，以及身份不足的来源必须丢弃且不得留存。",
    channelKey
  }));
  if (round && input.evidenceGap === "platform_evidence") return platformGapQueries;
  const compiled = compileQuerySpecs(querySets.slice(0, input.maxQueries));
  // 平台格局查询使用独立预算，避免被内容证据查询的 maxQueries 上限截断。
  const compiledPlatforms = round ? [] : compileQuerySpecs(platformQueries).map((query, index) => ({
    ...query,
    queryId: `geo-query-${input.taskType}-platform-${index + 1}`
  }));
  return [...compiled, ...compiledPlatforms];
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

function evidenceUsage(classification: GeoSearchEntityClassification): GeoSearchEvidenceUsage {
  if (classification === "target_match") return "product_fact";
  if (classification === "verified_competitor") return "competitor_fact";
  if (classification === "category_related" || classification === "user_demand") return "demand_signal";
  return "research_observation";
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
    channelStats: recomputeChannelStats(candidates, pack.queries.flatMap((query) => query.channelKey || [])),
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
      evidenceUsage: evidenceUsage(resolution.classification),
      matchedIdentityAnchors: resolution.matchedIdentityAnchors
    }];
  });
  return recalculatePack(input.pack, candidates);
}
