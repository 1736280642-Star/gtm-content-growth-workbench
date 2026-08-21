import { createHash } from "node:crypto";
import type { GeoResearchTaskType } from "./geo-research-contracts";
import type { ProbeSetSnapshot } from "./geo-probe-contracts";
import type { ModelAnswerObservation, GeoResearchResultPack } from "./geo-research-result-contracts";
import { buildGeoResearchResultPack } from "./geo-research-result-pack";

import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import {
  combineMultiSearchEvidencePacks,
  getMultiSearchProviderReadiness,
  runMultiProviderWebSearch,
  runMultiProviderProbeAnswers
} from "./geo-search-adapters";
import type {
  GeoSearchEvidenceCandidate,
  GeoSearchQuery,
  GeoSearchQueryPlan,
  MultiSearchEvidencePack
} from "./geo-search-contracts";
import { pruneGeoResearchCitations, verifyGeoResearchEvidence } from "./geo-evidence-verifier";
import { getActiveGeoChannelRulePack } from "./geo-channel-rule-pack";
import type { ContentStrategyKnowledgeContext, ProductKnowledgeProfile } from "./product-knowledge-profile";
import type { ProductWebsiteCoverageProfile } from "./website-coverage-contracts";
import {
  applyGeoEntityResolution,
  assertGeoProductIdentityReady,
  buildGeoProductIdentityCard,
  compileIdentityAnchoredQueries,
  deriveEntityNamingStandard,
  findEntityNamingViolations,
  type GeoEntityResolution,
  type GeoProductIdentityCard,
  type GeoSupplementaryGap
} from "./geo-product-identity";

export interface GeoResearchProviderSource {
  url: string;
  title?: string;
  query?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt?: string;
  excerpt?: string;
  snapshotHash?: string;
  providerKeys?: string[];
  sourceType?: string;
  authority?: string;
  providerRunIds?: string[];
  rawResponseRefs?: string[];
  entityClassification?: string;
  matchedIdentityAnchors?: string[];
  channelKey?: string;
}

export interface GeoResearchProviderContext {
  taskType: GeoResearchTaskType;
  product: {
    productId: string;
    canonicalName: string;
    displayName: string;
    brandName?: string;
    officialEntity?: string;
    officialUrl?: string;
    productCategory?: string;
    entityRelationship?: string;
    aliases: string[];
  };
  productKnowledgeProfile: ProductKnowledgeProfile;
  contentStrategyKnowledgeContext?: ContentStrategyKnowledgeContext;
  websiteCoverageProfile?: ProductWebsiteCoverageProfile;
  project: {
    expressionFocus: string;
    forbiddenFocus: string[];
    researchMarkets: string[];
    languages: string[];
    targetChannels: string[];
  };
  sourceSnapshotHash: string;
  probeSetSnapshot?: ProbeSetSnapshot;
  previousOutputs: Array<{
    taskType: GeoResearchTaskType;
    outputSummary: Record<string, unknown>;
  }>;
}

export interface GeoResearchProviderResult {
  provider: "zhipu_synthesis";
  model: string;
  toolName: "multi.web_search+zhipu.chat.completions" | "zhipu.chat.completions";
  responseId?: string;
  outputText: string;
  structured: Record<string, unknown>;
  sources: GeoResearchProviderSource[];
  liveSearchVerified: boolean;
  rawResponse: Record<string, unknown>;
  answerObservations?: ModelAnswerObservation[];
  answerRawResponses?: Record<string, Record<string, unknown>>;
  resultPack?: GeoResearchResultPack;
  payloadHash: string;
}

const BLUEPRINT_PREVIOUS_OUTPUT_FIELDS: Partial<Record<GeoResearchTaskType, readonly string[]>> = {
  context_validation: [
    "verifiedAt",
    "sourceSnapshotVerified",
    "productIdentityConfirmed",
    "expressionBoundaryPresent"
  ],
  research_planning: [
    "identityStatus",
    "identitySummary",
    "researchQuestions",
    "frontendTestQuestions",
    "competitorDimensions",
    "successCriteria"
  ],
  live_question_discovery: [
    "questions",
    "queryClusters",
    "contentGaps",
    "claimAssessments",
    "sourceCount",
    "liveSearchVerified"
  ],
  live_competitor_discovery: [
    "competitors",
    "selectionAlternatives",
    "comparisonDimensionEvidence",
    "citationPatterns",
    "contentOpportunities",
    "claimAssessments",
    "sourceCount",
    "liveSearchVerified"
  ],
  frontend_baseline: [
    "tests",
    "aggregate",
    "claimAssessments",
    "observationCount",
    "degraded",
    "degradedReason",
    "fallbackProviders",
    "liveSearchVerified"
  ],
  evidence_alignment: [
    "verifiedPatterns",
    "unsupportedPatterns",
    "priorityGaps",
    "recommendedArticleTypes",
    "retestRequirements"
  ]
};

export function compactGeoBlueprintPreviousOutputs(
  previousOutputs: GeoResearchProviderContext["previousOutputs"]
): GeoResearchProviderContext["previousOutputs"] {
  return previousOutputs.map((previousOutput) => {
    const allowedFields = BLUEPRINT_PREVIOUS_OUTPUT_FIELDS[previousOutput.taskType];
    if (!allowedFields) return previousOutput;
    const outputSummary = Object.fromEntries(
      allowedFields.flatMap((field) => Object.hasOwn(previousOutput.outputSummary, field)
        ? [[field, previousOutput.outputSummary[field]]]
        : [])
    );
    return { taskType: previousOutput.taskType, outputSummary };
  });
}

const LIVE_SEARCH_TASKS = new Set<GeoResearchTaskType>([
  "live_question_discovery",
  "live_competitor_discovery",
  "frontend_baseline"
]);

export function getGeoResearchProviderReadiness() {
  const multiSearch = getMultiSearchProviderReadiness();
  return {
    status: multiSearch.status,
    provider: "multi_search_zhipu_synthesis" as const,
    liveSearchTool: "zhipu+doubao+qwen.web_search" as const,
    providers: multiSearch.providers,
    missingConfig: multiSearch.missingConfig
  };
}

/** 任务指令的渠道感知注入项：来自受治理的渠道规则包，无规则包时为空（指令退化为通用版） */
interface TaskInstructionChannelContext {
  faqBoards: string[];
  comparisonDimensions: string[];
  channelKeys: string[];
}

function targetChannelRules(targetChannels: string[]) {
  const pack = getActiveGeoChannelRulePack();
  const targetKeys = new Set(targetChannels);
  return pack?.channels.filter((channel) => targetKeys.has(channel.channelKey)) || [];
}

function taskInstructionChannelContext(targetChannels: string[]): TaskInstructionChannelContext {
  const channels = targetChannelRules(targetChannels);
  return {
    faqBoards: [...new Set(channels.flatMap((channel) => channel.faqBoards || []))],
    comparisonDimensions: [...new Set(channels.flatMap((channel) => channel.comparisonDimensions || []))],
    channelKeys: channels.map((channel) => channel.channelKey)
  };
}

function taskInstruction(taskType: GeoResearchTaskType, channel?: TaskInstructionChannelContext) {
  const claimRequirement = `Also return claimAssessments:[{"claim":"","stance":"supports|opposes|conditional","sourceUrls":[],"confidence":0.0}]. Include every factual conclusion that could affect strategy. Use separate supports and opposes records for conflicting evidence.`;
  const faqBoardEnum = channel?.faqBoards.length
    ? ` Map every question to the most fitting faqBoard value from this fixed list: ${channel.faqBoards.join(", ")}. Use "uncategorized" only when no board fits.`
    : "";
  const comparisonDimensionEnum = channel?.comparisonDimensions.length
    ? ` Grade selectionAlternative evidence per dimension from this fixed list: ${channel.comparisonDimensions.join(", ")}.`
    : "";
  const platformGuidance = channel?.channelKeys.length
    ? ` Target channels under governance are: ${channel.channelKeys.join(", ")}. Candidates carrying a channelKey field are live inclusion samples from that platform.`
    : "";
  switch (taskType) {
    case "research_planning":
      return `Create an executable GEO research plan. Return JSON with:
{"identityStatus":"ready|identity_insufficient","identitySummary":{"strongIdentityAnchors":[],"missingIdentityFields":[],"homonymRisks":[]},"researchQuestions":[],"searchQueries":[{"query":"","queryType":"target_entity|user_demand|category_alternative|competitor_verification|frontend_baseline|homonym_detection","identityAnchorsUsed":[],"intent":"","expectedEvidenceRole":"","candidateAcceptanceRule":"","candidateRejectionRule":"","freshnessRequirement":"day|week|month|year|no_limit","stopCondition":""}],"frontendTestQuestions":[],"competitorDimensions":[],"successCriteria":[]}.
The supplied productIdentity is authoritative and comes from user-provided materials. Never redefine, merge or guess the target identity. A name or alias match alone never proves entity identity. Every product-specific query must use at least two identity anchors from ownership/brand, official domain, category, positioning, capabilities, audiences or scenarios. Never generate a generic '<product name> + review/features/competitor/comparison' query. Separate target-entity, user-demand, category-alternative, competitor-verification, AI-baseline and homonym-detection intents. Competitors must be discovered from the same user task or purchase decision and then independently verified. If identity information cannot distinguish homonyms, return identityStatus=identity_insufficient and no queries.`;
    case "live_question_discovery":
      return `Search the live web for real user questions and search intents relevant to the product and its category. Build a reusable product question catalog, not a short article-topic list. Search across diverse public source types such as Q&A/community pages, forums, reviews, social discussions, search-intent pages, issue discussions, and official support communities. Use both the product name/aliases and category-level language. Distinguish genuine questions from misconception statements: a misconception question records a false belief buyers actually hold (for example assuming a license alone guarantees adoption); mark it with misconception=true and cite a source proving the misconception exists. Mark quantifiableAnswer=true only when public evidence shows the answer can be stated with concrete numbers. When productIdentity.serviceProvider exists, explicitly investigate implementation-service-provider and implementation-partner selection demand: how users select or recommend providers, which qualifications and delivery scope they check, how implementation, training, support and acceptance are evaluated, and which case evidence buyers expect. Keep product ownership separate from the provider role. Public search may prove user demand or third-party facts, but it must not overwrite the authoritative product/provider relationship or turn unverified logos and mentions into customer cases. Return 30-40 verified questions when sources permit and never exceed 40. Deduplicate semantic variants while preserving distinct intents. Keep every string concise; each question may cite at most 3 sourceUrls, 3 suggestedArticleTypes and 6 keywords. Return at most 10 queryClusters and 12 contentGaps.${faqBoardEnum}
All article types are public-facing promotional content. Treat any provider delivery, implementation, acceptance, training or support topic above as a decision-level overview only. Never require or expose project-specific deployment prerequisites, environment parameters, configuration runbooks, delivery scopes, acceptance checklists or other internal customer-project artifacts.
Return JSON with:
{"questions":[{"text":"","intent":"","audience":"","module":"","faqBoard":"uncategorized","misconception":false,"quantifiableAnswer":false,"sourceType":"community_forum|q_and_a|review|social_media|search_intent|official_support|other","sourceUrls":[],"priority":0.0,"confidence":0.0,"suggestedArticleTypes":[],"keywords":[]}],"queryClusters":[],"contentGaps":[]}.
Every question must be a natural-language question a real user could ask, cite at least one source URL found in this run, and be grouped into a stable user-journey module such as awareness_selection, pricing_procurement, deployment_architecture, capabilities, integration, implementation_service, security_compliance, comparison, operations_support, or business_scenarios.${platformGuidance} Do not invent demand from product documentation alone. If a source only proves a product fact but not that users ask the question, exclude it from the catalog. ${claimRequirement}`;
    case "live_competitor_discovery":
      return `Identify verified competitors and how they distribute content for GEO visibility using only entity-resolved evidence. Also map the selection-alternative landscape: open-source self-build approaches and other vendors' platforms that buyers evaluate as substitutes for the same user tasks. Selection alternatives are not verified competitors; record them separately under selectionAlternatives with entityClassification=category_related and only when public evidence supports the substitution decision. When productIdentity.serviceProvider exists, also inspect the public implementation-service-provider selection landscape, but never classify the product owner, target product or its implementation provider as the same entity. Provider comparison must be supported by explicit delivery-scope or buyer-selection evidence.
Return JSON with:
{"competitors":[{"name":"","entityClassification":"verified_competitor","reason":"","overlapDimensions":[],"relationshipEvidence":"","mentionedFor":[],"contentTypes":[],"channels":[],"sourceUrls":[]}],"selectionAlternatives":[{"name":"","entityClassification":"category_related","alternativeKind":"open_source|other_vendor|internal_build","reason":"","sourceUrls":[]}],"comparisonDimensionEvidence":[{"dimension":"","evidenceStatus":"available|partial|missing","sourceUrls":[]}],"citationPatterns":[],"contentOpportunities":[]}.${comparisonDimensionEnum}${platformGuidance}
A URL proves only that a page exists. Include a competitor only when it is a distinct entity and evidence proves overlap in target users, user tasks, category or purchase decision. Same-name products, keyword overlap, search-query appearance, vague semantic resemblance and generic directory pages are never competitor evidence. Exclude homonyms completely. Every competitor requires entityClassification=verified_competitor, a non-empty relationshipEvidence, at least one overlapDimension and sourceUrls. Selection alternatives require explicit decision-relevant evidence, never keyword coincidence. ${claimRequirement}`;
    case "frontend_baseline":
      return `Act as an AI answer engine with live web search. Test representative user questions, then report exactly what the answer mentions and cites.
Return JSON with:
{"tests":[{"question":"","answerSummary":"","mentionEntityClassification":"target_match|homonym|ambiguous|not_mentioned","matchedIdentityAnchors":[],"contradictingIdentityAnchors":[],"targetMentioned":false,"competitorsMentioned":[{"name":"","entityClassification":"verified_competitor","overlapDimensions":[]}],"citedUrls":[],"claimsUsed":[]}],"aggregate":{"targetMentionRate":0.0,"competitors":[],"citationDomains":[],"channelCitationStats":[{"channelKey":"","citedUrlCount":0,"citedUrlShare":0.0,"dominantContentTypes":[]}]}}.
Count targetMentioned=true only when mentionEntityClassification=target_match and at least two non-name identity anchors match. A bare matching name is ambiguous and must not count. Include competitor mentions only when entityClassification=verified_competitor and overlapDimensions is non-empty. Homonyms must be excluded from every metric. All citedUrls must be visible entity-resolved sources from this run.${platformGuidance} Aggregate channelCitationStats from the domain of each cited URL: count how many cited URLs belong to each governed target channel, compute citedUrlShare as that channel's share of all cited URLs, and list the dominant content types (such as hands-on tutorial, comparison, faq, case study) of that channel's cited pages. When no governed channel appears in citations, return an empty channelCitationStats array. ${claimRequirement}`;
    case "evidence_alignment":
      return `Align prior user-question, competitor, frontend-answer, and citation evidence.
Return JSON with:
{"verifiedPatterns":[],"unsupportedPatterns":[],"priorityGaps":[],"recommendedArticleTypes":[],"retestRequirements":[]}.
Do not upgrade an unsupported pattern into a fact.`;
    case "blueprint_synthesis":
      return `Produce a draft GEO content strategy for human review. This is a content-strategy compilation task, not another research task.
Use the supplied inputs in this order:
1. productKnowledgeProfile and contentStrategyKnowledgeContext answer what the product already has enough governed material to write. They are the authoritative product-content inventory. sourceSnapshotHash is traceability metadata only and contains no readable facts.
2. previousOutputs and searchEvidence answer what users ask, where the target and competitors are visible, what AI answers currently cite, and which opportunities are worth covering. External pages may prove demand and visibility patterns, but they do not replace authoritative product facts.
3. existingArticleTypes answer whether an existing writing structure can carry the opportunity.
4. websiteCoverageProfile answers whether to create new content or refresh/distribute an existing official page.

First summarize the writable product-content areas supported by the knowledge context. Then connect GEO question clusters and visibility gaps to those writable areas. Only after that compare with existingArticleTypes and select 3-5 semantically distinct article types (hard maximum 6).

For each question cluster choose exactly one origin. Use matched when an existing active version already covers the user intent, audience, content goal, required structure and evidence slots. Use adapted when an existing type has the right core intent but needs product-specific modules, service-provider framing or emphasis. Use generated only when the knowledge context contains enough writable material and GEO research shows a real opportunity, but no existing type can carry the required intent and structure.

Never create a type merely because an external article uses that label. Never mark knowledge-supported product material insufficient only because the public web lacks the same article. For every type return knowledgeSupportSummary, knowledgeClaimIds, geoOpportunitySummary, existingTypeComparison, expectedMentionRationale and retestProbeRefs. Explain what the knowledge base supports, what GEO result makes the type useful, why the existing type is reused/adapted/rejected, and how the result will be retested.

Never claim that an adapted/generated version is active. Treat websiteCoverageProfile as the deterministic current-state audit of official website coverage: do not recommend a new article that merely repeats a topic marked sufficient; prefer an adjacent unanswered question, refresh/distribution work, or a missing/partial topic. A topic marked partial or missing may become a content opportunity only when contentStrategyKnowledgeContext contains relevant governed facts. A blocked publicGeoReadiness is a website remediation dependency, not a reason to produce duplicate articles. When productIdentity.serviceProvider exists, the strategy must contain one implementation-service-provider selection question cluster and one article type for choosing/recommending an implementation provider unless websiteCoverageProfile already marks provider_selection sufficient; in that case retain the question opportunity but assign the content type to refresh/distribution or an adjacent missing topic. Its definition must cover provider qualifications, delivery scope, implementation process, acceptance, training/support and evidence boundaries; it must present the provider as a service role rather than a co-branded product. A specific case may be used only when governed evidence proves the provider's involvement and outcome.
Return JSON with:
{"questionStrategy":{"priorityClusters":[{"id":"","name":"","intent":"","priority":"high|medium|low","evidenceReadiness":"ready|partial|blocked","representativeQuestions":[],"sourceIds":[]}],"journeyCoverage":[],"recommendedQuestions":[]},"competitorLandscape":{"competitors":[{"name":"","entityClassification":"verified_competitor","reason":"","overlapDimensions":[],"relationshipEvidence":"","sourceUrls":[],"evidenceStrength":"strong|moderate|weak"}],"selectionAlternatives":[{"name":"","entityClassification":"category_related","alternativeKind":"open_source|other_vendor|internal_build","reason":"","sourceUrls":[]}],"differentiationAngles":[],"contentGaps":[]},"citationStrategy":{"productClaimPolicy":"official_and_governed_sources_first","comparativeClaimPolicy":"two_sided_traceable_evidence_required","preferredSourceTypes":[],"citationPatterns":[],"sourceRequirements":[]},"contentTypeStrategy":{"writableContentAreas":[{"name":"","knowledgeClaimIds":[],"supportedAngles":[]}],"articleTypes":[{"portfolioItemId":"","origin":"matched|adapted|generated","articleTypeId":"","articleTypeVersionId":"","baseArticleTypeId":"","baseArticleTypeVersionId":"","name":"","definition":"","suitableQuestions":[],"unsuitableQuestions":[],"targetAudience":[],"contentGoal":"","structureModules":[{"key":"","purpose":"","required":true}],"emphasisOrder":[],"style":[],"lengthRange":{"min":1200,"max":2400},"evidencePreferences":[],"ctaIntent":"","channelFit":[],"questionClusterIds":[],"recommendationReason":"","knowledgeSupportSummary":"","knowledgeClaimIds":[],"geoOpportunitySummary":"","existingTypeComparison":"","expectedMentionRationale":"","retestProbeRefs":[],"confidence":0.0,"evidenceReadiness":"ready|partial|blocked","proposedMonthlyShare":0.0}]},"platformStrategy":[{"channelKey":"","objective":"","suitableArticleTypes":[],"structureRequirements":[],"titlePatterns":[],"ctaVariantRef":"","authorAccountPolicy":"","hypothesis":false,"evidenceBasis":{"candidateIds":[],"sourceUrls":[]}}],"contentClusterPlan":[{"clusterTheme":"","memberArticleTypes":[],"internalLinkRationale":""}],"evidenceRequirements":{"claimsRequiringEvidence":[],"blockedClaims":[],"sourceGaps":[]},"monthlyStrategyInput":{"objectives":[],"channelPriorities":[],"contentMix":[]},"retestBaseline":{"questions":[],"targetMentionRate":0.0,"citationDomains":[]}}.
The single promotion objective of this workbench is raising the brand/product AI mention rate; every strategy recommendation must state its expectedMentionRationale: which evidence from this run (frontend baseline gaps, competitor citation patterns, channel citation stats, question clusters) suggests the recommendation will move the mention rate. Article types must carry retestProbeRefs pointing at the retestBaseline questions they are designed to win citations on. Bold strategy hypotheses are allowed without blocking, but must carry hypothesis=true or a claimsRequiringEvidence entry.${platformGuidance} Each platformStrategy entry must ground its platform claims in evidenceBasis candidateIds/sourceUrls from this run's channel-tagged candidates; when a platform lacks sufficient evidence, keep the entry with hypothesis=true instead of inventing rules. Never inline CTA copy: reference the governed ctaVariantRef only. contentClusterPlan groups the chosen article types into internal-link clusters so each cluster can compound AI citation weight; every article type must appear in exactly one cluster.
All article types are public-facing promotional content. Treat any provider delivery, implementation, acceptance, training or support topic above as a decision-level overview only. Never require or expose project-specific deployment prerequisites, environment parameters, configuration runbooks, delivery scopes, acceptance checklists or other internal customer-project artifacts.
Every one of the eight top-level strategy modules must contain the named fields above and substantive values grounded in previous outputs. Do not return an empty object for any required module.
Each priority cluster must own a non-duplicated subset of representativeQuestions; do not repeat the full question list under every cluster. Include a competitor only when prior live evidence contains direct traceable support. Name similarity, vague possibility, or semantic resemblance is never competitor evidence. Treat comparative, architecture, pricing, ROI, compliance, and customer-case statements as claimsRequiringEvidence or blockedClaims until governed first-party evidence supports them; never present them as approved product facts. Community posts and media articles may reveal user demand but cannot independently prove a product claim. Mark an article type ready only when its required factual evidence is already available; otherwise use partial or blocked.
Missing internal delivery artifacts alone must never make a promotional article type partial or blocked. evidencePreferences must contain only the minimum public sources needed for the article's intended claims. If an existing template requires internal project artifacts or step-level configuration, adapt it into a public decision-level type instead of selecting it as matched.
For matched items, copy an exact existing articleTypeId/articleTypeVersionId. For adapted items, copy exact baseArticleTypeId/baseArticleTypeVersionId but leave articleTypeVersionId empty so the system creates a governed draft. For generated items, leave all IDs empty. Explain why each type fits, its unsuitable questions, evidence needs and boundaries.
The output is a draft only and must not claim approval or activation.`;
    default:
      return "Validate the supplied research context and return a concise JSON object.";
  }
}

const ZHIPU_SEARCH_ENGINES = new Set(["search_std", "search_pro", "search_pro_sogou", "search_pro_quark"]);
const ZHIPU_RECENCY_FILTERS = new Set(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"]);

interface ZhipuProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  searchEngine: string;
  searchCount: number;
  searchRecency: string;
  contentSize: "medium" | "high";
  maxQueries: number;
}

function extractOutputText(response: Record<string, unknown>) {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
      ? (item as { text: string }).text
      : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function parseStructuredOutput(outputText: string) {
  const normalized = outputText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  const candidates = [
    normalized,
    firstBrace >= 0 && lastBrace > firstBrace ? normalized.slice(firstBrace, lastBrace + 1) : undefined
  ].filter((value): value is string => Boolean(value));
  for (const candidate of [...new Set(candidates)]) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next strictly parseable representation before failing closed.
    }
  }
  throw new V5GovernanceRepositoryError(
    "research_provider_invalid_output",
    "联网研究 Provider 未返回可校验的 JSON 结果。",
    502,
    "检查模型与提示词配置后重试当前任务；不要把非结构化文本写入研究蓝图。"
  );
}

function assertProviderConfig() {
  const apiKey = process.env.GEO_RESEARCH_ZHIPU_API_KEY?.trim();
  const model = process.env.GEO_RESEARCH_ZHIPU_MODEL?.trim();
  const baseUrl = (process.env.GEO_RESEARCH_ZHIPU_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
  const searchEngine = process.env.GEO_RESEARCH_ZHIPU_SEARCH_ENGINE?.trim() || "search_pro";
  const requestedCount = Number(process.env.GEO_RESEARCH_ZHIPU_SEARCH_COUNT || 10);
  const searchRecency = process.env.GEO_RESEARCH_ZHIPU_SEARCH_RECENCY?.trim() || "noLimit";
  const contentSize = process.env.GEO_RESEARCH_ZHIPU_CONTENT_SIZE?.trim() === "medium" ? "medium" : "high";
  const requestedMaxQueries = Number(process.env.GEO_RESEARCH_ZHIPU_MAX_QUERIES || 6);
  const missing = [
    !apiKey ? "GEO_RESEARCH_ZHIPU_API_KEY" : undefined,
    !model ? "GEO_RESEARCH_ZHIPU_MODEL" : undefined
  ].filter((item): item is string => Boolean(item));
  if (!ZHIPU_SEARCH_ENGINES.has(searchEngine)) missing.push("GEO_RESEARCH_ZHIPU_SEARCH_ENGINE");
  if (!ZHIPU_RECENCY_FILTERS.has(searchRecency)) missing.push("GEO_RESEARCH_ZHIPU_SEARCH_RECENCY");
  if (missing.length) {
    throw new V5GovernanceRepositoryError(
      "pending_config",
      `GEO 联网研究 Provider 尚未配置：${missing.join(", ")}`,
      503,
      "配置智谱 API Key、GLM 模型和 Web Search 参数后重新执行任务。"
    );
  }
  return {
    apiKey: apiKey as string,
    model: model as string,
    baseUrl,
    searchEngine,
    searchCount: Number.isFinite(requestedCount) ? Math.min(50, Math.max(1, Math.floor(requestedCount))) : 10,
    searchRecency,
    contentSize,
    maxQueries: Number.isFinite(requestedMaxQueries) ? Math.min(6, Math.max(1, Math.floor(requestedMaxQueries))) : 6
  } satisfies ZhipuProviderConfig;
}

function buildSearchQueries(identity: GeoProductIdentityCard, taskType: GeoResearchTaskType, maxQueries: number, targetChannels: string[]) {
  return compileIdentityAnchoredQueries({
    taskType,
    identity,
    maxQueries,
    channelRules: targetChannelRules(targetChannels)
  });
}

/** 按证据缺口推断补充轮方向：目标平台全部无样本时优先补平台格局，否则补独立来源 */
export function inferSupplementaryGap(pack: MultiSearchEvidencePack, targetChannelKeys: string[], round: 1 | 2): GeoSupplementaryGap {
  const stats = pack.channelStats || {};
  const channelKeys = [...new Set(targetChannelKeys.filter(Boolean))];
  const platformEmpty = channelKeys.length > 0
    && channelKeys.every((channelKey) => (stats[channelKey]?.candidateCount || 0) === 0);
  if (platformEmpty && round === 1) return "platform_evidence";
  return "independent_sources";
}

function buildSupplementaryQueries(
  identity: GeoProductIdentityCard,
  taskType: GeoResearchTaskType,
  round: 1 | 2,
  evidenceGap: GeoSupplementaryGap,
  targetChannels: string[]
) {
  return compileIdentityAnchoredQueries({
    taskType,
    identity,
    maxQueries: 1,
    round,
    channelRules: targetChannelRules(targetChannels),
    evidenceGap
  });
}

async function requestZhipu(
  config: ZhipuProviderConfig,
  path: "/web_search" | "/chat/completions",
  body: Record<string, unknown>,
  signal: AbortSignal
) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    throw new V5GovernanceRepositoryError(
      "research_provider_unreachable",
      error instanceof Error ? `智谱 GEO 联网研究请求失败：${error.message}` : "智谱 GEO 联网研究请求失败。",
      502
    );
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error && typeof payload.error === "object"
      ? (payload.error as { message?: unknown }).message
      : undefined;
    throw new V5GovernanceRepositoryError(
      "research_provider_failed",
      typeof providerError === "string"
        ? `智谱 GEO 联网研究返回错误：${providerError}`
        : `智谱 GEO 联网研究返回 HTTP ${response.status}。`,
      502
    );
  }
  return payload;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function logGeoProviderStage(stage: string, detail: Record<string, unknown>) {
  console.log(JSON.stringify({
    event: "geo_research_provider_stage",
    stage,
    timestamp: new Date().toISOString(),
    ...detail
  }));
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

export function buildGeoEntityResolutionBatches(
  candidates: GeoSearchEvidenceCandidate[],
  batchSize = boundedInteger(process.env.GEO_ENTITY_RESOLUTION_BATCH_SIZE, 12, 4, 30)
) {
  const boundedBatchSize = Math.min(30, Math.max(1, Math.floor(batchSize)));
  const batches: GeoSearchEvidenceCandidate[][] = [];
  for (let offset = 0; offset < candidates.length; offset += boundedBatchSize) {
    batches.push(candidates.slice(offset, offset + boundedBatchSize));
  }
  return batches;
}

export function selectGeoEntityResolutionCandidates(
  candidates: GeoSearchEvidenceCandidate[],
  maximum = boundedInteger(process.env.GEO_ENTITY_RESOLUTION_MAX_CANDIDATES, 60, 12, 120)
) {
  const boundedMaximum = Math.min(120, Math.max(1, Math.floor(maximum)));
  if (candidates.length <= boundedMaximum) return [...candidates];
  const selected: GeoSearchEvidenceCandidate[] = [];
  const selectedIds = new Set<string>();
  const append = (candidate: GeoSearchEvidenceCandidate | undefined) => {
    if (!candidate || selectedIds.has(candidate.candidateId) || selected.length >= boundedMaximum) return;
    selected.push(candidate);
    selectedIds.add(candidate.candidateId);
  };
  const queryIds = [...new Set(candidates.flatMap((candidate) => candidate.queryIds))].sort();
  for (const queryId of queryIds) append(candidates.find((candidate) => candidate.queryIds.includes(queryId)));
  for (const provider of ["zhipu", "doubao", "qwen"] as const) {
    append(candidates.find((candidate) => candidate.providerKeys.includes(provider)));
  }
  for (const candidate of candidates) append(candidate);
  return selected;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
) {
  if (values.length === 0) return [] as R[];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, concurrency));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  }));
  return results;
}

async function requestEntityResolutionBatch(input: {
  config: ZhipuProviderConfig;
  taskType: GeoResearchTaskType;
  identity: GeoProductIdentityCard;
  candidates: GeoSearchEvidenceCandidate[];
  parentSignal: AbortSignal;
  batchIndex: number;
}) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(input.parentSignal.reason);
  if (input.parentSignal.aborted) onParentAbort();
  else input.parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const batchTimeoutMs = boundedInteger(process.env.GEO_ENTITY_RESOLUTION_BATCH_TIMEOUT_MS, 45_000, 10_000, 90_000);
  const timeout = setTimeout(
    () => controller.abort(new DOMException("entity resolution batch timed out", "TimeoutError")),
    batchTimeoutMs
  );
  const startedAt = Date.now();
  try {
    const payload = await requestZhipu(input.config, "/chat/completions", {
      model: input.config.model,
      stream: false,
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a product entity-resolution gate. The supplied productIdentity is authoritative and comes from user-provided materials. Classify every candidate before any research persistence or synthesis. A matching name or alias alone is never identity evidence. Compare brand/owner, official domain, category, positioning, audiences, capabilities and scenarios. Same-name products with different ownership, category, capabilities or use cases are homonyms and must be classified homonym. A verified_competitor must be a distinct entity competing for the same user task or purchase decision, with at least one overlapDimension and explicit relationship support. Use insufficient_evidence whenever title and excerpt cannot prove a safe classification. Return strict JSON only with {"results":[{"candidateId":"","classification":"target_match|verified_competitor|category_related|user_demand|homonym|unrelated|insufficient_evidence","matchedIdentityAnchors":[],"contradictingIdentityAnchors":[],"competitorRelationshipSupported":false,"overlapDimensions":[],"confidence":0.0}]}. Return one result for every supplied candidateId and do not invent candidates.`
        },
        {
          role: "user",
          content: JSON.stringify({
            researchTask: input.taskType,
            productIdentity: input.identity,
            candidates: input.candidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              url: candidate.canonicalUrl,
              title: candidate.title || "",
              publisher: candidate.publisher || "",
              excerpt: candidate.excerpt?.slice(0, 900) || "",
              queries: candidate.queries
            }))
          })
        }
      ]
    }, controller.signal);
    const resolutions = parseEntityResolutions(payload);
    logGeoProviderStage("entity_resolution_batch_completed", {
      taskType: input.taskType,
      batchIndex: input.batchIndex,
      durationMs: Date.now() - startedAt,
      candidateCount: input.candidates.length,
      resolutionCount: resolutions.length
    });
    return { resolutions, failed: false };
  } catch (error) {
    const degradable = controller.signal.aborted
      || input.parentSignal.aborted
      || (error instanceof V5GovernanceRepositoryError && error.code === "research_provider_unreachable");
    if (!degradable) throw error;
    logGeoProviderStage("entity_resolution_batch_degraded", {
      taskType: input.taskType,
      batchIndex: input.batchIndex,
      durationMs: Date.now() - startedAt,
      candidateCount: input.candidates.length,
      failureCode: error instanceof V5GovernanceRepositoryError ? error.code : "entity_resolution_batch_timed_out"
    });
    return { resolutions: [] as GeoEntityResolution[], failed: true };
  } finally {
    clearTimeout(timeout);
    input.parentSignal.removeEventListener("abort", onParentAbort);
  }
}

function parseEntityResolutions(payload: Record<string, unknown>) {
  const parsed = parseStructuredOutput(extractOutputText(payload));
  return Array.isArray(parsed.results) ? parsed.results.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const candidateId = typeof record.candidateId === "string" ? record.candidateId : "";
    const classification = String(record.classification || "insufficient_evidence");
    if (!candidateId || ![
      "target_match", "verified_competitor", "category_related", "user_demand",
      "homonym", "unrelated", "insufficient_evidence"
    ].includes(classification)) return [];
    return [{
      candidateId,
      classification,
      matchedIdentityAnchors: strings(record.matchedIdentityAnchors),
      contradictingIdentityAnchors: strings(record.contradictingIdentityAnchors),
      competitorRelationshipSupported: record.competitorRelationshipSupported === true,
      overlapDimensions: strings(record.overlapDimensions),
      confidence: typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0
    } as GeoEntityResolution];
  }) : [];
}

export function mergeQuestionDiscoveryShardOutputs(payloads: Record<string, unknown>[]) {
  const outputs = payloads.map((payload) => parseStructuredOutput(extractOutputText(payload)));
  const uniqueItems = (field: string, maximum: number) => {
    const values = outputs.flatMap((output) => Array.isArray(output[field]) ? output[field] : []);
    const seen = new Set<string>();
    return values.filter((value) => {
      const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
      const identity = typeof value === "string"
        ? value
        : [record?.text, record?.claim, record?.name, record?.id, record?.pattern]
            .find((candidate) => typeof candidate === "string") || JSON.stringify(value);
      const key = String(identity).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maximum);
  };
  return {
    questions: uniqueItems("questions", 40),
    queryClusters: uniqueItems("queryClusters", 10),
    contentGaps: uniqueItems("contentGaps", 12),
    claimAssessments: uniqueItems("claimAssessments", 80)
  };
}

export function buildDegradedFrontendBaseline(input: {
  queries: GeoSearchQuery[];
  candidates: GeoSearchEvidenceCandidate[];
}) {
  const fallbackCandidates = input.candidates.filter((candidate) =>
    candidate.providerKeys.some((provider) => provider === "doubao" || provider === "qwen")
  );
  const tests = input.queries.map((query) => {
    const candidates = fallbackCandidates.filter((candidate) => candidate.queryIds.includes(query.queryId));
    const targetMatches = candidates.filter((candidate) =>
      candidate.entityClassification === "target_match"
      && (candidate.matchedIdentityAnchors || []).filter((anchor) => !/^name|alias$/i.test(anchor)).length >= 2
    );
    return {
      question: query.query,
      answerSummary: targetMatches.length > 0
        ? "豆包或千问的联网结果中出现了与目标产品身份一致的可核验来源。"
        : "豆包和千问的联网结果中未发现满足目标产品身份门禁的可计入提及。",
      mentionEntityClassification: targetMatches.length > 0 ? "target_match" : "not_mentioned",
      matchedIdentityAnchors: [...new Set(targetMatches.flatMap((candidate) => candidate.matchedIdentityAnchors || []))],
      contradictingIdentityAnchors: [],
      targetMentioned: targetMatches.length > 0,
      competitorsMentioned: [],
      citedUrls: candidates.slice(0, 5).map((candidate) => candidate.canonicalUrl),
      claimsUsed: []
    };
  });
  const citationDomains = [...new Set(tests.flatMap((item) => item.citedUrls).flatMap((url) => {
    try {
      return [new URL(url).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }))];
  return {
    tests,
    aggregate: {
      targetMentionRate: tests.length > 0
        ? tests.filter((item) => item.targetMentioned).length / tests.length
        : 0,
      competitors: [],
      citationDomains
    },
    claimAssessments: [],
    degraded: true,
    degradedReason: "zhipu_semantic_output_invalid",
    fallbackProviders: ["doubao", "qwen"]
  };
}

async function resolveSearchEvidencePack(input: {
  config: ZhipuProviderConfig;
  taskType: GeoResearchTaskType;
  identity: GeoProductIdentityCard;
  evidencePack: Awaited<ReturnType<typeof runMultiProviderWebSearch>>;
  signal: AbortSignal;
}) {
  if (input.evidencePack.candidates.length === 0) {
    return applyGeoEntityResolution({
      taskType: input.taskType,
      identity: input.identity,
      pack: input.evidencePack,
      resolutions: []
    });
  }
  const candidatesToResolve = selectGeoEntityResolutionCandidates(input.evidencePack.candidates);
  const batches = buildGeoEntityResolutionBatches(candidatesToResolve);
  const concurrency = boundedInteger(process.env.GEO_ENTITY_RESOLUTION_CONCURRENCY, 1, 1, 4);
  const batchResults = await mapWithConcurrency(batches, concurrency, async (candidates, batchIndex) => requestEntityResolutionBatch({
    config: input.config,
    taskType: input.taskType,
    identity: input.identity,
    candidates,
    parentSignal: input.signal,
    batchIndex
  }));
  const resolutions = batchResults.flatMap((result) => result.resolutions);
  const resolvedPack = applyGeoEntityResolution({
    taskType: input.taskType,
    identity: input.identity,
    pack: input.evidencePack,
    resolutions
  });
  resolvedPack.gate.entityResolution = {
    inputCandidateCount: input.evidencePack.candidates.length,
    attemptedCandidateCount: candidatesToResolve.length,
    resolvedCandidateCount: resolutions.length,
    droppedCandidateCount: input.evidencePack.candidates.length - resolutions.length,
    failedBatchCount: batchResults.filter((result) => result.failed).length
  };
  return resolvedPack;
}

async function resolveSearchEvidencePackWithTimeout(
  input: Omit<Parameters<typeof resolveSearchEvidencePack>[0], "signal">,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Zhipu entity resolution timed out", "TimeoutError")),
    timeoutMs
  );
  try {
    return await resolveSearchEvidencePack({ ...input, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new V5GovernanceRepositoryError(
        "geo_entity_resolution_timed_out",
        "智谱 GEO 实体语义解析在有界时间内未完成。",
        502,
        "检查候选证据预算、批次耗时和智谱 Chat Completions 状态后重试当前任务。"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function enforceTaskEntityRules(
  taskType: GeoResearchTaskType,
  structured: Record<string, unknown>,
  identity: GeoProductIdentityCard,
  targetChannels: string[] = []
) {
  const output = structuredClone(structured);
  const isVerifiedCompetitor = (item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return record.entityClassification === "verified_competitor"
      && strings(record.overlapDimensions).length > 0
      && typeof record.relationshipEvidence === "string"
      && record.relationshipEvidence.trim().length > 0
      && strings(record.sourceUrls).length > 0;
  };
  const collectNames = (...collections: unknown[]): string[] =>
    collections.flatMap((collection) => {
      if (!Array.isArray(collection)) return [];
      return collection.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        return typeof record.name === "string" && record.name.trim() ? [record.name.trim()] : [];
      });
    });
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

  // 硬门禁（信任，fail-closed）：实体名称字段不得混入生造复合实体——品牌/服务商与产品名拼接但不在别名集合
  if (taskType === "live_competitor_discovery" || taskType === "blueprint_synthesis") {
    const namingStandard = deriveEntityNamingStandard(identity);
    const landscape = taskType === "blueprint_synthesis" ? asRecord(output.competitorLandscape) : undefined;
    const contentTypeStrategy = taskType === "blueprint_synthesis" ? asRecord(output.contentTypeStrategy) : undefined;
    const nameFields = taskType === "live_competitor_discovery"
      ? collectNames(output.competitors, output.selectionAlternatives)
      : collectNames(landscape?.competitors, landscape?.selectionAlternatives, contentTypeStrategy?.articleTypes);
    const violations = findEntityNamingViolations(nameFields, namingStandard);
    if (violations.length) {
      throw new V5GovernanceRepositoryError(
        "geo_entity_naming_violation",
        `综合输出混入生造复合实体名称（${violations.slice(0, 3).join("、")}），会破坏 AI 实体确权。`,
        422,
        "仅使用产品身份卡中的规范名称；不得把品牌方、服务商与产品名拼接成新实体，也不得混用未登记简称。"
      );
    }
    // 竞品/替代名称不得是目标产品自身（实体混淆数据级修正）
    const selfNames = new Set(namingStandard.canonicalNames.map((item) => item.toLowerCase()));
    const dropSelfNamed = (item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      return typeof record.name === "string" && selfNames.has(record.name.trim().toLowerCase());
    };
    if (Array.isArray(output.competitors)) output.competitors = output.competitors.filter((item) => !dropSelfNamed(item));
    if (Array.isArray(output.selectionAlternatives)) output.selectionAlternatives = output.selectionAlternatives.filter((item) => !dropSelfNamed(item));
    if (landscape) {
      if (Array.isArray(landscape.competitors)) landscape.competitors = landscape.competitors.filter((item) => !dropSelfNamed(item));
      if (Array.isArray(landscape.selectionAlternatives)) landscape.selectionAlternatives = landscape.selectionAlternatives.filter((item) => !dropSelfNamed(item));
      output.competitorLandscape = landscape;
    }
  }

  // 软门禁（质量，标注不拦截）：platformStrategy 渠道合法性 + 证据挂靠降级
  if (taskType === "blueprint_synthesis" && Array.isArray(output.platformStrategy)) {
    const governedChannelKeys = new Set(targetChannelRules(targetChannels).map((channel) => channel.channelKey));
    output.platformStrategy = output.platformStrategy.flatMap((item) => {
      const record = asRecord(item);
      if (!record) return [];
      // 编造渠道（引用不存在的治理渠道）属信任类：数据级删除
      if (typeof record.channelKey !== "string" || !governedChannelKeys.has(record.channelKey)) return [];
      const basis = asRecord(record.evidenceBasis);
      const hasEvidence = Boolean(
        (Array.isArray(basis?.candidateIds) && basis.candidateIds.length)
        || (Array.isArray(basis?.sourceUrls) && basis.sourceUrls.length)
      );
      if (!hasEvidence) record.hypothesis = true;
      return [record];
    });
  }

  // 软门禁（质量，标注不拦截）：无证据挂靠的成效数字自动转入 claimsRequiringEvidence
  if (taskType === "blueprint_synthesis") {
    const metricPattern = /\d+(?:\.\d+)?\s*(?:%|％|倍)/;
    const pendingClaims = new Set<string>();
    const scanMetricClaims = (text: unknown, contextLabel: string) => {
      if (typeof text !== "string") return;
      for (const sentence of text.split(/[。；;.!！?？\n]/)) {
        const trimmed = sentence.trim();
        if (trimmed && metricPattern.test(trimmed)) pendingClaims.add(`[${contextLabel}] ${trimmed}`);
      }
    };
    const strategyRecord = asRecord(output.contentTypeStrategy);
    if (Array.isArray(strategyRecord?.articleTypes)) {
      for (const item of strategyRecord.articleTypes) {
        const record = asRecord(item);
        if (record) scanMetricClaims(record.definition, `articleType:${typeof record.name === "string" ? record.name : "unnamed"}`);
      }
    }
    if (Array.isArray(output.platformStrategy)) {
      for (const item of output.platformStrategy) {
        const record = asRecord(item);
        if (record) scanMetricClaims(record.objective, `platform:${typeof record.channelKey === "string" ? record.channelKey : "unknown"}`);
      }
    }
    if (pendingClaims.size) {
      const requirements = asRecord(output.evidenceRequirements) || {};
      const existing = Array.isArray(requirements.claimsRequiringEvidence)
        ? requirements.claimsRequiringEvidence.filter((item): item is string => typeof item === "string")
        : [];
      requirements.claimsRequiringEvidence = [...new Set([...existing, ...pendingClaims])];
      output.evidenceRequirements = requirements;
    }
  }
  if (taskType === "research_planning") {
    output.identityStatus = "ready";
    output.identitySummary = {
      strongIdentityAnchors: [
        identity.brandName,
        identity.officialEntity,
        identity.officialDomain,
        identity.productCategory,
        ...identity.capabilities.slice(0, 2),
        ...identity.scenarios.slice(0, 1)
      ].filter(Boolean),
      missingIdentityFields: [],
      homonymRisks: ["名称或别名相同但品牌归属、官网、品类、能力或场景不一致的结果必须丢弃"]
    };
    output.searchQueries = ["live_question_discovery", "live_competitor_discovery", "frontend_baseline"]
      .flatMap((researchTask) => compileIdentityAnchoredQueries({
        taskType: researchTask,
        identity,
        maxQueries: 6,
        channelRules: targetChannelRules(targetChannels)
      }));
  }
  if (taskType === "live_competitor_discovery" && Array.isArray(output.competitors)) {
    output.competitors = output.competitors.filter(isVerifiedCompetitor);
  }
  if (taskType === "blueprint_synthesis"
    && output.competitorLandscape
    && typeof output.competitorLandscape === "object"
    && !Array.isArray(output.competitorLandscape)) {
    const landscape = { ...(output.competitorLandscape as Record<string, unknown>) };
    landscape.competitors = Array.isArray(landscape.competitors)
      ? landscape.competitors.filter(isVerifiedCompetitor)
      : [];
    output.competitorLandscape = landscape;
  }
  if (taskType === "frontend_baseline" && Array.isArray(output.tests)) {
    output.tests = output.tests.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = { ...(item as Record<string, unknown>) };
      const matched = strings(record.matchedIdentityAnchors).filter((anchor) => !/^name|alias$/i.test(anchor));
      record.targetMentioned = record.mentionEntityClassification === "target_match" && matched.length >= 2;
      record.competitorsMentioned = Array.isArray(record.competitorsMentioned)
        ? record.competitorsMentioned.filter((competitor) => {
            if (!competitor || typeof competitor !== "object" || Array.isArray(competitor)) return false;
            const value = competitor as Record<string, unknown>;
            return value.entityClassification === "verified_competitor" && strings(value.overlapDimensions).length > 0;
          })
        : [];
      return [record];
    });
    const tests = output.tests as Array<Record<string, unknown>>;
    const targetMentionedCount = tests.filter((item) => item.targetMentioned === true).length;
    const competitors = [...new Set(tests.flatMap((item) => Array.isArray(item.competitorsMentioned)
      ? item.competitorsMentioned.flatMap((competitor) => competitor && typeof competitor === "object"
        && typeof (competitor as Record<string, unknown>).name === "string"
        ? [String((competitor as Record<string, unknown>).name)]
        : [])
      : []))];
    const existingAggregate = output.aggregate && typeof output.aggregate === "object" && !Array.isArray(output.aggregate)
      ? output.aggregate as Record<string, unknown>
      : {};
    output.aggregate = {
      ...existingAggregate,
      targetMentionRate: tests.length ? targetMentionedCount / tests.length : 0,
      competitors
    };
  }
  return output;
}

export async function runGeoResearchProvider(context: GeoResearchProviderContext): Promise<GeoResearchProviderResult> {
  const providerTimeoutMs = Math.max(
    5_000,
    Math.min(300_000, Number(process.env.GEO_RESEARCH_PROVIDER_TIMEOUT_MS || process.env.AI_PROVIDER_TIMEOUT_MS || 300_000))
  );
  const config = assertProviderConfig();
  const productIdentity = buildGeoProductIdentityCard({
    product: context.product,
    knowledgeProfile: context.productKnowledgeProfile
  });
  assertGeoProductIdentityReady(productIdentity);
  const researchBoundary = {
    ...context.project,
    authoritativeEntityRelationship: productIdentity.entityRelationship || "未提供",
    entityInterpretationRule: "目标产品只使用 productIdentity 中的 canonicalName、displayName 和 aliases。品牌方、所有者、实施方或服务商是关系角色，不得与产品名拼接成新的产品实体。若存在 productIdentity.serviceProvider，联网检索必须包含服务商选型、资质、交付范围、实施、培训、验收与案例证据需求，并保持产品事实与服务商事实分开归因。"
  };
  const requiresLiveSearch = LIVE_SEARCH_TASKS.has(context.taskType);
  const searchController = new AbortController();
  const searchQueries = requiresLiveSearch
    ? buildSearchQueries(productIdentity, context.taskType, config.maxQueries, context.project.targetChannels)
    : [];
  const queryPlan: GeoSearchQueryPlan | undefined = requiresLiveSearch ? {
    contractVersion: "geo-search-query-plan.v2",
    productId: context.product.productId,
    researchTask: context.taskType,
    queries: searchQueries,
    maximumSupplementaryRounds: 2,
    plannedBy: "identity_compiler",
    compiledAt: new Date().toISOString()
  } : undefined;
  let completionPayload: Record<string, unknown>;
  try {
    const initialSearchStartedAt = Date.now();
    const initialSearchPack = requiresLiveSearch
      ? await runMultiProviderWebSearch({ queries: searchQueries, officialUrl: context.product.officialUrl, signal: searchController.signal })
      : undefined;
    if (initialSearchPack) {
      logGeoProviderStage("initial_search_completed", {
        taskType: context.taskType,
        durationMs: Date.now() - initialSearchStartedAt,
        candidateCount: initialSearchPack.candidates.length,
        successfulProviders: initialSearchPack.gate.successfulProviders,
        failedProviders: initialSearchPack.gate.failedProviders || [],
        degraded: initialSearchPack.gate.degraded === true
      });
    }
    const initialResolutionStartedAt = Date.now();
    let evidencePack = initialSearchPack
      ? await resolveSearchEvidencePackWithTimeout({
          config,
          taskType: context.taskType,
          identity: productIdentity,
          evidencePack: initialSearchPack
        }, providerTimeoutMs)
      : undefined;
    if (initialSearchPack && evidencePack) {
      logGeoProviderStage("initial_entity_resolution_completed", {
        taskType: context.taskType,
        durationMs: Date.now() - initialResolutionStartedAt,
        inputCandidateCount: initialSearchPack.candidates.length,
        resolvedCandidateCount: evidencePack.candidates.length,
        gateDecision: evidencePack.gate.decision
      });
    }
    if (evidencePack && evidencePack.gate.configuredProviders.length >= 2) {
      for (const round of [1, 2] as const) {
        if (evidencePack.gate.decision === "passed") break;
        const evidenceGap = inferSupplementaryGap(
          evidencePack,
          targetChannelRules(context.project.targetChannels).map((channel) => channel.channelKey),
          round
        );
        const supplementarySearchPack = await runMultiProviderWebSearch({
          queries: buildSupplementaryQueries(productIdentity, context.taskType, round, evidenceGap, context.project.targetChannels),
          officialUrl: context.product.officialUrl,
          signal: searchController.signal
        });
        const supplementary = await resolveSearchEvidencePackWithTimeout({
          config,
          taskType: context.taskType,
          identity: productIdentity,
          evidencePack: supplementarySearchPack
        }, providerTimeoutMs);
        logGeoProviderStage("supplementary_round_completed", {
          taskType: context.taskType,
          round,
          searchCandidateCount: supplementarySearchPack.candidates.length,
          resolvedCandidateCount: supplementary.candidates.length,
          gateDecision: supplementary.gate.decision
        });
        evidencePack = combineMultiSearchEvidencePacks([evidencePack, supplementary]);
      }
    }
    const liveSearchVerified = evidencePack?.gate.decision === "passed";
    if (requiresLiveSearch && !liveSearchVerified) {
      const configuredCount = evidencePack?.gate.configuredProviders.length || 0;
      throw new V5GovernanceRepositoryError(
        configuredCount < 2 ? "pending_config" : "multi_search_evidence_gate_failed",
        `三模型联网检索未通过证据门禁：${evidencePack?.gate.gaps.join("；") || "没有可核验原始来源"}。`,
        configuredCount < 2 ? 503 : 502,
        configuredCount < 2
          ? "至少配置两家联网搜索 Provider；正式 WorkBuddy 试点要求智谱、豆包、千问三家全部配置。"
          : "检查失败 Provider、检索查询与原始来源字段后重试；禁止用模型记忆替代。"
      );
    }
    const answerPack = context.taskType === "frontend_baseline" && context.probeSetSnapshot
      ? await runMultiProviderProbeAnswers({ snapshot: context.probeSetSnapshot, signal: searchController.signal, entityNames: [context.product.displayName, context.product.canonicalName, ...(context.product.aliases || [])] })
      : undefined;
    if (answerPack) {
      logGeoProviderStage("probe_answer_observations_completed", {
        taskType: context.taskType,
        observationCount: answerPack.observations.length,
        successfulObservationCount: answerPack.observations.filter((item) => item.status === "success").length,
        providerCount: new Set(answerPack.observations.map((item) => item.provider)).size
      });
    }

    const sources: GeoResearchProviderSource[] = (evidencePack?.candidates || []).map((candidate) => ({
      url: candidate.canonicalUrl,
      title: candidate.title,
      query: candidate.queries.join(" | "),
      publisher: candidate.publisher,
      publishedAt: candidate.publishedAt,
      retrievedAt: candidate.retrievedAt,
      excerpt: candidate.excerpt,
      snapshotHash: candidate.excerptHash,
      providerKeys: candidate.providerKeys,
      sourceType: candidate.sourceType,
      authority: candidate.authority,
      providerRunIds: candidate.providerRunIds,
      rawResponseRefs: candidate.rawResponseRefs,
      entityClassification: candidate.entityClassification,
      matchedIdentityAnchors: candidate.matchedIdentityAnchors,
      channelKey: candidate.channelKey
    }));
    const searchEvidence = (evidencePack?.candidates || []).slice(0, 60).map((candidate) => ({
      url: candidate.canonicalUrl,
      title: candidate.title || "未命名网页",
      publisher: candidate.publisher || "",
      publishedAt: candidate.publishedAt || "",
      excerpt: candidate.excerpt?.slice(0, 1200) || "",
      providerKeys: candidate.providerKeys,
      queryIds: candidate.queryIds,
      sourceType: candidate.sourceType,
      authority: candidate.authority,
      entityClassification: candidate.entityClassification,
      matchedIdentityAnchors: candidate.matchedIdentityAnchors,
      channelKey: candidate.channelKey
    }));
    const existingArticleTypes = context.taskType === "blueprint_synthesis"
      ? (await (await import("./article-type-service")).getActiveArticleTypeVersions()).map((item) => ({
          articleTypeId: item.profileId,
          articleTypeVersionId: item.profileVersionId,
          name: item.name,
          definition: item.semanticDescription,
          suitableQuestions: item.suitableQuestionDescription,
          unsuitableQuestions: item.unsuitableQuestionDescription,
          targetAudience: item.targetAudience,
          contentGoal: item.contentGoal,
          structureModules: item.structureModules,
          style: item.styleTraits,
          lengthRange: item.lengthRange,
          evidencePreferences: item.evidencePreferences,
          ctaIntent: item.cta,
          channelFit: item.channelHints
        }))
      : [];

    const synthesisController = new AbortController();
    const synthesisTimeout = setTimeout(() => synthesisController.abort(), providerTimeoutMs);
    try {
      const synthesisPreviousOutputs = context.taskType === "blueprint_synthesis"
        ? compactGeoBlueprintPreviousOutputs(context.previousOutputs)
        : context.previousOutputs;
      logGeoProviderStage("semantic_synthesis_started", {
        taskType: context.taskType,
        evidenceCount: searchEvidence.length,
        evidenceCharacterCount: searchEvidence.reduce((total, item) => total + item.excerpt.length, 0),
        previousOutputCount: synthesisPreviousOutputs.length,
        previousOutputCharacterCount: JSON.stringify(synthesisPreviousOutputs).length
      });
      const probeInstruction = context.probeSetSnapshot?.probes?.length ? ' Use the exact questionText values from probeSetSnapshot.probes for model observation; do not rewrite, merge, or add questions. Keep observationMode and expectedRelations as backend-only scoring metadata.' : '';
      const contentStrategyInstruction = context.taskType === "blueprint_synthesis"
        ? " For content strategy, read contentStrategyKnowledgeContext before GEO findings. The knowledge context decides what can be written; GEO findings decide what is worth covering; existingArticleTypes decide whether to reuse, adapt, or create a structure. Never treat sourceSnapshotHash as readable evidence."
        : "";
      const synthesisSystemPrompt = "You are the sole GEO semantic synthesis model. Return strict JSON only, never markdown. The supplied productIdentity, productKnowledgeProfile and contentStrategyKnowledgeContext come from governed user-provided materials and are authoritative for product facts. Use only supplied product facts, previous outputs, and entity-resolved multi-provider search evidence from this run. Name similarity alone never proves identity or competition. A brand owner, implementation partner, reseller or service provider is a relationship role and must never be merged with the target name into a new composite product entity unless that exact composite appears in productIdentity.aliases. Every cited URL must exist in searchEvidence. Provider agreement is not proof: preserve source conflicts, conditions and uncertainty. Do not approve business rules." + contentStrategyInstruction + probeInstruction;
      if (context.taskType === "live_question_discovery" && searchEvidence.length > 6) {
        const evidenceShards = Array.from(
          { length: Math.ceil(searchEvidence.length / 6) },
          (_, index) => searchEvidence.slice(index * 6, index * 6 + 6)
        );
        const shardPayloads = await mapWithConcurrency(evidenceShards, 3, async (searchEvidenceShard, shardIndex) => {
          const payload = await requestZhipu(config, "/chat/completions", {
            model: config.model,
            stream: false,
            temperature: 0.2,
            max_tokens: 6144,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: synthesisSystemPrompt },
              {
                role: "user",
                content: JSON.stringify({
                  instruction: `${taskInstruction(context.taskType, taskInstructionChannelContext(context.project.targetChannels))} This is evidence shard ${shardIndex + 1} of ${evidenceShards.length}. Return 8-14 high-confidence questions grounded only in this shard; do not attempt the full 30-40 question catalog in one shard.`,
                  productIdentity,
                  productKnowledgeProfile: context.taskType === "blueprint_synthesis" ? context.productKnowledgeProfile : undefined,
                  contentStrategyKnowledgeContext: context.taskType === "blueprint_synthesis" ? context.contentStrategyKnowledgeContext : undefined,
                  researchBoundary,
                  websiteCoverageProfile: context.websiteCoverageProfile,
                  sourceSnapshotHash: context.sourceSnapshotHash,
                  probeSetSnapshot: context.probeSetSnapshot,
                  previousOutputs: synthesisPreviousOutputs,
                  searchEvidence: searchEvidenceShard,
                  channelStats: evidencePack?.channelStats,
                  evidenceGate: evidencePack?.gate
                })
              }
            ]
          }, synthesisController.signal);
          logGeoProviderStage("question_synthesis_shard_completed", {
            taskType: context.taskType,
            shardIndex,
            evidenceCount: searchEvidenceShard.length
          });
          return payload;
        });
        const mergedQuestionCatalog = mergeQuestionDiscoveryShardOutputs(shardPayloads);
        completionPayload = {
          id: `zhipu-question-shards-${shardPayloads.length}`,
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify(mergedQuestionCatalog) }
          }]
        };
      } else {
        completionPayload = await requestZhipu(config, "/chat/completions", {
          model: config.model,
          stream: false,
          temperature: 0.2,
          max_tokens: 16384,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: synthesisSystemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                instruction: taskInstruction(context.taskType, taskInstructionChannelContext(context.project.targetChannels)),
                productIdentity,
                productKnowledgeProfile: context.taskType === "blueprint_synthesis" ? context.productKnowledgeProfile : undefined,
                contentStrategyKnowledgeContext: context.taskType === "blueprint_synthesis" ? context.contentStrategyKnowledgeContext : undefined,
                researchBoundary,
                websiteCoverageProfile: context.websiteCoverageProfile,
                sourceSnapshotHash: context.sourceSnapshotHash,
                probeSetSnapshot: context.probeSetSnapshot,
                previousOutputs: synthesisPreviousOutputs,
                existingArticleTypes,
                searchEvidence,
                channelStats: evidencePack?.channelStats,
                evidenceGate: evidencePack?.gate
              })
            }
          ]
        }, synthesisController.signal);
      }
      logGeoProviderStage("semantic_synthesis_completed", {
        taskType: context.taskType,
        responseIdPresent: typeof completionPayload.id === "string"
      });
    } catch (error) {
      if (synthesisController.signal.aborted) {
        throw new V5GovernanceRepositoryError(
          "geo_semantic_synthesis_timed_out",
          "智谱 GEO 最终语义综合在有界时间内未完成。",
          502,
          "检查进入综合阶段的证据字符数、历史输出数量和模型响应时间后重试当前任务。"
        );
      }
      throw error;
    } finally {
      clearTimeout(synthesisTimeout);
    }

    const outputText = extractOutputText(completionPayload);
    let semanticOutput: Record<string, unknown>;
    try {
      semanticOutput = parseStructuredOutput(outputText);
    } catch (error) {
      if (context.taskType === "frontend_baseline" && evidencePack) {
        semanticOutput = buildDegradedFrontendBaseline({
          queries: searchQueries,
          candidates: evidencePack.candidates
        });
        logGeoProviderStage("frontend_baseline_semantic_degraded", {
          taskType: context.taskType,
          fallbackProviders: ["doubao", "qwen"],
          candidateCount: evidencePack.candidates.length,
          outputLength: outputText.length
        });
      } else {
      const choice = Array.isArray(completionPayload.choices) && completionPayload.choices[0] && typeof completionPayload.choices[0] === "object"
        ? completionPayload.choices[0] as Record<string, unknown>
        : {};
      throw new V5GovernanceRepositoryError(
        "research_provider_invalid_output",
        `联网研究 Provider 未返回可校验的 JSON 结果（finish_reason=${String(choice.finish_reason || "unknown")}，output_length=${outputText.length}）。`,
        502,
        error instanceof V5GovernanceRepositoryError ? error.nextAction : undefined
      );
      }
    }
    const entitySafeSemanticOutput = enforceTaskEntityRules(
      context.taskType,
      semanticOutput,
      productIdentity,
      context.project.targetChannels
    );
    const citationPruning = evidencePack
      ? pruneGeoResearchCitations(entitySafeSemanticOutput, evidencePack)
      : undefined;
    const groundedSemanticOutput = citationPruning?.structured || entitySafeSemanticOutput;
    const evidenceVerification = evidencePack
      ? verifyGeoResearchEvidence(groundedSemanticOutput, evidencePack)
      : undefined;
    if (evidenceVerification?.decision === "blocked") {
      throw new V5GovernanceRepositoryError(
        "geo_evidence_verification_failed",
        `智谱语义综合未通过事实引用校验：${evidenceVerification.gaps.join("；")}`,
        502,
        "只允许引用本次三家联网搜索返回的 URL，并为每条事实结论补充 claimAssessments。"
      );
    }
    const structured = evidencePack
      ? {
          ...groundedSemanticOutput,
          researchEvidence: {
            contractVersion: evidencePack.contractVersion,
            gate: evidencePack.gate,
            verification: evidenceVerification,
            queries: evidencePack.queries,
            sourceCandidates: evidencePack.candidates.map(({ excerpt, ...candidate }) => ({
              ...candidate,
              excerptPreview: excerpt?.slice(0, 500)
            })),
            citationPruning: {
              removedInvalidUrls: citationPruning?.removedInvalidUrls || 0,
              removedUncitedItems: citationPruning?.removedUncitedItems || 0
            }
          }
        }
      : semanticOutput;
    const resultPack = answerPack && context.probeSetSnapshot
      ? buildGeoResearchResultPack({ productId: context.product.productId, researchRunId: context.probeSetSnapshot.researchRunId, sourceSnapshotId: context.probeSetSnapshot.sourceSnapshotId, snapshot: context.probeSetSnapshot, observations: answerPack.observations, structured })
      : undefined;
    const safeOutputText = JSON.stringify(structured);
    const rawResponse = { searchQueryPlan: queryPlan, multiSearchEvidencePack: evidencePack, probeAnswerObservations: answerPack?.observations || [], probeAnswerRawResponses: answerPack?.rawResponses || {}, resultPack, semanticOutput: structured };
    return {
      provider: "zhipu_synthesis",
      model: config.model,
      toolName: requiresLiveSearch ? "multi.web_search+zhipu.chat.completions" : "zhipu.chat.completions",
      responseId: typeof completionPayload.id === "string" ? completionPayload.id : undefined,
      outputText: safeOutputText,
      structured,
      sources,
      liveSearchVerified,
      rawResponse,
      answerObservations: answerPack?.observations,
      answerRawResponses: answerPack?.rawResponses,
      payloadHash: createHash("sha256").update(JSON.stringify(rawResponse)).digest("hex")
    };
  } finally {
    searchController.abort();
  }
}
