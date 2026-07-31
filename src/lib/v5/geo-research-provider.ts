import { createHash } from "node:crypto";
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
  provider: "openai";
  model: string;
  toolName: "responses.web_search" | "responses";
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
  const hasApiKey = Boolean(
    process.env.GEO_RESEARCH_OPENAI_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
  );
  const hasModel = Boolean(process.env.GEO_RESEARCH_OPENAI_MODEL?.trim());
  const missingConfig = [
    !hasApiKey ? "GEO_RESEARCH_OPENAI_API_KEY（或 OPENAI_API_KEY）" : undefined,
    !hasModel ? "GEO_RESEARCH_OPENAI_MODEL" : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    status: missingConfig.length ? "pending_config" as const : "ready" as const,
    provider: "openai" as const,
    liveSearchTool: "responses.web_search" as const,
    missingConfig
  };
}

function taskInstruction(taskType: GeoResearchTaskType) {
  switch (taskType) {
    case "research_planning":
      return `Create an executable GEO research plan. Return JSON with:
{"researchQuestions":[],"searchQueries":[],"frontendTestQuestions":[],"competitorDimensions":[],"successCriteria":[]}.
Queries must cover user questions, category alternatives, competitors, citations, and content types.`;
    case "live_question_discovery":
      return `Search the live web for real questions and search intents relevant to the product category.
Return JSON with:
{"questions":[{"text":"","intent":"","audience":"","sourceUrls":[],"priority":0.0}],"queryClusters":[],"contentGaps":[]}.
Every question must cite at least one source URL found in this run.`;
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

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        texts.push((part as { text: string }).text);
      }
    }
  }
  return texts.join("\n").trim();
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

function collectSources(value: unknown, sources: Map<string, GeoResearchProviderSource>, currentQuery?: string) {
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, sources, currentQuery);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const nextQuery = typeof record.query === "string"
    ? record.query
    : Array.isArray(record.queries) && typeof record.queries[0] === "string"
      ? record.queries[0]
      : currentQuery;
  const url = typeof record.url === "string" ? record.url : undefined;
  if (url && /^https?:\/\//i.test(url)) {
    const existing = sources.get(url);
    sources.set(url, {
      url,
      title: typeof record.title === "string" ? record.title : existing?.title,
      query: nextQuery || existing?.query,
      publisher: typeof record.publisher === "string" ? record.publisher : existing?.publisher
    });
  }
  for (const child of Object.values(record)) collectSources(child, sources, nextQuery);
}

function assertProviderConfig() {
  const apiKey = process.env.GEO_RESEARCH_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const model = process.env.GEO_RESEARCH_OPENAI_MODEL?.trim();
  const baseUrl = (process.env.GEO_RESEARCH_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const missing = getGeoResearchProviderReadiness().missingConfig;
  if (missing.length) {
    throw new V5GovernanceRepositoryError(
      "pending_config",
      `GEO 联网研究 Provider 尚未配置：${missing.join(", ")}`,
      503,
      "配置 OpenAI Responses API 凭证与模型后重新执行任务。"
    );
  }
  return { apiKey: apiKey as string, model: model as string, baseUrl };
}

export async function runGeoResearchProvider(context: GeoResearchProviderContext): Promise<GeoResearchProviderResult> {
  const config = assertProviderConfig();
  const requiresLiveSearch = LIVE_SEARCH_TASKS.has(context.taskType);
  const body: Record<string, unknown> = {
    model: config.model,
    store: false,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "You are a GEO research agent. Use only supplied product facts and evidence from this run. Return strict JSON, never markdown. Preserve uncertainty and do not approve business rules."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              instruction: taskInstruction(context.taskType),
              product: context.product,
              researchBoundary: context.project,
              sourceSnapshotHash: context.sourceSnapshotHash,
              previousOutputs: context.previousOutputs
            })
          }
        ]
      }
    ]
  };
  if (requiresLiveSearch) {
    const market = context.project.researchMarkets[0] || "CN";
    body.tools = [{
      type: "web_search",
      search_context_size: "high",
      user_location: {
        type: "approximate",
        country: /^[A-Za-z]{2}$/.test(market) ? market.toUpperCase() : "CN",
        timezone: "Asia/Shanghai"
      }
    }];
    body.max_tool_calls = 20;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new V5GovernanceRepositoryError(
      "research_provider_unreachable",
      error instanceof Error ? `GEO 联网研究请求失败：${error.message}` : "GEO 联网研究请求失败。",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error && typeof payload.error === "object"
      ? (payload.error as { message?: unknown }).message
      : undefined;
    throw new V5GovernanceRepositoryError(
      "research_provider_failed",
      typeof providerError === "string"
        ? `GEO 联网研究 Provider 返回错误：${providerError}`
        : `GEO 联网研究 Provider 返回 HTTP ${response.status}。`,
      502
    );
  }
  const outputText = extractOutputText(payload);
  const structured = parseStructuredOutput(outputText);
  const sourceMap = new Map<string, GeoResearchProviderSource>();
  collectSources(payload.output, sourceMap);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const webSearchCallCompleted = output.some((item) => (
    item && typeof item === "object"
    && String((item as { type?: unknown }).type) === "web_search_call"
    && String((item as { status?: unknown }).status) === "completed"
  ));
  const sources = [...sourceMap.values()];
  const liveSearchVerified = webSearchCallCompleted && sources.length > 0;
  if (requiresLiveSearch && !liveSearchVerified) {
    throw new V5GovernanceRepositoryError(
      "live_search_evidence_missing",
      "任务要求联网搜索，但 Provider 结果中没有可核验的搜索调用和来源 URL。",
      502,
      "检查模型是否支持 web_search，并重试；禁止用模型记忆结果替代。"
    );
  }
  return {
    provider: "openai",
    model: config.model,
    toolName: requiresLiveSearch ? "responses.web_search" : "responses",
    responseId: typeof payload.id === "string" ? payload.id : undefined,
    outputText,
    structured,
    sources,
    liveSearchVerified,
    rawResponse: payload,
    payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  };
}
