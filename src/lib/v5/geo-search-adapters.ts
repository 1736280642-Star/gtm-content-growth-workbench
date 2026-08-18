import { createHash, randomUUID } from "node:crypto";
import type {
  GeoSearchEvidenceCandidate,
  GeoSearchProviderKey,
  GeoSearchProviderRun,
  GeoSearchQuery,
  MultiSearchEvidencePack
} from "./geo-search-contracts";
import type { ModelAnswerObservation } from "./geo-research-result-contracts";
import type { ProbeSetSnapshot } from "./geo-probe-contracts";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

interface ProviderConfig {
  provider: GeoSearchProviderKey;
  apiKey?: string;
  model?: string;
  baseUrl: string;
  searchEngine?: string;
  searchCount?: number;
  searchRecency?: string;
  contentSize?: "medium" | "high";
}

interface RawCandidate {
  url: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  excerpt?: string;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function providerSearchTimeoutMs() {
  return boundedInteger(
    process.env.GEO_SEARCH_PROVIDER_TIMEOUT_MS,
    boundedInteger(process.env.GEO_RESEARCH_PROVIDER_TIMEOUT_MS || process.env.AI_PROVIDER_TIMEOUT_MS, 300_000, 5_000, 300_000),
    5_000,
    300_000
  );
}

async function executeProviderQueryWithTimeout(
  config: ProviderConfig,
  query: GeoSearchQuery,
  parentSignal: AbortSignal
) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException(`${config.provider} web search timed out`, "TimeoutError")),
    providerSearchTimeoutMs()
  );
  try {
    return await executeProviderQuery(config, query, controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}

function configs(): ProviderConfig[] {
  return [
    {
      provider: "zhipu",
      apiKey: process.env.GEO_RESEARCH_ZHIPU_API_KEY?.trim(),
      model: process.env.GEO_RESEARCH_ZHIPU_MODEL?.trim(),
      baseUrl: (process.env.GEO_RESEARCH_ZHIPU_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, ""),
      searchEngine: process.env.GEO_RESEARCH_ZHIPU_SEARCH_ENGINE?.trim() || "search_pro",
      searchCount: boundedInteger(process.env.GEO_RESEARCH_ZHIPU_SEARCH_COUNT, 10, 1, 50),
      searchRecency: process.env.GEO_RESEARCH_ZHIPU_SEARCH_RECENCY?.trim() || "noLimit",
      contentSize: process.env.GEO_RESEARCH_ZHIPU_CONTENT_SIZE?.trim() === "medium" ? "medium" : "high"
    },
    {
      provider: "doubao",
      apiKey: (process.env.GEO_RESEARCH_DOUBAO_API_KEY || process.env.DOUBAO_API_KEY)?.trim(),
      model: (process.env.GEO_RESEARCH_DOUBAO_MODEL || process.env.DOUBAO_MODEL)?.trim(),
      baseUrl: (process.env.GEO_RESEARCH_DOUBAO_BASE_URL?.trim() || process.env.DOUBAO_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "")
    },
    {
      provider: "qwen",
      apiKey: (process.env.GEO_RESEARCH_QWEN_API_KEY || process.env.DASHSCOPE_API_KEY)?.trim(),
      model: (process.env.GEO_RESEARCH_QWEN_MODEL || process.env.QWEN_MODEL)?.trim(),
      baseUrl: (process.env.GEO_RESEARCH_QWEN_BASE_URL?.trim() || process.env.QWEN_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "")
    }
  ];
}

export function getMultiSearchProviderReadiness() {
  const providers = configs().map((config) => {
    const missingConfig = [
      !config.apiKey ? `GEO_RESEARCH_${config.provider.toUpperCase()}_API_KEY` : undefined,
      !config.model ? `GEO_RESEARCH_${config.provider.toUpperCase()}_MODEL` : undefined
    ].filter((item): item is string => Boolean(item));
    return { provider: config.provider, status: missingConfig.length ? "pending_config" as const : "ready" as const, missingConfig };
  });
  return {
    status: providers.every((item) => item.status === "ready") ? "ready" as const : "pending_config" as const,
    providers,
    configuredProviders: providers.filter((item) => item.status === "ready").map((item) => item.provider),
    missingConfig: providers.flatMap((item) => item.missingConfig)
  };
}

function canonicalUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    if (["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) return undefined;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|source$|share_|ref$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sourceClassification(url: string, officialUrl?: string) {
  const host = new URL(url).hostname.toLowerCase();
  const officialHost = officialUrl ? (() => { try { return new URL(officialUrl).hostname.toLowerCase(); } catch { return ""; } })() : "";
  if (officialHost && (host === officialHost || host.endsWith(`.${officialHost}`))) return { sourceType: "official" as const, authority: "high" as const };
  if (/\.(gov|edu)(\.cn)?$/.test(host) || /arxiv\.org$|doi\.org$/.test(host)) return { sourceType: "research" as const, authority: "high" as const };
  if (/zhihu|reddit|stackoverflow|stackexchange|github|gitee|v2ex|juejin|csdn/.test(host)) return { sourceType: "community" as const, authority: "medium" as const };
  if (/news|36kr|sina|sohu|qq\.com|163\.com|infoq/.test(host)) return { sourceType: "media" as const, authority: "medium" as const };
  return { sourceType: "unknown" as const, authority: "low" as const };
}

function retryDelayMs(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  const base = boundedInteger(process.env.GEO_SEARCH_PROVIDER_RETRY_BASE_MS, 750, 100, 5000);
  return Math.min(10_000, base * (2 ** attempt));
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestJson(url: string, config: ProviderConfig, body: Record<string, unknown>, signal: AbortSignal) {
  const maxRetries = boundedInteger(process.env.GEO_SEARCH_PROVIDER_MAX_RETRIES, 2, 0, 3);
  let lastResponse: Response | undefined;
  let lastPayload: Record<string, unknown> = {};
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      lastResponse = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal
      });
      lastPayload = await lastResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (lastResponse.ok) return lastPayload;
      const transient = lastResponse.status === 429 || [500, 502, 503, 504].includes(lastResponse.status);
      if (!transient || attempt === maxRetries) break;
      await waitForRetry(retryDelayMs(lastResponse, attempt), signal);
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === maxRetries) break;
      await waitForRetry(retryDelayMs(undefined, attempt), signal);
    }
  }
  if (!lastResponse) {
    throw new V5GovernanceRepositoryError(
      "geo_search_provider_unreachable",
      `${config.provider} 联网搜索请求失败：${lastError instanceof Error ? lastError.message : "网络错误"}`,
      502
    );
  }
  const errorObject = lastPayload.error && typeof lastPayload.error === "object" ? lastPayload.error as Record<string, unknown> : {};
  throw new V5GovernanceRepositoryError(
    lastResponse.status === 429 ? "geo_search_provider_rate_limited" : "geo_search_provider_failed",
    `${config.provider} 联网搜索在 ${maxRetries + 1} 次有界尝试后返回 HTTP ${lastResponse.status}${typeof errorObject.message === "string" ? `：${errorObject.message}` : ""}`,
    502
  );
}

function zhipuCandidates(payload: Record<string, unknown>): RawCandidate[] {
  const results = Array.isArray(payload.search_result) ? payload.search_result : [];
  return results.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const url = typeof item.link === "string" ? item.link : "";
    if (!canonicalUrl(url)) return [];
    return [{
      url,
      title: typeof item.title === "string" ? item.title : undefined,
      publisher: typeof item.media === "string" ? item.media : undefined,
      publishedAt: typeof item.publish_date === "string" ? item.publish_date : undefined,
      excerpt: typeof item.content === "string" ? item.content.slice(0, 2400) : undefined
    }];
  });
}

function responseCandidates(payload: Record<string, unknown>): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = value as Record<string, unknown>;
    const rawUrl = [item.url, item.link, item.uri].find((candidate) => typeof candidate === "string") as string | undefined;
    const url = rawUrl ? canonicalUrl(rawUrl) : undefined;
    if (url) {
      const excerptValue = [item.snippet, item.excerpt, item.content, item.text].find((candidate) => typeof candidate === "string") as string | undefined;
      candidates.push({
        url,
        title: typeof item.title === "string" ? item.title : undefined,
        publisher: typeof item.publisher === "string" ? item.publisher : typeof item.site_name === "string" ? item.site_name : undefined,
        publishedAt: typeof item.published_at === "string" ? item.published_at : typeof item.publish_date === "string" ? item.publish_date : undefined,
        excerpt: excerptValue?.slice(0, 2400)
      });
    }
    Object.values(item).forEach(visit);
  }
  visit(payload);
  return candidates;
}

async function executeProviderQuery(config: ProviderConfig, query: GeoSearchQuery, signal: AbortSignal) {
  if (!config.apiKey || !config.model) {
    throw new V5GovernanceRepositoryError("pending_config", `${config.provider} 联网搜索尚未配置。`, 503);
  }
  if (config.provider === "zhipu") {
    const endpoint = `${config.baseUrl}/web_search`;
    const parameters = {
      search_query: query.query,
      search_engine: config.searchEngine,
      search_intent: false,
      count: config.searchCount,
      search_recency_filter: config.searchRecency,
      content_size: config.contentSize,
      request_id: randomUUID(),
      user_id: "joto-geo-research"
    };
    const payload = await requestJson(endpoint, config, parameters, signal);
    return { payload, candidates: zhipuCandidates(payload), endpoint, parameters };
  }
  const endpoint = `${config.baseUrl}/responses`;
  const parameters = {
    model: config.model,
    input: `请联网搜索并返回与以下查询直接相关的原始网页来源：${query.query}`,
    tools: [{ type: "web_search" }],
    tool_choice: "auto"
  };
  const payload = await requestJson(endpoint, config, parameters, signal);
  return { payload, candidates: responseCandidates(payload), endpoint, parameters };
}

function toEvidenceCandidate(input: {
  raw: RawCandidate;
  provider: GeoSearchProviderKey;
  query: GeoSearchQuery;
  providerRunId: string;
  retrievedAt: string;
  officialUrl?: string;
}): GeoSearchEvidenceCandidate | undefined {
  const url = canonicalUrl(input.raw.url);
  if (!url) return undefined;
  const excerpt = input.raw.excerpt?.replace(/\s+/g, " ").trim();
  const classification = sourceClassification(url, input.officialUrl);
  return {
    candidateId: `geo-search-candidate-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`,
    canonicalUrl: url,
    title: input.raw.title,
    publisher: input.raw.publisher,
    publishedAt: input.raw.publishedAt,
    excerpt,
    excerptHash: excerpt ? createHash("sha256").update(excerpt).digest("hex") : undefined,
    contentHash: excerpt ? createHash("sha256").update(excerpt).digest("hex") : undefined,
    retrievedAt: input.retrievedAt,
    retrievalStatus: "retrieved",
    sourceType: classification.sourceType,
    authority: classification.authority,
    providerKeys: [input.provider],
    queryIds: [input.query.queryId],
    queries: [input.query.query],
    providerRunIds: [input.providerRunId],
    rawResponseRefs: [input.providerRunId]
  };
}

function mergeCandidates(values: GeoSearchEvidenceCandidate[]) {
  const byUrl = new Map<string, GeoSearchEvidenceCandidate>();
  for (const item of values) {
    const existing = byUrl.get(item.canonicalUrl);
    if (!existing) {
      byUrl.set(item.canonicalUrl, item);
      continue;
    }
    existing.providerKeys = [...new Set([...existing.providerKeys, ...item.providerKeys])].sort() as GeoSearchProviderKey[];
    existing.queryIds = [...new Set([...existing.queryIds, ...item.queryIds])].sort();
    existing.queries = [...new Set([...existing.queries, ...item.queries])];
    existing.providerRunIds = [...new Set([...existing.providerRunIds, ...item.providerRunIds])].sort();
    existing.rawResponseRefs = [...new Set([...existing.rawResponseRefs, ...item.rawResponseRefs])].sort();
    if (!existing.title && item.title) existing.title = item.title;
    if (!existing.publisher && item.publisher) existing.publisher = item.publisher;
    if (!existing.publishedAt && item.publishedAt) existing.publishedAt = item.publishedAt;
    if ((!existing.excerpt || existing.excerpt.length < (item.excerpt?.length || 0)) && item.excerpt) {
      existing.excerpt = item.excerpt;
      existing.excerptHash = item.excerptHash;
      existing.contentHash = item.contentHash;
    }
    if (item.authority === "high" || (item.authority === "medium" && existing.authority === "low")) {
      existing.authority = item.authority;
      existing.sourceType = item.sourceType;
    }
  }
  return [...byUrl.values()].sort((left, right) => {
    const score = { high: 3, medium: 2, low: 1 };
    return score[right.authority] - score[left.authority] || right.providerKeys.length - left.providerKeys.length;
  });
}

function answerTextFromPayload(payload: Record<string, unknown>): string {
  const texts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && value.length > 8) texts.push(value.trim());
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (key === 'content' || key === 'output_text' || key === 'text' || key === 'message' || key === 'choices' || key === 'output') visit(item);
    });
  };
  visit(payload);
  return [...new Set(texts)].sort((left, right) => right.length - left.length)[0] || '';
}

function answerCitations(answer: string, payload: Record<string, unknown>): string[] {
  const values = new Set<string>();
  const add = (value: unknown) => { if (typeof value !== 'string') return; for (const match of value.matchAll(/https?:\/\/[^\s\"'<>]+/g)) { const url = canonicalUrl(match[0]); if (url) values.add(url); } };
  add(answer);
  const visit = (value: unknown) => {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([key, item]) => { if (/citation|source|url|reference|annotation/i.test(key)) visit(item); });
  };
  visit(payload);
  return [...values];
}

function answerEndpoint(config: ProviderConfig) {
  return config.provider === 'zhipu' ? config.baseUrl + '/chat/completions' : config.baseUrl + '/responses';
}

function answerParameters(config: ProviderConfig, question: string) {
  if (config.provider === 'zhipu') return { model: config.model, stream: false, temperature: 0.2, messages: [{ role: 'system', content: 'Answer the user question naturally. Separate observed public evidence from uncertainty. Include source URLs when available. Do not mention this evaluation contract.' }, { role: 'user', content: question }] };
  return { model: config.model, input: question, tools: [{ type: 'web_search' }], tool_choice: 'auto' };
}

export interface GeoProbeAnswerObservationPack {
  observations: ModelAnswerObservation[];
  rawResponses: Record<string, Record<string, unknown>>;
  providerRuns: Array<{ provider: GeoSearchProviderKey; model: string; probeId: string; status: ModelAnswerObservation['status']; errorCode?: string }>;
}

export async function runMultiProviderProbeAnswers(input: { snapshot: ProbeSetSnapshot; signal: AbortSignal; entityNames?: string[] }): Promise<GeoProbeAnswerObservationPack> {
  const providerConfigs = configs();
  const observations: ModelAnswerObservation[] = [];
  const rawResponses: Record<string, Record<string, unknown>> = {};
  const providerRuns: GeoProbeAnswerObservationPack['providerRuns'] = [];
  await Promise.all(providerConfigs.flatMap((config) => input.snapshot.probes.map(async (probe) => {
    const observationId = 'geo-observation-' + randomUUID();
    const key = config.provider + ':' + probe.probeId;
    if (!config.apiKey || !config.model) {
      observations.push({ observationId, probeId: probe.probeId, provider: config.provider, model: config.model || 'unsupported', rawAnswer: '', visibleCitations: [], mentionedEntities: [], searchedAt: new Date().toISOString(), status: 'unsupported' });
      providerRuns.push({ provider: config.provider, model: config.model || 'unsupported', probeId: probe.probeId, status: 'unsupported', errorCode: 'pending_config' });
      return;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(input.signal.reason);
    if (input.signal.aborted) onAbort(); else input.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('probe answer timed out', 'TimeoutError')), providerSearchTimeoutMs());
    try {
      const payload = await requestJson(answerEndpoint(config), config, answerParameters(config, probe.questionText), controller.signal);
      const rawAnswer = answerTextFromPayload(payload);
      const visibleCitations = answerCitations(rawAnswer, payload);
      rawResponses[key] = payload;
      observations.push({ observationId, probeId: probe.probeId, provider: config.provider, model: config.model, rawAnswer, visibleCitations, mentionedEntities: (input.entityNames || []).filter((name) => rawAnswer.includes(name)), searchedAt: new Date().toISOString(), status: rawAnswer ? 'success' : 'failed' });
      providerRuns.push({ provider: config.provider, model: config.model, probeId: probe.probeId, status: rawAnswer ? 'success' : 'failed', errorCode: rawAnswer ? undefined : 'empty_answer' });
    } catch (error) {
      const pending = error instanceof V5GovernanceRepositoryError && error.code === 'pending_config';
      observations.push({ observationId, probeId: probe.probeId, provider: config.provider, model: config.model, rawAnswer: '', visibleCitations: [], mentionedEntities: [], searchedAt: new Date().toISOString(), status: pending ? 'unsupported' : 'failed' });
      providerRuns.push({ provider: config.provider, model: config.model, probeId: probe.probeId, status: pending ? 'unsupported' : 'failed', errorCode: error instanceof V5GovernanceRepositoryError ? error.code : 'probe_answer_failed' });
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener('abort', onAbort);
    }
  })));
  return { observations: observations.sort((left, right) => left.probeId.localeCompare(right.probeId) || left.provider.localeCompare(right.provider)), rawResponses, providerRuns: providerRuns.sort((left, right) => left.probeId.localeCompare(right.probeId) || left.provider.localeCompare(right.provider)) };
}

export async function runMultiProviderWebSearch(input: {
  queries: GeoSearchQuery[];
  officialUrl?: string;
  signal: AbortSignal;
}): Promise<MultiSearchEvidencePack> {
  const providerConfigs = configs();
  const providerRuns: GeoSearchProviderRun[] = [];
  const candidates: GeoSearchEvidenceCandidate[] = [];
  await Promise.all(providerConfigs.flatMap((config) => input.queries.map(async (query) => {
    const startedAt = new Date().toISOString();
    const runId = `geo-search-run-${randomUUID()}`;
    try {
      const result = await executeProviderQueryWithTimeout(config, query, input.signal);
      const completedAt = new Date().toISOString();
      const normalized = result.candidates.flatMap((raw) => {
        const item = toEvidenceCandidate({
          raw,
          provider: config.provider,
          query,
          providerRunId: runId,
          retrievedAt: completedAt,
          officialUrl: input.officialUrl
        });
        return item ? [item] : [];
      });
      candidates.push(...normalized);
      providerRuns.push({
        runId,
        provider: config.provider,
        queryId: query.queryId,
        query: query.query,
        status: "success",
        startedAt,
        completedAt,
        sourceCount: normalized.length,
        model: config.model || "unknown",
        endpoint: result.endpoint,
        round: query.round,
        parameters: result.parameters
      });
    } catch (error) {
      const pending = error instanceof V5GovernanceRepositoryError && error.code === "pending_config";
      providerRuns.push({
        runId,
        provider: config.provider,
        queryId: query.queryId,
        query: query.query,
        status: pending ? "pending_config" : "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        sourceCount: 0,
        model: config.model || "pending_config",
        endpoint: `${config.baseUrl}${config.provider === "zhipu" ? "/web_search" : "/responses"}`,
        round: query.round,
        parameters: { queryId: query.queryId },
        errorCode: error instanceof V5GovernanceRepositoryError ? error.code : "geo_search_provider_failed",
        errorMessage: error instanceof Error ? error.message : "联网搜索失败"
      });
    }
  })));
  const merged = mergeCandidates(candidates);
  const successfulProviders = [...new Set(providerRuns.filter((item) => item.status === "success" && item.sourceCount > 0).map((item) => item.provider))];
  const configuredProviders = [...new Set(providerRuns.filter((item) => item.status !== "pending_config").map((item) => item.provider))];
  const failedProviders = [...new Set(providerRuns.filter((item) => item.status === "failed").map((item) => item.provider))];
  const requiredSuccessfulProviders = 2;
  const requiredIndependentSources = 2;
  const gaps = [
    successfulProviders.length < requiredSuccessfulProviders ? `成功返回来源的 Provider 少于 ${requiredSuccessfulProviders} 家` : undefined,
    merged.length < requiredIndependentSources ? `独立原始来源少于 ${requiredIndependentSources} 个` : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    contractVersion: "geo-multi-search-evidence.v2",
    queries: input.queries,
    providerRuns: providerRuns.sort((left, right) => left.provider.localeCompare(right.provider) || left.queryId.localeCompare(right.queryId)),
    candidates: merged,
    gate: {
      decision: gaps.length ? "blocked" : "passed",
      degraded: gaps.length === 0 && failedProviders.length > 0,
      failedProviders,
      successfulProviders,
      configuredProviders,
      independentSourceCount: merged.length,
      requiredSuccessfulProviders,
      requiredIndependentSources,
      gaps
    },
    compiledAt: new Date().toISOString(),
    supplementaryRounds: Math.max(0, ...input.queries.map((item) => item.round))
  };
}

export function combineMultiSearchEvidencePacks(packs: MultiSearchEvidencePack[]): MultiSearchEvidencePack {
  const providerRuns = packs.flatMap((pack) => pack.providerRuns);
  const candidates = mergeCandidates(packs.flatMap((pack) => pack.candidates));
  const successfulProviders = [...new Set(providerRuns
    .filter((item) => item.status === "success" && item.sourceCount > 0)
    .map((item) => item.provider))];
  const configuredProviders = [...new Set(providerRuns
    .filter((item) => item.status !== "pending_config")
    .map((item) => item.provider))];
  const failedProviders = [...new Set(providerRuns
    .filter((item) => item.status === "failed")
    .map((item) => item.provider))];
  const requiredSuccessfulProviders = 2;
  const requiredIndependentSources = 2;
  const gaps = [
    successfulProviders.length < requiredSuccessfulProviders ? `成功返回来源的 Provider 少于 ${requiredSuccessfulProviders} 家` : undefined,
    candidates.length < requiredIndependentSources ? `独立原始来源少于 ${requiredIndependentSources} 个` : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    contractVersion: "geo-multi-search-evidence.v2",
    queries: packs.flatMap((pack) => pack.queries),
    providerRuns: providerRuns.sort((left, right) => left.provider.localeCompare(right.provider) || left.queryId.localeCompare(right.queryId)),
    candidates,
    gate: {
      decision: gaps.length ? "blocked" : "passed",
      degraded: gaps.length === 0 && failedProviders.length > 0,
      failedProviders,
      successfulProviders,
      configuredProviders,
      independentSourceCount: candidates.length,
      requiredSuccessfulProviders,
      requiredIndependentSources,
      gaps
    },
    compiledAt: new Date().toISOString(),
    supplementaryRounds: Math.max(0, ...packs.map((pack) => pack.supplementaryRounds))
  };
}
