import { createHash, randomUUID } from "node:crypto";
import type { GeoResearchTaskType } from "./geo-research-contracts";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export interface GeoResearchProviderSource {
  url: string;
  title?: string;
  query?: string;
  publisher?: string;
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
  provider: "zhipu";
  model: string;
  toolName: "zhipu.web_search" | "zhipu.chat.completions";
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
  const hasApiKey = Boolean(process.env.GEO_RESEARCH_ZHIPU_API_KEY?.trim());
  const hasModel = Boolean(process.env.GEO_RESEARCH_ZHIPU_MODEL?.trim());
  const missingConfig = [
    !hasApiKey ? "GEO_RESEARCH_ZHIPU_API_KEY" : undefined,
    !hasModel ? "GEO_RESEARCH_ZHIPU_MODEL" : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    status: missingConfig.length ? "pending_config" as const : "ready" as const,
    provider: "zhipu" as const,
    liveSearchTool: "zhipu.web_search" as const,
    missingConfig
  };
}

function taskInstruction(taskType: GeoResearchTaskType) {
  switch (taskType) {
    case "research_planning":
      return `Create an executable GEO research plan. Return JSON with:
{"researchQuestions":[],"searchQueries":[],"frontendTestQuestions":[],"competitorDimensions":[],"successCriteria":[]}.
Queries must cover user questions, category alternatives, competitors, citations, and content types. For question discovery, deliberately cover search suggestions, Q&A/community discussions, reviews, social posts, implementation troubleshooting, pricing/procurement, security/compliance, integrations, and official support forums. Use product aliases and category terms, not only the canonical product name.`;
    case "live_question_discovery":
      return `Search the live web for real user questions and search intents relevant to the product and its category. Build a reusable product question catalog, not a short article-topic list. Search across diverse public source types such as Q&A/community pages, forums, reviews, social discussions, search-intent pages, issue discussions, and official support communities. Use both the product name/aliases and category-level language. Aim for broad lifecycle coverage and 30-80 verified questions when sources permit. Deduplicate semantic variants while preserving distinct intents.
Return JSON with:
{"questions":[{"text":"","intent":"","audience":"","module":"","sourceType":"community_forum|q_and_a|review|social_media|search_intent|official_support|other","sourceUrls":[],"priority":0.0,"confidence":0.0,"suggestedArticleTypes":[],"keywords":[]}],"queryClusters":[],"contentGaps":[]}.
Every question must be a natural-language question a real user could ask, cite at least one source URL found in this run, and be grouped into a stable user-journey module such as awareness_selection, pricing_procurement, deployment_architecture, capabilities, integration, implementation_service, security_compliance, comparison, operations_support, or business_scenarios. Do not invent demand from product documentation alone. If a source only proves a product fact but not that users ask the question, exclude it from the catalog.`;
    case "live_competitor_discovery":
      return `Search the live web for competitors and how they distribute content for GEO visibility.
Return JSON with:
{"competitors":[{"name":"","reason":"","mentionedFor":[],"contentTypes":[],"channels":[],"sourceUrls":[]}],"citationPatterns":[],"contentOpportunities":[]}.
Do not infer a competitor without a source URL.`;
    case "frontend_baseline":
      return `Act as an AI answer engine with live web search. Test representative user questions, then report exactly what the answer mentions and cites.
Return JSON with:
{"tests":[{"question":"","answerSummary":"","targetMentioned":false,"competitorsMentioned":[],"citedUrls":[],"claimsUsed":[]}],"aggregate":{"targetMentionRate":0.0,"competitors":[],"citationDomains":[]}}.
All citedUrls must be visible sources from this run.`;
    case "evidence_alignment":
      return `Align prior user-question, competitor, frontend-answer, and citation evidence.
Return JSON with:
{"verifiedPatterns":[],"unsupportedPatterns":[],"priorityGaps":[],"recommendedArticleTypes":[],"retestRequirements":[]}.
Do not upgrade an unsupported pattern into a fact.`;
    case "blueprint_synthesis":
      return `Produce a draft GEO content-distribution blueprint for human review.
Return JSON with:
{"questionStrategy":{},"competitorLandscape":{},"citationStrategy":{},"contentTypeStrategy":{},"evidenceRequirements":{},"monthlyStrategyInput":{},"retestBaseline":{}}.
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

interface ZhipuSearchResult {
  title?: unknown;
  content?: unknown;
  link?: unknown;
  media?: unknown;
  publish_date?: unknown;
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

function parseStructuredOutput(outputText: string) {
  const normalized = outputText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The error below deliberately blocks the task instead of accepting prose.
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
  const missing = getGeoResearchProviderReadiness().missingConfig;
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

function buildSearchQueries(context: GeoResearchProviderContext, maxQueries: number) {
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
  return Array.from(new Set(candidates.map(clipSearchQuery).filter(Boolean))).slice(0, maxQueries);
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

function searchEvidenceForPrompt(
  searchPayloads: Array<{ query: string; payload: Record<string, unknown> }>,
  sourceMap: Map<string, GeoResearchProviderSource>
) {
  const evidence: Array<Record<string, string>> = [];
  for (const { query, payload } of searchPayloads) {
    const results = Array.isArray(payload.search_result) ? payload.search_result : [];
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const result = item as ZhipuSearchResult;
      const url = typeof result.link === "string" ? result.link : "";
      if (!/^https?:\/\//i.test(url)) continue;
      const title = typeof result.title === "string" ? result.title : undefined;
      const publisher = typeof result.media === "string" ? result.media : undefined;
      sourceMap.set(url, { url, title, publisher, query });
      evidence.push({
        query,
        title: title || "未命名网页",
        url,
        publisher: publisher || "",
        publishDate: typeof result.publish_date === "string" ? result.publish_date : "",
        excerpt: typeof result.content === "string" ? result.content.slice(0, 1600) : ""
      });
    }
  }
  return evidence.slice(0, 60);
}

export async function runGeoResearchProvider(context: GeoResearchProviderContext): Promise<GeoResearchProviderResult> {
  const config = assertProviderConfig();
  const requiresLiveSearch = LIVE_SEARCH_TASKS.has(context.taskType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const searchQueries = requiresLiveSearch ? buildSearchQueries(context, config.maxQueries) : [];
  let searchPayloads: Array<{ query: string; payload: Record<string, unknown> }> = [];
  let completionPayload: Record<string, unknown>;
  try {
    searchPayloads = await Promise.all(searchQueries.map(async (query) => ({
      query,
      payload: await requestZhipu(config, "/web_search", {
        search_query: query,
        search_engine: config.searchEngine,
        search_intent: false,
        count: config.searchCount,
        search_recency_filter: config.searchRecency,
        content_size: config.contentSize,
        request_id: randomUUID(),
        user_id: "joto-geo-research"
      }, controller.signal)
    })));

    const sourceMap = new Map<string, GeoResearchProviderSource>();
    const searchEvidence = searchEvidenceForPrompt(searchPayloads, sourceMap);
    const liveSearchVerified = searchPayloads.length > 0 && sourceMap.size > 0;
    if (requiresLiveSearch && !liveSearchVerified) {
      throw new V5GovernanceRepositoryError(
        "live_search_evidence_missing",
        "任务要求联网搜索，但智谱 Web Search 没有返回可核验的来源 URL。",
        502,
        "检查搜索引擎、查询范围和账户额度后重试；禁止用模型记忆结果替代。"
      );
    }

    completionPayload = await requestZhipu(config, "/chat/completions", {
      model: config.model,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a GEO research agent. Return strict JSON only, never markdown. Use only supplied product facts, previous outputs, and search evidence from this run. Every cited URL must exist in searchEvidence. Preserve uncertainty and do not approve business rules."
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: taskInstruction(context.taskType),
            product: context.product,
            researchBoundary: context.project,
            sourceSnapshotHash: context.sourceSnapshotHash,
            previousOutputs: context.previousOutputs,
            searchEvidence
          })
        }
      ]
    }, controller.signal);

    const outputText = extractOutputText(completionPayload);
    const structured = parseStructuredOutput(outputText);
    const sources = [...sourceMap.values()];
    const rawResponse = { searchQueries, searchResponses: searchPayloads, completion: completionPayload };
    return {
      provider: "zhipu",
      model: config.model,
      toolName: requiresLiveSearch ? "zhipu.web_search" : "zhipu.chat.completions",
      responseId: typeof completionPayload.id === "string" ? completionPayload.id : undefined,
      outputText,
      structured,
      sources,
      liveSearchVerified,
      rawResponse,
      payloadHash: createHash("sha256").update(JSON.stringify(rawResponse)).digest("hex")
    };
  } finally {
    clearTimeout(timeout);
  }
}
