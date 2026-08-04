export interface WechatSubscriptionArticle {
  url: string;
  title?: string;
  publishedAt?: string;
  content?: string;
}

interface WechatSubscriptionRecord {
  subscriptionId: string;
  name?: string;
  status?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class WechatSubscriptionAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "WechatSubscriptionAdapterError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function normalizeDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^\d{10,13}$/.test(value.trim())) return normalizeDate(Number(value.trim()));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString();
}

function nestedPayload(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  return { root, data };
}

function findArray(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  const { root, data } = nestedPayload(payload);
  if (Array.isArray(root?.data)) return root.data;
  for (const record of [root, data]) {
    if (!record) continue;
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

function paginationValue(payload: unknown, key: string) {
  const { root, data } = nestedPayload(payload);
  const pagination = asRecord(data?.pagination) || asRecord(root?.pagination) || asRecord(data?.meta) || asRecord(root?.meta);
  return data?.[key] ?? root?.[key] ?? pagination?.[key];
}

function providerUrl(baseUrl: string, path: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new WechatSubscriptionAdapterError("invalid_base_url", "微信公众号订阅服务地址不是有效 URL。");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new WechatSubscriptionAdapterError("invalid_base_url", "微信公众号订阅服务只允许 HTTP 或 HTTPS 地址。");
  }
  return new URL(path.replace(/^\/+/, ""), parsed);
}

function errorMessage(payload: unknown, fallback: string) {
  const { root, data } = nestedPayload(payload);
  return firstString(data || {}, ["message", "error", "errmsg"])
    || firstString(root || {}, ["message", "error", "errmsg"])
    || fallback;
}

async function requestJson(input: {
  url: URL;
  apiKey: string;
  fetchImpl: FetchLike;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await input.fetchImpl(input.url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        }
      });
      const payload = await response.json().catch(() => undefined);
      if (response.ok) return payload;
      const retryable = response.status >= 500;
      const message = errorMessage(payload, `微信公众号订阅服务返回 HTTP ${response.status}。`);
      if (!retryable || attempt === 1) {
        throw new WechatSubscriptionAdapterError(
          response.status === 401 || response.status === 403 ? "authentication_failed" : "provider_request_failed",
          message,
          response.status,
          retryable
        );
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof WechatSubscriptionAdapterError) throw error;
      lastError = error;
      if (attempt === 1) {
        throw new WechatSubscriptionAdapterError(
          "provider_network_error",
          error instanceof Error ? `微信公众号订阅服务请求失败：${error.message}` : "微信公众号订阅服务请求失败。",
          undefined,
          true
        );
      }
    }
  }
  throw lastError;
}

function parseSubscriptions(payload: unknown): WechatSubscriptionRecord[] {
  return findArray(payload, ["subscriptions", "items", "list", "records"]).flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const subscription = asRecord(record.subscription) || record;
    const subscriptionId = firstString(subscription, ["subscriptionId", "subscription_id", "id"]);
    if (!subscriptionId) return [];
    return [{
      subscriptionId,
      name: firstString(subscription, ["name", "accountName", "account_name", "nickname"]),
      status: firstString(subscription, ["status"])?.toLowerCase()
    }];
  });
}

function parseArticles(payload: unknown): WechatSubscriptionArticle[] {
  return findArray(payload, ["articles", "items", "list", "records"]).flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const article = asRecord(record.article) || record;
    const url = firstString(article, ["url", "articleUrl", "article_url", "link"]);
    if (!url) return [];
    return [{
      url,
      title: firstString(article, ["title", "name"]),
      publishedAt: normalizeDate(article.publishedAt ?? article.published_at ?? article.publishTime ?? article.publish_time ?? article.createTime),
      content: firstString(article, ["content", "markdown", "text"])
    }];
  });
}

function resolveSubscription(subscriptions: WechatSubscriptionRecord[], accountReference: string) {
  const normalized = accountReference.trim().toLowerCase();
  const subscription = subscriptions.find((item) => item.subscriptionId.toLowerCase() === normalized)
    || subscriptions.find((item) => item.name?.trim().toLowerCase() === normalized);
  if (!subscription) {
    throw new WechatSubscriptionAdapterError(
      "subscription_not_found",
      `未找到公众号订阅“${accountReference}”，请先在订阅服务中完成添加并等待状态变为 following。`
    );
  }
  if (subscription.status === "processing") {
    throw new WechatSubscriptionAdapterError("subscription_processing", `公众号订阅“${subscription.name || accountReference}”仍在处理中，请稍后重试。`);
  }
  if (subscription.status === "unfollowed") {
    throw new WechatSubscriptionAdapterError("subscription_unfollowed", `公众号订阅“${subscription.name || accountReference}”已取消关注。`);
  }
  return subscription;
}

export async function discoverWechatSubscriptionArticles(input: {
  baseUrl: string;
  apiKey: string;
  accountReference: string;
  startDate?: string;
  endDate?: string;
  maxArticles?: number;
  fetchImpl?: FetchLike;
}) {
  if (!input.apiKey.trim()) {
    throw new WechatSubscriptionAdapterError("missing_api_key", "微信公众号订阅服务 API Key 未配置。");
  }
  if (!input.accountReference.trim()) {
    throw new WechatSubscriptionAdapterError("missing_account_reference", "微信公众号来源缺少订阅 ID 或公众号名称。");
  }
  const fetchImpl = input.fetchImpl || fetch;
  const subscriptionsPayload = await requestJson({
    url: providerUrl(input.baseUrl, "v1/subscriptions"),
    apiKey: input.apiKey,
    fetchImpl
  });
  const subscription = resolveSubscription(parseSubscriptions(subscriptionsPayload), input.accountReference);
  const maxArticles = Math.max(1, Math.min(100, input.maxArticles || 100));
  const articles: WechatSubscriptionArticle[] = [];
  const seen = new Set<string>();
  let page = 1;

  while (articles.length < maxArticles) {
    const endpoint = providerUrl(input.baseUrl, "v1/articles");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("pageSize", String(Math.min(50, maxArticles - articles.length)));
    endpoint.searchParams.set("subscriptionId", subscription.subscriptionId);
    if (input.startDate) endpoint.searchParams.set("startDate", input.startDate);
    if (input.endDate) endpoint.searchParams.set("endDate", input.endDate);
    const payload = await requestJson({ url: endpoint, apiKey: input.apiKey, fetchImpl });
    const pageArticles = parseArticles(payload);
    for (const article of pageArticles) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
      if (articles.length >= maxArticles) break;
    }
    const hasNextPage = paginationValue(payload, "hasNextPage");
    const totalPages = Number(paginationValue(payload, "totalPages"));
    if (hasNextPage === false || (Number.isFinite(totalPages) && page >= totalPages)) break;
    if (hasNextPage !== true && !Number.isFinite(totalPages)) break;
    page += 1;
  }

  return articles;
}
