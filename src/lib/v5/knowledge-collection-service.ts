import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import { parseKnowledgeSourcesForPreview } from "@/lib/workbench-store";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import {
  appendV5FoundationAudit,
  createV5FoundationId,
  hashV5FoundationPayload,
  mutateV5FoundationState,
  readV5FoundationSnapshot,
  V5FoundationRepositoryError,
  type V5FoundationState
} from "./foundation-repository";
import type {
  V5KnowledgeCollectionGovernanceStatus,
  V5KnowledgeCollectionItemStatus,
  V5KnowledgeCollectionRun,
  V5KnowledgeCollectionSnapshot,
  V5KnowledgeCollectionSource,
  V5KnowledgeCollectionSourceType,
  V5KnowledgeEntityType
} from "./knowledge-collection-contracts";
import type { V5KnowledgeBaseWorkspace } from "./knowledge-workspace-contracts";
import { listProductRegistryRecords } from "./product-registry-repository";
import { importManagedSources } from "./rag/managed-source-import-service";
import { discoverWechatSubscriptionArticles } from "./wechat-subscription-adapter";

export const V5_KNOWLEDGE_COLLECTION_CLASSIFIER_VERSION = "knowledge-collection-classifier.v1.0.0";
const MAX_DISCOVERED_URLS = 100;
const MAX_CONTENT_LENGTH = 300_000;
const FETCH_TIMEOUT_MS = Number(process.env.KNOWLEDGE_COLLECTION_FETCH_TIMEOUT_MS || 20_000);

interface CollectionActorInput {
  actor: V5GovernanceActor;
  idempotencyKey: string;
}

interface DiscoveredArticle {
  url: string;
  title?: string;
  publishedAt?: string;
  content?: string;
}

export interface V5KnowledgeCollectionRuntime {
  discover?: (source: V5KnowledgeCollectionSource) => Promise<Array<{ url: string; title?: string; publishedAt?: string }>>;
  fetchArticle?: (input: { url: string; title?: string; source: V5KnowledgeCollectionSource }) => Promise<{ title: string; content: string }>;
}

interface ProductCandidate {
  productId: string;
  displayName: string;
  productCategory?: string;
  aliases: string[];
}

function normalizeUrl(value: string) {
  const parsed = new URL(value);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|spm$|from$|source$|share_)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

async function assertPublicUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new V5FoundationRepositoryError("invalid_source_url", "来源地址不是有效 URL。", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new V5FoundationRepositoryError("invalid_source_url", "来源地址只允许 HTTP 或 HTTPS。", 400);
  }
  if (["localhost", "0.0.0.0"].includes(parsed.hostname.toLowerCase())) {
    throw new V5FoundationRepositoryError("private_source_url", "来源地址不能指向本机或内网。", 400);
  }
  const addresses = await lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new V5FoundationRepositoryError("private_source_url", "来源地址不能指向本机、内网或保留地址。", 400);
  }
  return normalizeUrl(parsed.toString());
}

async function fetchText(url: string) {
  const safeUrl = await assertPublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeUrl, {
      signal: controller.signal,
      headers: { accept: "application/xml, application/rss+xml, application/atom+xml, text/html, application/json;q=0.9" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      url: safeUrl,
      contentType: response.headers.get("content-type") || "",
      text: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

function xmlValues(text: string, tag: string) {
  const values: string[] = [];
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "gi");
  for (const match of text.matchAll(expression)) {
    const value = match[1]?.replace(/&amp;/g, "&").trim();
    if (value) values.push(value);
  }
  return values;
}

function htmlArticleLinks(text: string, baseUrl: string) {
  const links: DiscoveredArticle[] = [];
  const expression = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(expression)) {
    try {
      const url = normalizeUrl(new URL(match[1], baseUrl).toString());
      const pathname = new URL(url).pathname;
      if (!/(article|blog|news|post|detail|\/20\d{2}\/|mp\.weixin\.qq\.com\/s)/i.test(`${url} ${pathname}`)) continue;
      const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      links.push({ url, title: title || undefined });
    } catch {
      // Invalid links are ignored; the source run keeps processing other articles.
    }
  }
  return links;
}

function atomLinks(text: string) {
  const links: string[] = [];
  const expression = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/gi;
  for (const match of text.matchAll(expression)) {
    if (/^https?:\/\//i.test(match[1])) links.push(match[1]);
  }
  return links;
}

function looksLikeArticleUrl(value: string) {
  try {
    const parsed = new URL(value);
    return /(article|blog|news|post|detail|\/20\d{2}\/|mp\.weixin\.qq\.com\/s)/i.test(`${parsed.hostname}${parsed.pathname}`)
      || /[?&](id|article_id|post_id)=/i.test(value);
  } catch {
    return false;
  }
}

function dedupeArticles(items: DiscoveredArticle[]) {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    try {
      const url = normalizeUrl(item.url);
      if (seen.has(url)) return [];
      seen.add(url);
      return [{ ...item, url }];
    } catch {
      return [];
    }
  }).slice(0, MAX_DISCOVERED_URLS);
}

export function parseKnowledgeCollectionDiscoveryDocument(input: {
  text: string;
  baseUrl: string;
  contentType?: string;
}) {
  const isXml = /xml|rss|atom/i.test(input.contentType || "") || /^\s*<\?xml|<urlset|<sitemapindex|<rss|<feed/i.test(input.text);
  if (!isXml) return dedupeArticles(htmlArticleLinks(input.text, input.baseUrl));
  const locs = xmlValues(input.text, "loc");
  const links = [...xmlValues(input.text, "link"), ...atomLinks(input.text)].filter((item) => /^https?:\/\//i.test(item));
  return dedupeArticles([...locs, ...links].filter((item) => looksLikeArticleUrl(item)).map((url) => ({ url })));
}

async function discoverFromFeedOrPage(entryUrl: string) {
  const first = await fetchText(entryUrl);
  const isXml = /xml|rss|atom/i.test(first.contentType) || /^\s*<\?xml|<urlset|<sitemapindex|<rss|<feed/i.test(first.text);
  if (isXml) {
    const locs = xmlValues(first.text, "loc");
    const feedLinks = [...xmlValues(first.text, "link"), ...atomLinks(first.text)].filter((item) => /^https?:\/\//i.test(item));
    const urls = [...locs, ...feedLinks];
    const sitemapUrls = urls.filter((item) => /sitemap.*\.xml/i.test(item));
    const articles = urls.filter((item) => !/sitemap.*\.xml/i.test(item) && looksLikeArticleUrl(item)).map((url) => ({ url }));
    for (const sitemapUrl of sitemapUrls.slice(0, 20)) {
      try {
        const nested = await fetchText(sitemapUrl);
        articles.push(...xmlValues(nested.text, "loc").filter((item) => !/sitemap.*\.xml/i.test(item) && looksLikeArticleUrl(item)).map((url) => ({ url })));
      } catch {
        // A broken child sitemap does not block healthy sitemap entries.
      }
    }
    return dedupeArticles(articles);
  }
  return dedupeArticles(htmlArticleLinks(first.text, first.url));
}

async function discoverSiteArticles(source: V5KnowledgeCollectionSource) {
  if (!source.entryUrl) throw new Error("站点来源缺少入口地址。");
  const entry = new URL(source.entryUrl);
  const candidates = [
    source.entryUrl,
    new URL("/sitemap.xml", entry.origin).toString(),
    new URL("/sitemap_index.xml", entry.origin).toString(),
    new URL("/feed", entry.origin).toString(),
    new URL("/rss.xml", entry.origin).toString()
  ];
  const collected: DiscoveredArticle[] = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      collected.push(...await discoverFromFeedOrPage(candidate));
      if (collected.length >= MAX_DISCOVERED_URLS) break;
    } catch {
      // Discovery uses multiple independent fallbacks.
    }
  }
  if (!collected.length && /(article|blog|news|post|detail)/i.test(entry.pathname)) {
    collected.push({ url: source.entryUrl });
  }
  return dedupeArticles(collected);
}

async function discoverWechatArticles(source: V5KnowledgeCollectionSource) {
  if (source.entryUrl) return discoverFromFeedOrPage(source.entryUrl);
  const baseUrl = process.env.WECHAT_COLLECTION_BASE_URL?.trim();
  const apiKey = process.env.WECHAT_COLLECTION_API_KEY?.trim();
  if (!baseUrl || !apiKey || !source.accountId) {
    throw new Error("微信公众号来源缺少订阅 ID/公众号名称，或订阅服务地址与 API Key 未配置。");
  }
  const safeBaseUrl = await assertPublicUrl(baseUrl);
  return dedupeArticles(await discoverWechatSubscriptionArticles({
    baseUrl: safeBaseUrl,
    apiKey,
    accountReference: source.accountId,
    startDate: source.lastCollectedAt,
    endDate: new Date().toISOString(),
    maxArticles: MAX_DISCOVERED_URLS
  }));
}

async function discoverArticles(source: V5KnowledgeCollectionSource) {
  return source.sourceType === "wechat_account"
    ? discoverWechatArticles(source)
    : discoverSiteArticles(source);
}

function nextCollectAt(scheduleHour: number, from = new Date()) {
  const shanghaiNow = new Date(from.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  shanghaiNow.setDate(shanghaiNow.getDate() + 1);
  shanghaiNow.setHours(scheduleHour, 0, 0, 0);
  return new Date(shanghaiNow.getTime() - 8 * 60 * 60 * 1000).toISOString();
}

function shanghaiDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function words(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase();
  return [...new Set([
    ...(normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []),
    ...(normalized.match(/[\u4e00-\u9fff]{2,12}/g) || [])
  ])];
}

function textScore(content: string, values: string[]) {
  const normalized = content.normalize("NFKC").toLowerCase();
  let score = 0;
  for (const value of values) {
    const term = value.normalize("NFKC").toLowerCase().trim();
    if (term.length < 2 || !normalized.includes(term)) continue;
    score += term.length >= 5 ? 5 : 3;
  }
  return score;
}

function resolveAiProvider(): AiProviderKey {
  const value = process.env.KNOWLEDGE_COLLECTION_AI_PROVIDER?.trim().toLowerCase();
  return value === "deepseek" || value === "doubao" ? value : "qwen";
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(candidate) as Record<string, unknown>;
}

async function loadProductCandidates(source: V5KnowledgeCollectionSource): Promise<ProductCandidate[]> {
  try {
    return (await listProductRegistryRecords()).map((item) => ({
      productId: item.productId,
      displayName: item.displayName,
      productCategory: item.productCategory,
      aliases: item.aliases
    }));
  } catch {
    return source.defaultProductId && source.defaultProductName
      ? [{ productId: source.defaultProductId, displayName: source.defaultProductName, aliases: [source.defaultProductName] }]
      : [];
  }
}

async function classifyArticle(input: {
  source: V5KnowledgeCollectionSource;
  title: string;
  url: string;
  content: string;
  knowledgeBases: V5KnowledgeBaseWorkspace[];
  products: ProductCandidate[];
}) {
  const haystack = `${input.title}\n${input.url}\n${input.content.slice(0, 20_000)}`;
  const kbRanked = input.knowledgeBases.map((item) => ({
    item,
    score: textScore(haystack, [item.name, ...words(item.focus)])
  })).sort((left, right) => right.score - left.score);
  const productRanked = input.products.map((item) => ({
    item,
    score: textScore(haystack, [item.displayName, ...item.aliases])
  })).sort((left, right) => right.score - left.score);
  let knowledgeBase = kbRanked[0]?.score > 0
    ? kbRanked[0].item
    : input.knowledgeBases.find((item) => item.knowledgeBaseId === input.source.defaultKnowledgeBaseId);
  let product = productRanked[0]?.score > 0
    ? productRanked[0].item
    : input.products.find((item) => item.productId === input.source.defaultProductId);
  let confidence = Math.min(0.96, 0.55 + Math.max(kbRanked[0]?.score || 0, productRanked[0]?.score || 0) * 0.05);
  const reasons = [
    kbRanked[0]?.score ? `知识库名称或重点命中，得分 ${kbRanked[0].score}` : "未发现明确知识库词面命中，使用来源默认知识库",
    productRanked[0]?.score ? `产品名称或别名命中，得分 ${productRanked[0].score}` : "未发现明确产品词面命中，使用来源默认实体"
  ];

  if (confidence < 0.85 && (input.knowledgeBases.length > 1 || input.products.length > 1)) {
    const result = await callAiProvider({
      provider: resolveAiProvider(),
      temperature: 0,
      systemPrompt: "你是知识归属分类器。只能从候选 ID 中选择，只返回严格 JSON，不补充事实。",
      userPrompt: JSON.stringify({
        task: "识别文章主要指向的产品、服务或其他主题，并选择归档知识库。",
        article: { title: input.title, url: input.url, content: input.content.slice(0, 12_000) },
        products: input.products.map((item) => ({ id: item.productId, name: item.displayName, category: item.productCategory, aliases: item.aliases })),
        knowledgeBases: input.knowledgeBases.map((item) => ({ id: item.knowledgeBaseId, name: item.name, focus: item.focus })),
        output: { productId: "候选产品 ID 或 null", knowledgeBaseId: "候选知识库 ID", confidence: 0.9, reason: "归属原因" }
      })
    });
    if (result.ok && result.content) {
      try {
        const value = parseJsonObject(result.content);
        const aiKnowledgeBase = input.knowledgeBases.find((item) => item.knowledgeBaseId === value.knowledgeBaseId);
        const aiProduct = input.products.find((item) => item.productId === value.productId);
        if (aiKnowledgeBase) knowledgeBase = aiKnowledgeBase;
        if (aiProduct) product = aiProduct;
        confidence = Math.max(confidence, Math.min(0.98, Math.max(0, Number(value.confidence) || 0)));
        if (typeof value.reason === "string" && value.reason.trim()) reasons.push(`语义分类：${value.reason.trim()}`);
      } catch {
        reasons.push("语义分类返回不可用，已采用确定性归属结果");
      }
    }
  }

  if (!knowledgeBase) {
    throw new Error("没有可用于自动归档的知识库。");
  }
  const entityType: V5KnowledgeEntityType = !product
    ? "other"
    : /服务|service/i.test(product.productCategory || "") ? "service" : "product";
  return {
    knowledgeBase,
    product,
    entityType,
    entityName: product?.displayName || knowledgeBase.name,
    confidence: Math.round(confidence * 100) / 100,
    reasons
  };
}

function refreshKnowledgeBaseSummary(state: V5FoundationState, knowledgeBaseId: string) {
  const knowledgeBase = state.knowledgeBases.find((item) => item.knowledgeBaseId === knowledgeBaseId);
  if (!knowledgeBase) return;
  const materials = state.knowledgeMaterials.filter((item) => item.knowledgeBaseId === knowledgeBaseId);
  knowledgeBase.materialCount = materials.length;
  knowledgeBase.productionStatus = materials.length ? "ready" : "empty";
  knowledgeBase.sourceSnapshotVersion += 1;
  knowledgeBase.sourceSnapshotHash = hashV5FoundationPayload(
    materials.map((item) => [item.materialId, item.contentHash, item.updatedAt])
  );
  knowledgeBase.rowVersion += 1;
  knowledgeBase.updatedAt = new Date().toISOString();
}

function archiveSnapshot(input: {
  snapshot: V5KnowledgeCollectionSnapshot;
  actor: V5GovernanceActor;
  previous?: V5KnowledgeCollectionSnapshot;
}) {
  const stored = mutateV5FoundationState({
    operation: "archive_knowledge_collection_snapshot",
    idempotencyKey: input.snapshot.snapshotId,
    requestHash: hashV5FoundationPayload(input.snapshot),
    mutate(state) {
      let materialId = input.previous?.materialId;
      if (input.snapshot.collectionStatus !== "failed" && input.snapshot.collectionStatus !== "unchanged") {
        const now = input.snapshot.collectedAt;
        const existing = state.knowledgeMaterials.find((item) => item.materialId === materialId)
          || state.knowledgeMaterials.find((item) => item.canonicalUrl === input.snapshot.url && item.knowledgeBaseId === input.snapshot.knowledgeBaseId);
        if (existing) {
          materialId = existing.materialId;
          existing.title = input.snapshot.title;
          existing.status = "ready";
          existing.contentHash = input.snapshot.contentHash;
          existing.collectionSourceId = input.snapshot.sourceId;
          existing.updatedAt = now;
        } else {
          materialId = createV5FoundationId("material");
          state.knowledgeMaterials.push({
            materialId,
            knowledgeBaseId: input.snapshot.knowledgeBaseId,
            title: input.snapshot.title,
            kind: "url",
            status: "ready",
            canonicalUrl: input.snapshot.url,
            contentHash: input.snapshot.contentHash,
            collectionSourceId: input.snapshot.sourceId,
            importedAt: now,
            updatedAt: now
          });
        }
        const understanding = state.knowledgeUnderstanding.find((item) => item.materialId === materialId);
        const understandingData = {
          summary: input.snapshot.excerpt,
          evidenceExcerpt: input.snapshot.content.slice(0, 800),
          materialId,
          materialTitle: input.snapshot.title,
          sourceOwner: input.snapshot.sourceName,
          visibility: "conditional_public" as const,
          trace: {
            source: "daily_collection",
            sourceIds: [input.snapshot.snapshotId],
            algorithmVersion: V5_KNOWLEDGE_COLLECTION_CLASSIFIER_VERSION,
            confidence: input.snapshot.classificationConfidence,
            recordedAt: now
          }
        };
        if (understanding) Object.assign(understanding, understandingData);
        else state.knowledgeUnderstanding.push({ understandingId: createV5FoundationId("understanding"), ...understandingData });
        refreshKnowledgeBaseSummary(state, input.snapshot.knowledgeBaseId);
      }
      const snapshot = { ...input.snapshot, materialId };
      state.knowledgeCollectionSnapshots.push(snapshot);
      state.knowledgeCollectionSnapshots = state.knowledgeCollectionSnapshots.slice(-3000);
      appendV5FoundationAudit(state, {
        action: "knowledge_collection_snapshot_archived",
        objectType: "KnowledgeCollectionSnapshot",
        objectId: snapshot.snapshotId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { snapshot };
    }
  });
  return stored.data.snapshot;
}

async function sendToManagedGovernance(input: {
  source: V5KnowledgeCollectionSource;
  title: string;
  url: string;
  content: string;
  productId?: string;
  knowledgeBaseName: string;
  contentHash: string;
  actor: V5GovernanceActor;
}) {
  if (!input.productId) {
    return { status: "archived" as V5KnowledgeCollectionGovernanceStatus, message: "已完成知识库归档；文章未识别到正式产品实体。" };
  }
  try {
    const result = await importManagedSources({
      knowledgeBaseName: input.knowledgeBaseName,
      productId: input.productId,
      authorityLevel: input.source.sourceType === "wechat_account" ? "B2" : "B1",
      publicUseConfirmed: input.source.publicUseConfirmed,
      sources: [{
        sourceKey: input.url,
        title: input.title,
        markdown: `# ${input.title}\n\n${input.content}`,
        canonicalUrl: input.url,
        rawContent: Buffer.from(input.content, "utf8"),
        mimeType: "text/plain"
      }],
      idempotencyKey: `daily-collection:${input.source.sourceId}:${input.contentHash}`,
      actor: input.actor
    });
    return {
      status: result.pipelineStatus === "queued" ? "queued" as const : "pending_config" as const,
      message: result.pipelineStatus === "queued" ? "已归档并进入治理与索引队列。" : `已归档，RAG 配置完成后继续治理：${result.missingConfiguration.join(", ")}`
    };
  } catch (error) {
    return {
      status: "pending_config" as const,
      message: error instanceof Error ? `已完成知识库归档；正式治理链路待恢复：${error.message}` : "已完成知识库归档；正式治理链路待恢复。"
    };
  }
}

function validateSourceInput(input: {
  name: string;
  sourceType: V5KnowledgeCollectionSourceType;
  entryUrl?: string;
  accountId?: string;
  defaultKnowledgeBaseId: string;
  scheduleHour?: number;
  publicUseConfirmed?: boolean;
}) {
  if (!input.name.trim() || input.name.trim().length > 120) throw new V5FoundationRepositoryError("invalid_source_name", "来源名称需为 1-120 个字符。", 400);
  if (!["site", "wechat_account"].includes(input.sourceType)) throw new V5FoundationRepositoryError("invalid_source_type", "来源类型无效。", 400);
  if (input.sourceType === "site" && !input.entryUrl?.trim()) throw new V5FoundationRepositoryError("source_url_required", "站点来源必须填写入口地址。", 400);
  if (input.sourceType === "wechat_account" && !input.entryUrl?.trim() && !input.accountId?.trim()) {
    throw new V5FoundationRepositoryError("wechat_source_required", "微信公众号来源需填写账号标识或文章列表地址。", 400);
  }
  if (!input.publicUseConfirmed) {
    throw new V5FoundationRepositoryError("public_use_not_confirmed", "来源导入前需确认内容已获授权用于知识治理和公开内容生产。", 400);
  }
  const hour = input.scheduleHour ?? 8;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new V5FoundationRepositoryError("invalid_schedule_hour", "每日采集小时需为 0-23。", 400);
}

export function listKnowledgeCollectionWorkspace() {
  const state = readV5FoundationSnapshot();
  const today = shanghaiDate(new Date());
  return {
    ok: true as const,
    status: "success" as const,
    data: {
      sources: [...state.knowledgeCollectionSources].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      todaySnapshots: state.knowledgeCollectionSnapshots
        .filter((item) => shanghaiDate(item.collectedAt) === today)
        .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt)),
      latestRuns: [...state.knowledgeCollectionRuns].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 20),
      stateVersion: state.version
    }
  };
}

export function createKnowledgeCollectionSource(input: CollectionActorInput & {
  name: string;
  sourceType: V5KnowledgeCollectionSourceType;
  entryUrl?: string;
  accountId?: string;
  defaultKnowledgeBaseId: string;
  defaultProductId?: string;
  defaultProductName?: string;
  publicUseConfirmed: boolean;
  scheduleHour?: number;
}) {
  validateSourceInput(input);
  const state = readV5FoundationSnapshot();
  if (!state.knowledgeBases.some((item) => item.knowledgeBaseId === input.defaultKnowledgeBaseId)) {
    throw new V5FoundationRepositoryError("knowledge_base_not_found", "默认归档知识库不存在。", 404);
  }
  const now = new Date().toISOString();
  const scheduleHour = input.scheduleHour ?? 8;
  const source: V5KnowledgeCollectionSource = {
    sourceId: createV5FoundationId("collection-source"),
    name: input.name.trim(),
    sourceType: input.sourceType,
    entryUrl: input.entryUrl?.trim(),
    accountId: input.accountId?.trim(),
    defaultKnowledgeBaseId: input.defaultKnowledgeBaseId,
    defaultProductId: input.defaultProductId?.trim(),
    defaultProductName: input.defaultProductName?.trim(),
    publicUseConfirmed: input.publicUseConfirmed,
    enabled: true,
    scheduleHour,
    nextCollectAt: now,
    rowVersion: 1,
    createdAt: now,
    updatedAt: now
  };
  const stored = mutateV5FoundationState({
    operation: "create_knowledge_collection_source",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({
      name: source.name,
      sourceType: source.sourceType,
      entryUrl: source.entryUrl,
      accountId: source.accountId,
      defaultKnowledgeBaseId: source.defaultKnowledgeBaseId,
      defaultProductId: source.defaultProductId,
      defaultProductName: source.defaultProductName,
      publicUseConfirmed: source.publicUseConfirmed,
      scheduleHour: source.scheduleHour
    }),
    mutate(current) {
      const duplicate = current.knowledgeCollectionSources.find((item) =>
        item.sourceType === source.sourceType
        && (item.entryUrl || "").toLowerCase() === (source.entryUrl || "").toLowerCase()
        && (item.accountId || "").toLowerCase() === (source.accountId || "").toLowerCase()
      );
      if (duplicate) throw new V5FoundationRepositoryError("duplicate_collection_source", "该来源已经导入。", 409);
      current.knowledgeCollectionSources.push(source);
      appendV5FoundationAudit(current, {
        action: "knowledge_collection_source_imported",
        objectType: "KnowledgeCollectionSource",
        objectId: source.sourceId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { source };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function updateKnowledgeCollectionSource(input: CollectionActorInput & {
  sourceId: string;
  expectedVersion: number;
  enabled?: boolean;
  scheduleHour?: number;
}) {
  if (input.scheduleHour !== undefined && (!Number.isInteger(input.scheduleHour) || input.scheduleHour < 0 || input.scheduleHour > 23)) {
    throw new V5FoundationRepositoryError("invalid_schedule_hour", "每日采集小时需为 0-23。", 400);
  }
  const stored = mutateV5FoundationState({
    operation: "update_knowledge_collection_source",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload(input),
    mutate(state) {
      const source = state.knowledgeCollectionSources.find((item) => item.sourceId === input.sourceId);
      if (!source) throw new V5FoundationRepositoryError("collection_source_not_found", "来源不存在。", 404);
      if (source.rowVersion !== input.expectedVersion) throw new V5FoundationRepositoryError("version_conflict", "来源已被其他任务更新，请刷新后重试。", 409);
      if (input.enabled !== undefined) source.enabled = input.enabled;
      if (input.scheduleHour !== undefined) source.scheduleHour = input.scheduleHour;
      source.nextCollectAt = input.enabled === true ? new Date().toISOString() : nextCollectAt(source.scheduleHour);
      source.rowVersion += 1;
      source.updatedAt = new Date().toISOString();
      appendV5FoundationAudit(state, {
        action: "knowledge_collection_source_updated",
        objectType: "KnowledgeCollectionSource",
        objectId: source.sourceId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { source };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "updated", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

async function collectSource(
  source: V5KnowledgeCollectionSource,
  actor: V5GovernanceActor,
  force: boolean,
  runtime?: V5KnowledgeCollectionRuntime
) {
  const startedAt = new Date().toISOString();
  const run: V5KnowledgeCollectionRun = {
    runId: createV5FoundationId("collection-run"),
    sourceId: source.sourceId,
    status: "running",
    discoveredCount: 0,
    collectedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    startedAt
  };
  mutateV5FoundationState({
    operation: "start_knowledge_collection_run",
    idempotencyKey: run.runId,
    requestHash: hashV5FoundationPayload(run),
    mutate(state) {
      state.knowledgeCollectionRuns.push(run);
      state.knowledgeCollectionRuns = state.knowledgeCollectionRuns.slice(-500);
      return { run };
    }
  });

  try {
    const articles = runtime?.discover ? dedupeArticles(await runtime.discover(source)) : await discoverArticles(source);
    run.discoveredCount = articles.length;
    if (!articles.length) throw new Error("未发现可采集文章，请检查入口、Sitemap、RSS 或微信公众号采集适配器。");
    const initialState = readV5FoundationSnapshot();
    const products = await loadProductCandidates(source);
    for (const article of articles) {
      const collectedAt = new Date().toISOString();
      try {
        const fetched = runtime?.fetchArticle
          ? await runtime.fetchArticle({ url: article.url, title: article.title, source })
          : article.content?.trim()
            ? { title: article.title || article.url, content: article.content }
          : await (async () => {
              const preview = await parseKnowledgeSourcesForPreview({ name: article.title || source.name, urlsText: article.url });
              const parsed = preview.data?.sources.find((item) => item.status === "parsed" && item.url && item.markdown.trim());
              if (!parsed) throw new Error(preview.message || "正文解析失败。");
              return { title: parsed.title || article.title || article.url, content: parsed.extractedText || parsed.markdown };
            })();
        const title = fetched.title.trim() || article.title || article.url;
        const content = fetched.content.trim().slice(0, MAX_CONTENT_LENGTH);
        if (content.length < 8) throw new Error("正文内容过短，无法收录。");
        const contentHash = createHash("sha256").update(content).digest("hex");
        const currentState = readV5FoundationSnapshot();
        const previous = [...currentState.knowledgeCollectionSnapshots].reverse().find((item) => item.sourceId === source.sourceId && item.url === article.url && item.collectionStatus !== "failed");
        const collectionStatus: V5KnowledgeCollectionItemStatus = previous
          ? previous.contentHash === contentHash ? "unchanged" : "updated"
          : "collected";
        const classification = await classifyArticle({
          source,
          title,
          url: article.url,
          content,
          knowledgeBases: currentState.knowledgeBases,
          products
        });
        const governance = collectionStatus === "unchanged" && !force
          ? { status: previous?.governanceStatus || "archived" as V5KnowledgeCollectionGovernanceStatus, message: "正文未变化，复用现有归档与治理结果。" }
          : await sendToManagedGovernance({
              source,
              title,
              url: article.url,
              content,
              productId: classification.product?.productId,
              knowledgeBaseName: classification.knowledgeBase.name,
              contentHash,
              actor
            });
        const snapshot: V5KnowledgeCollectionSnapshot = {
          snapshotId: createV5FoundationId("collection-snapshot"),
          runId: run.runId,
          sourceId: source.sourceId,
          sourceName: source.name,
          sourceType: source.sourceType,
          title,
          url: article.url,
          contentHash,
          content,
          excerpt: content.replace(/\s+/g, " ").slice(0, 240),
          entityType: classification.entityType,
          entityName: classification.entityName,
          productId: classification.product?.productId,
          knowledgeBaseId: classification.knowledgeBase.knowledgeBaseId,
          knowledgeBaseName: classification.knowledgeBase.name,
          classificationConfidence: classification.confidence,
          classificationReasons: classification.reasons,
          classifierVersion: V5_KNOWLEDGE_COLLECTION_CLASSIFIER_VERSION,
          collectionStatus,
          governanceStatus: governance.status,
          governanceMessage: governance.message,
          collectedAt
        };
        archiveSnapshot({ snapshot, actor, previous });
        if (collectionStatus === "collected") run.collectedCount += 1;
        else if (collectionStatus === "updated") run.updatedCount += 1;
        else run.unchangedCount += 1;
      } catch (error) {
        run.failedCount += 1;
        const fallbackKnowledgeBase = initialState.knowledgeBases.find((item) => item.knowledgeBaseId === source.defaultKnowledgeBaseId);
        archiveSnapshot({
          actor,
          snapshot: {
            snapshotId: createV5FoundationId("collection-snapshot"),
            runId: run.runId,
            sourceId: source.sourceId,
            sourceName: source.name,
            sourceType: source.sourceType,
            title: article.title || article.url,
            url: article.url,
            content: "",
            excerpt: "",
            entityType: "other",
            entityName: fallbackKnowledgeBase?.name || "其他",
            knowledgeBaseId: source.defaultKnowledgeBaseId,
            knowledgeBaseName: fallbackKnowledgeBase?.name || "其他",
            classificationConfidence: 0,
            classificationReasons: ["正文抓取或归档失败，等待下轮自动重试"],
            classifierVersion: V5_KNOWLEDGE_COLLECTION_CLASSIFIER_VERSION,
            collectionStatus: "failed",
            governanceStatus: "failed",
            governanceMessage: error instanceof Error ? error.message : "采集失败",
            collectedAt
          }
        });
      }
    }
    run.status = run.failedCount === 0 ? "success" : run.failedCount < run.discoveredCount ? "partial" : "failed";
  } catch (error) {
    run.status = "failed";
    run.errorMessage = error instanceof Error ? error.message : "来源采集失败";
  }
  run.completedAt = new Date().toISOString();
  mutateV5FoundationState({
    operation: "finish_knowledge_collection_run",
    idempotencyKey: `${run.runId}:finish`,
    requestHash: hashV5FoundationPayload(run),
    mutate(state) {
      const storedRun = state.knowledgeCollectionRuns.find((item) => item.runId === run.runId);
      if (storedRun) Object.assign(storedRun, run);
      const storedSource = state.knowledgeCollectionSources.find((item) => item.sourceId === source.sourceId);
      if (storedSource) {
        storedSource.lastStatus = run.status;
        storedSource.lastError = run.errorMessage;
        storedSource.lastCollectedAt = run.completedAt;
        storedSource.nextCollectAt = nextCollectAt(storedSource.scheduleHour);
        storedSource.rowVersion += 1;
        storedSource.updatedAt = run.completedAt || new Date().toISOString();
      }
      appendV5FoundationAudit(state, {
        action: "knowledge_collection_run_completed",
        objectType: "KnowledgeCollectionRun",
        objectId: run.runId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        actorType: actor.actorType,
        reason: actor.auditReason
      });
      return { run };
    }
  });
  return run;
}

export async function runKnowledgeCollection(input: {
  actor: V5GovernanceActor;
  sourceId?: string;
  force?: boolean;
  runtime?: V5KnowledgeCollectionRuntime;
}) {
  const now = new Date().toISOString();
  const state = readV5FoundationSnapshot();
  const sources = state.knowledgeCollectionSources.filter((item) =>
    item.enabled
    && (!input.sourceId || item.sourceId === input.sourceId)
    && (input.force || item.nextCollectAt <= now)
  );
  const runs: V5KnowledgeCollectionRun[] = [];
  for (const source of sources) runs.push(await collectSource(source, input.actor, Boolean(input.force), input.runtime));
  return {
    ok: true as const,
    status: runs.some((item) => item.status === "failed" || item.status === "partial") ? "partial" as const : "success" as const,
    data: { runs, sourceCount: sources.length }
  };
}
