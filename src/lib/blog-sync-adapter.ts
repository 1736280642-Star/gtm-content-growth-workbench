import { createHash } from "node:crypto";
import { DEFAULT_BLOG_SOURCE_URLS } from "./blog-source";
import { parseCsv, readTextInput } from "./import-utils";
import type { BlogArticle } from "./types";

export interface BlogSyncAdapterResult {
  ok: boolean;
  status: "success" | "pending_config" | "pending_input" | "failed";
  message: string;
  articles?: BlogArticle[];
  missingConfig?: string[];
  sourceErrors?: string[];
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function normalizeArticle(item: Record<string, unknown>, index: number): BlogArticle {
  const url = typeof item.url === "string" ? item.url : typeof item.loc === "string" ? item.loc : "";
  const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : url.split("/").filter(Boolean).at(-1) || `blog-${index + 1}`;

  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `blog-${hashText(url || title).slice(0, 12)}`,
    title,
    url,
    indexedStatus: item.indexedStatus === "indexed" || item.indexedStatus === "not_indexed" ? item.indexedStatus : "unknown",
    seoIssueCount: Number.isFinite(Number(item.seoIssueCount)) ? Number(item.seoIssueCount) : 0,
    geoResult: item.geoResult === "hit" || item.geoResult === "miss" ? item.geoResult : "partial",
    dataConfidence: item.dataConfidence === "real" ? "real" : "imported",
    contentHash: typeof item.contentHash === "string" ? item.contentHash : typeof item.content === "string" ? hashText(item.content) : undefined,
    lastCrawledAt: new Date().toISOString()
  };
}

function parseJsonArticles(text: string) {
  const payload = JSON.parse(text) as unknown;
  const articles = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "articles" in payload && Array.isArray((payload as { articles: unknown[] }).articles)
      ? (payload as { articles: unknown[] }).articles
      : [];

  return articles.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map(normalizeArticle);
}

function parseSitemap(text: string) {
  return Array.from(text.matchAll(/<loc>(.*?)<\/loc>/g))
    .map((match, index) => normalizeArticle({ url: match[1], title: match[1] }, index))
    .filter((item) => item.url);
}

function parseCsvArticles(text: string) {
  return parseCsv(text).map(normalizeArticle).filter((item) => item.url);
}

function getSourceUrls(input: Record<string, unknown>) {
  const inputUrls = [
    ...uniqueStrings(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),
    ...uniqueStrings(Array.isArray(input.sourceUrl) ? input.sourceUrl : []),
    ...(typeof input.sourceUrls === "string" ? input.sourceUrls.split(/\r?\n|,/) : []),
    ...(typeof input.sourceUrl === "string" ? [input.sourceUrl] : [])
  ];
  const envUrls = process.env.XCRAWL_BLOG_INDEX_URL ? process.env.XCRAWL_BLOG_INDEX_URL.split(/\r?\n|,/) : [];
  const urls = uniqueStrings(inputUrls.length ? inputUrls : envUrls.length ? envUrls : [...DEFAULT_BLOG_SOURCE_URLS]);

  return urls;
}

async function fetchSourceArticles(url: string) {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} 请求失败：${response.status}`);
  }

  if (text.trim().startsWith("<") && !text.includes("<loc>")) {
    throw new Error(`${url} 未返回可解析 sitemap。`);
  }

  const articles = text.trim().startsWith("<") ? parseSitemap(text) : parseJsonArticles(text);
  return articles.map((article) => ({
    ...article,
    dataConfidence: "imported" as const
  }));
}

function dedupeArticles(articles: BlogArticle[]) {
  const byUrl = new Map<string, BlogArticle>();

  for (const article of articles) {
    const key = normalizeUrl(article.url || article.id);
    const current = byUrl.get(key);

    if (!current) {
      byUrl.set(key, article);
      continue;
    }

    byUrl.set(key, {
      ...current,
      ...article,
      id: current.id,
      candidateStatus: current.candidateStatus,
      candidateReason: current.candidateReason,
      candidateAddedAt: current.candidateAddedAt
    });
  }

  return Array.from(byUrl.values());
}

export async function loadBlogArticles(input: Record<string, unknown>): Promise<BlogSyncAdapterResult> {
  if (Array.isArray(input.articles) && input.articles.length) {
    const articles = dedupeArticles(
      input.articles
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map(normalizeArticle)
        .filter((item) => item.url)
    );

    return {
      ok: true,
      status: "success",
      message: `已导入 ${articles.length} 篇博客文章。`,
      articles
    };
  }

  const urls = getSourceUrls(input);

  if (urls.length) {
    try {
      const results = await Promise.allSettled(urls.map(fetchSourceArticles));
      const sourceArticles = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      const sourceErrors = results.flatMap((result) => (result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "博客源同步失败"] : []));
      const articles = dedupeArticles(sourceArticles);

      if (!articles.length) {
        return {
          ok: false,
          status: "failed",
          message: sourceErrors.length ? `博客源同步失败：${sourceErrors.join("；")}` : "博客源未返回可导入文章。",
          sourceErrors
        };
      }

      return {
        ok: true,
        status: "success",
        message: sourceErrors.length
          ? `已从 ${urls.length - sourceErrors.length}/${urls.length} 个博客源同步并合并 ${articles.length} 篇文章；${sourceErrors.length} 个源未成功。`
          : `已从 ${urls.length} 个博客源同步并合并 ${articles.length} 篇文章。`,
        articles,
        sourceErrors
      };
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : "博客源同步失败"
      };
    }
  }

  const textInput = readTextInput(input, ["json", "csv", "text", "raw"]);

  if (!textInput.ok || !textInput.text) {
    return {
      ok: false,
      status: "pending_config",
      message: "博客同步入口已就绪，但还缺少 sourceUrl、articles、JSON/CSV 文本或允许目录内的 sourcePath。",
      missingConfig: []
    };
  }

  const text = textInput.text.trim();
  let articles: BlogArticle[];

  try {
    articles = dedupeArticles(text.startsWith("<") ? parseSitemap(text) : text.startsWith("[") || text.startsWith("{") ? parseJsonArticles(text) : parseCsvArticles(text));
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? `博客导入内容解析失败：${error.message}` : "博客导入内容解析失败"
    };
  }

  return {
    ok: true,
    status: "success",
    message: `已从${textInput.fileName || "输入内容"}导入 ${articles.length} 篇博客文章。`,
    articles
  };
}
