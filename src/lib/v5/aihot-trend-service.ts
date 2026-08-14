import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AihotTrendCategory = "ai-models" | "ai-products" | "industry" | "paper" | "tip" | null;

export interface AihotTrendItem {
  id: string;
  title: string;
  originalTitle?: string;
  summary?: string;
  category: AihotTrendCategory;
  sourceName: string;
  originalUrl: string;
  aihotUrl: string;
  publishedAt?: string;
  discoveredAt?: string;
  score?: number;
  selectionReason?: string;
}

interface AihotTrendCache {
  schemaVersion: 1;
  etag?: string;
  updatedAt?: string;
  items: AihotTrendItem[];
}

export interface AihotTrendResult {
  items: AihotTrendItem[];
  updatedAt: string;
  freshness: "live" | "cached";
}

const AIHOT_DEFAULT_BASE_URL = "https://aihot.virxact.com";
const AIHOT_ITEMS_PATH = "/api/v1/items?mode=selected&window=24h&limit=50";
const AIHOT_REQUEST_TIMEOUT_MS = 20_000;

function cachePath() {
  return path.resolve(process.cwd(), process.env.V5_AIHOT_CACHE_PATH?.trim() || "data/v5-aihot-trend-cache.json");
}

async function readCache(): Promise<AihotTrendCache> {
  try {
    const value = JSON.parse(await readFile(cachePath(), "utf8")) as Partial<AihotTrendCache>;
    return {
      schemaVersion: 1,
      etag: typeof value.etag === "string" ? value.etag : undefined,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
      items: Array.isArray(value.items) ? value.items : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, items: [] };
    throw error;
  }
}

async function writeCache(cache: AihotTrendCache) {
  const target = cachePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const normalized = text(value);
  return normalized || undefined;
}

function validHttpUrl(value: unknown) {
  const normalized = text(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function parseAihotV1Items(payload: unknown): AihotTrendItem[] {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(record.items) ? record.items : [];
  return rows.flatMap((item): AihotTrendItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const source = value.source && typeof value.source === "object" && !Array.isArray(value.source) ? value.source as Record<string, unknown> : {};
    const links = value.links && typeof value.links === "object" && !Array.isArray(value.links) ? value.links as Record<string, unknown> : {};
    const id = text(value.id);
    const title = text(value.title);
    const originalUrl = validHttpUrl(links.original);
    const aihotUrl = validHttpUrl(links.aihot);
    if (!id || !title || !originalUrl || !aihotUrl) return [];
    const category = ["ai-models", "ai-products", "industry", "paper", "tip"].includes(text(value.category))
      ? text(value.category) as Exclude<AihotTrendCategory, null>
      : null;
    return [{
      id,
      title,
      originalTitle: optionalText(value.originalTitle),
      summary: optionalText(value.summary),
      category,
      sourceName: text(source.name) || "未知来源",
      originalUrl,
      aihotUrl,
      publishedAt: optionalText(value.publishedAt),
      discoveredAt: optionalText(value.discoveredAt),
      score: Number.isFinite(Number(value.score)) ? Number(value.score) : undefined,
      selectionReason: optionalText(value.reason)
    }];
  });
}

export async function getLatestAihotTrends(options?: { fetchImpl?: typeof fetch }): Promise<AihotTrendResult> {
  const fetchImpl = options?.fetchImpl || fetch;
  const cache = await readCache();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIHOT_REQUEST_TIMEOUT_MS);
  const baseUrl = (process.env.AIHOT_BASE_URL?.trim() || AIHOT_DEFAULT_BASE_URL).replace(/\/$/, "");
  try {
    const response = await fetchImpl(`${baseUrl}${AIHOT_ITEMS_PATH}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "JOTO-GTM-Workbench/1.0",
        ...(cache.etag ? { "if-none-match": cache.etag } : {})
      }
    });
    if (response.status === 304 && cache.items.length) {
      return { items: cache.items, updatedAt: cache.updatedAt || new Date().toISOString(), freshness: "cached" };
    }
    if (!response.ok) throw new Error(`AIHOT request failed: ${response.status}`);
    const items = parseAihotV1Items(await response.json());
    if (!items.length) throw new Error("AIHOT returned no usable selected items");
    const updatedAt = new Date().toISOString();
    await writeCache({ schemaVersion: 1, etag: response.headers.get("etag") || undefined, updatedAt, items });
    return { items, updatedAt, freshness: "live" };
  } catch (error) {
    if (cache.items.length) return { items: cache.items, updatedAt: cache.updatedAt || new Date().toISOString(), freshness: "cached" };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
