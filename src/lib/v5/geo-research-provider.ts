import { createHash } from "node:crypto";
import type { GeoResearchTaskType } from "./geo-research-contracts";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import {
  combineMultiSearchEvidencePacks,
  getMultiSearchProviderReadiness,
  runMultiProviderWebSearch
} from "./geo-search-adapters";
import type { GeoSearchQuery, GeoSearchQueryPlan } from "./geo-search-contracts";
import { pruneGeoResearchCitations, verifyGeoResearchEvidence } from "./geo-evidence-verifier";

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
  project: {
    expressionFocus: string;
    forbiddenFocus: string[];
    researchMarkets: string[];
    languages: string[];
    targetChannels: string[];
  };
  sourceSnapshotHash: string;
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
  payloadHash: string;
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

function taskInstruction(taskType: GeoResearchTaskType) {
  const claimRequirement = `Also return claimAssessments:[{"claim":"","stance":"supports|opposes|conditional","sourceUrls":[],"confidence":0.0}]. Include every factual conclusion that could affect strategy. Use separate supports and opposes records for conflicting evidence.`;
  switch (taskType) {
    case "research_planning":
      return `Create an executable GEO research plan. Return JSON with:
{"researchQuestions":[],"searchQueries":[{"query":"","intent":"","expectedEvidenceRole":"","freshnessRequirement":"day|week|month|year|no_limit","stopCondition":""}],"frontendTestQuestions":[],"competitorDimensions":[],"successCriteria":[]}.
Queries must cover user questions, category alternatives, competitors, citations, and content types. For question discovery, deliberately cover search suggestions, Q&A/community discussions, reviews, social posts, implementation troubleshooting, pricing/procurement, security/compliance, integrations, and official support forums. Use product aliases and category terms, not only the canonical product name.`;
    case "live_question_discovery":
      return `Search the live web for real user questions and search intents relevant to the product and its category. Build a reusable product question catalog, not a short article-topic list. Search across diverse public source types such as Q&A/community pages, forums, reviews, social discussions, search-intent pages, issue discussions, and official support communities. Use both the product name/aliases and category-level language. Return 30-40 verified questions when sources permit and never exceed 40. Deduplicate semantic variants while preserving distinct intents. Keep every string concise; each question may cite at most 3 sourceUrls, 3 suggestedArticleTypes and 6 keywords. Return at most 10 queryClusters and 12 contentGaps.
Return JSON with:
{"questions":[{"text":"","intent":"","audience":"","module":"","sourceType":"community_forum|q_and_a|review|social_media|search_intent|official_support|other","sourceUrls":[],"priority":0.0,"confidence":0.0,"suggestedArticleTypes":[],"keywords":[]}],"queryClusters":[],"contentGaps":[]}.
Every question must be a natural-language question a real user could ask, cite at least one source URL found in this run, and be grouped into a stable user-journey module such as awareness_selection, pricing_procurement, deployment_architecture, capabilities, integration, implementation_service, security_compliance, comparison, operations_support, or business_scenarios. Do not invent demand from product documentation alone. If a source only proves a product fact but not that users ask the question, exclude it from the catalog. ${claimRequirement}`;
    case "live_competitor_discovery":
      return `Search the live web for competitors and how they distribute content for GEO visibility.
Return JSON with:
{"competitors":[{"name":"","reason":"","mentionedFor":[],"contentTypes":[],"channels":[],"sourceUrls":[]}],"citationPatterns":[],"contentOpportunities":[]}.
Do not infer a competitor without a source URL. ${claimRequirement}`;
    case "frontend_baseline":
      return `Act as an AI answer engine with live web search. Test representative user questions, then report exactly what the answer mentions and cites.
Return JSON with:
{"tests":[{"question":"","answerSummary":"","targetMentioned":false,"competitorsMentioned":[],"citedUrls":[],"claimsUsed":[]}],"aggregate":{"targetMentionRate":0.0,"competitors":[],"citationDomains":[]}}.
All citedUrls must be visible sources from this run. ${claimRequirement}`;
    case "evidence_alignment":
      return `Align prior user-question, competitor, frontend-answer, and citation evidence.
Return JSON with:
{"verifiedPatterns":[],"unsupportedPatterns":[],"priorityGaps":[],"recommendedArticleTypes":[],"retestRequirements":[]}.
Do not upgrade an unsupported pattern into a fact.`;
    case "blueprint_synthesis":
      return `Produce a draft GEO content-distribution blueprint for human review. Select 3-5 semantically distinct article types (hard maximum 6). For each question cluster choose one of: matched (an existing active version already fits), adapted (an existing type needs a new product-specific version), or generated (no existing type fits). Never claim that an adapted/generated version is active.
Return JSON with:
{"questionStrategy":{"priorityClusters":[{"id":"","name":"","intent":"","priority":"high|medium|low","evidenceReadiness":"ready|partial|blocked","representativeQuestions":[],"sourceIds":[]}],"journeyCoverage":[],"recommendedQuestions":[]},"competitorLandscape":{"competitors":[{"name":"","reason":"","sourceUrls":[],"evidenceStrength":"strong|moderate|weak"}],"differentiationAngles":[],"contentGaps":[]},"citationStrategy":{"productClaimPolicy":"official_and_governed_sources_first","comparativeClaimPolicy":"two_sided_traceable_evidence_required","preferredSourceTypes":[],"citationPatterns":[],"sourceRequirements":[]},"contentTypeStrategy":{"articleTypes":[{"portfolioItemId":"","origin":"matched|adapted|generated","articleTypeId":"","articleTypeVersionId":"","baseArticleTypeId":"","baseArticleTypeVersionId":"","name":"","definition":"","suitableQuestions":[],"unsuitableQuestions":[],"targetAudience":[],"contentGoal":"","structureModules":[{"key":"","purpose":"","required":true}],"emphasisOrder":[],"style":[],"lengthRange":{"min":1200,"max":2400},"evidencePreferences":[],"ctaIntent":"","channelFit":[],"questionClusterIds":[],"recommendationReason":"","confidence":0.0,"evidenceReadiness":"ready|partial|blocked","proposedMonthlyShare":0.0}]},"evidenceRequirements":{"claimsRequiringEvidence":[],"blockedClaims":[],"sourceGaps":[]},"monthlyStrategyInput":{"objectives":[],"channelPriorities":[],"contentMix":[]},"retestBaseline":{"questions":[],"targetMentionRate":0.0,"citationDomains":[]}}.
Every one of the seven top-level strategy modules must contain the named fields above and substantive values grounded in previous outputs. Do not return an empty object for any required module.
Each priority cluster must own a non-duplicated subset of representativeQuestions; do not repeat the full question list under every cluster. Include a competitor only when prior live evidence contains direct traceable support. Name similarity, vague possibility, or semantic resemblance is never competitor evidence. Treat comparative, architecture, pricing, ROI, compliance, and customer-case statements as claimsRequiringEvidence or blockedClaims until governed first-party evidence supports them; never present them as approved product facts. Community posts and media articles may reveal user demand but cannot independently prove a product claim. Mark an article type ready only when its required factual evidence is already available; otherwise use partial or blocked.
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
  const requestedMaxQueries = Number(process.env.GEO_RESEARCH_ZHIPU_MAX_QUERIES || 3);
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
    maxQueries: Number.isFinite(requestedMaxQueries) ? Math.min(5, Math.max(1, Math.floor(requestedMaxQueries))) : 3
  } satisfies ZhipuProviderConfig;
}

function clipSearchQuery(value: string) {
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, 70).join("");
}

function buildSearchQueries(context: GeoResearchProviderContext, maxQueries: number): GeoSearchQuery[] {
  type PlannedQuery = {
    query: string;
    intent?: string;
    expectedEvidenceRole?: string;
    freshnessRequirement?: string;
    stopCondition?: string;
  };
  const product = context.product.displayName || context.product.canonicalName;
  const category = context.product.productCategory || context.project.expressionFocus || "同类产品";
  const aliases = context.product.aliases.slice(0, 2).join(" ");
  const candidates = context.taskType === "live_question_discovery"
    ? [
        `${product} ${aliases} 用户问题 社区 论坛 评价`,
        `${category} 选型 价格 部署 集成 安全 常见问题`,
        `${product} 使用 故障 实施 售后 支持`
      ]
    : context.taskType === "live_competitor_discovery"
      ? [
          `${product} 竞品 对比 替代方案`,
          `${category} 产品推荐 品牌比较`,
          `${product} 市场评价 内容渠道`
        ]
      : [
          `${product} 用户评价 常见问题`,
          `${product} ${category} 对比 推荐`,
          `${category} 选型 采购 真实体验`
        ];
  const plannedQueries = context.previousOutputs
    .filter((item) => item.taskType === "research_planning")
    .flatMap((item) => Array.isArray(item.outputSummary.searchQueries) ? item.outputSummary.searchQueries : [])
    .flatMap((item) => {
      if (typeof item === "string") return [{ query: item }];
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const query = typeof record.query === "string" ? record.query : typeof record.text === "string" ? record.text : "";
      return query ? [{
        query,
        intent: typeof record.intent === "string" ? record.intent : undefined,
        expectedEvidenceRole: typeof record.expectedEvidenceRole === "string" ? record.expectedEvidenceRole : undefined,
        freshnessRequirement: typeof record.freshnessRequirement === "string" ? record.freshnessRequirement : undefined,
        stopCondition: typeof record.stopCondition === "string" ? record.stopCondition : undefined
      }] : [];
    }) as PlannedQuery[];
  const plannedByText = new Map(plannedQueries.map((item) => [clipSearchQuery(item.query), item]));
  return Array.from(new Set([...plannedQueries.map((item) => item.query), ...candidates].map(clipSearchQuery).filter(Boolean)))
    .slice(0, maxQueries)
    .map((query, index) => {
      const planned = plannedByText.get(query);
      const freshness = planned?.freshnessRequirement;
      return ({
      queryId: `geo-query-${context.taskType}-${index + 1}`,
      query,
      intent: planned?.intent || context.taskType,
      expectedEvidenceRole: planned?.expectedEvidenceRole || (context.taskType === "live_question_discovery" ? "user_demand" : context.taskType === "live_competitor_discovery" ? "competitive_landscape" : "answer_engine_baseline"),
      freshnessRequirement: ["day", "week", "month", "year", "no_limit"].includes(String(freshness))
        ? freshness as GeoSearchQuery["freshnessRequirement"]
        : "year",
      stopCondition: planned?.stopCondition || "至少两家 Provider 返回两个独立原始 URL",
      round: 0
    });
    });
}

function buildSupplementaryQueries(context: GeoResearchProviderContext, round: 1 | 2): GeoSearchQuery[] {
  const product = context.product.displayName || context.product.canonicalName;
  const category = context.product.productCategory || context.project.expressionFocus || "同类产品";
  const suffix = round === 1 ? "官方 文档 条件 限制 来源" : "用户 争议 反例 实施 评价";
  return [{
    queryId: `geo-query-${context.taskType}-supplement-${round}`,
    query: clipSearchQuery(`${product} ${category} ${suffix}`),
    intent: "evidence_gap_resolution",
    expectedEvidenceRole: round === 1 ? "official_fact_or_limitation" : "conflict_or_independent_user_evidence",
    freshnessRequirement: "year",
    stopCondition: "补足至少两家 Provider 与两个独立原始 URL；达到第二轮后停止",
    round
  }];
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

export async function runGeoResearchProvider(context: GeoResearchProviderContext): Promise<GeoResearchProviderResult> {
  const config = assertProviderConfig();
  const requiresLiveSearch = LIVE_SEARCH_TASKS.has(context.taskType);
  const searchController = new AbortController();
  const searchTimeout = setTimeout(() => searchController.abort(), 180_000);
  const searchQueries = requiresLiveSearch ? buildSearchQueries(context, config.maxQueries) : [];
  const queryPlan: GeoSearchQueryPlan | undefined = requiresLiveSearch ? {
    contractVersion: "geo-search-query-plan.v1",
    productId: context.product.productId,
    researchTask: context.taskType,
    queries: searchQueries,
    maximumSupplementaryRounds: 2,
    plannedBy: context.previousOutputs.some((item) => item.taskType === "research_planning" && Array.isArray(item.outputSummary.searchQueries))
      ? "zhipu"
      : "deterministic_fallback",
    compiledAt: new Date().toISOString()
  } : undefined;
  let completionPayload: Record<string, unknown>;
  try {
    let evidencePack = requiresLiveSearch
      ? await runMultiProviderWebSearch({ queries: searchQueries, officialUrl: context.product.officialUrl, signal: searchController.signal })
      : undefined;
    if (evidencePack && evidencePack.gate.configuredProviders.length >= 2) {
      for (const round of [1, 2] as const) {
        if (evidencePack.gate.decision === "passed") break;
        const supplementary = await runMultiProviderWebSearch({
          queries: buildSupplementaryQueries(context, round),
          officialUrl: context.product.officialUrl,
          signal: searchController.signal
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
      authority: candidate.authority
      ,
      providerRunIds: candidate.providerRunIds,
      rawResponseRefs: candidate.rawResponseRefs
    }));
    const searchEvidence = (evidencePack?.candidates || []).slice(0, 60).map((candidate) => ({
      url: candidate.canonicalUrl,
      title: candidate.title || "未命名网页",
      publisher: candidate.publisher || "",
      publishedAt: candidate.publishedAt || "",
      excerpt: candidate.excerpt || "",
      providerKeys: candidate.providerKeys,
      queryIds: candidate.queryIds,
      sourceType: candidate.sourceType,
      authority: candidate.authority
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

    clearTimeout(searchTimeout);
    const synthesisController = new AbortController();
    const synthesisTimeout = setTimeout(() => synthesisController.abort(), 180_000);
    try {
      completionPayload = await requestZhipu(config, "/chat/completions", {
        model: config.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 16384,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are the sole GEO semantic synthesis model. Return strict JSON only, never markdown. Use only supplied product facts, previous outputs, and normalized multi-provider search evidence from this run. Every cited URL must exist in searchEvidence. Provider agreement is not proof: preserve source conflicts, conditions and uncertainty. Do not approve business rules."
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction: taskInstruction(context.taskType),
              product: context.product,
              researchBoundary: context.project,
              sourceSnapshotHash: context.sourceSnapshotHash,
              previousOutputs: context.previousOutputs,
              existingArticleTypes,
              searchEvidence,
              evidenceGate: evidencePack?.gate
            })
          }
        ]
      }, synthesisController.signal);
    } finally {
      clearTimeout(synthesisTimeout);
    }

    const outputText = extractOutputText(completionPayload);
    let semanticOutput: Record<string, unknown>;
    try {
      semanticOutput = parseStructuredOutput(outputText);
    } catch (error) {
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
    const citationPruning = evidencePack
      ? pruneGeoResearchCitations(semanticOutput, evidencePack)
      : undefined;
    const groundedSemanticOutput = citationPruning?.structured || semanticOutput;
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
    const rawResponse = { searchQueryPlan: queryPlan, multiSearchEvidencePack: evidencePack, completion: completionPayload };
    return {
      provider: "zhipu_synthesis",
      model: config.model,
      toolName: requiresLiveSearch ? "multi.web_search+zhipu.chat.completions" : "zhipu.chat.completions",
      responseId: typeof completionPayload.id === "string" ? completionPayload.id : undefined,
      outputText,
      structured,
      sources,
      liveSearchVerified,
      rawResponse,
      payloadHash: createHash("sha256").update(JSON.stringify(rawResponse)).digest("hex")
    };
  } finally {
    clearTimeout(searchTimeout);
  }
}
