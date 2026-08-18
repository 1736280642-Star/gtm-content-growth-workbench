import { fetchPublicKnowledgeDocument } from "@/lib/workbench-store";
import type { AihotTrendItem } from "./aihot-trend-service";

export const HOTSPOT_SOURCE_EVIDENCE_VERSION = "hotspot-source-evidence.v1.0.0";
const MAX_SOURCE_CHARACTERS = 16_000;
const MAX_FRAGMENT_CHARACTERS = 700;
const MAX_FRAGMENTS = 40;
const MIN_DOCUMENT_CHARACTERS = 360;
const MIN_FRAGMENT_COUNT = 3;

export interface HotspotSourceEvidenceFragment {
  id: string;
  index: number;
  text: string;
}

export interface HotspotSourceEvidence {
  version: typeof HOTSPOT_SOURCE_EVIDENCE_VERSION;
  hotspotId: string;
  requestedUrl: string;
  sourceTitle: string;
  sourceName: string;
  provider: string;
  fetchedAt: string;
  contentHash: string;
  totalCharacters: number;
  fragments: HotspotSourceEvidenceFragment[];
}

function normalizeLine(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .trim();
}

function isBoilerplate(value: string) {
  const text = value.toLocaleLowerCase();
  if (text.length < 24) return true;
  if (/^(?:首页|登录|注册|下载|打开 app|关注我们|联系我们|相关阅读|推荐阅读|返回顶部|版权声明|免责声明|隐私政策|cookie)/i.test(value)) return true;
  if (/^(?:home|sign in|sign up|download|subscribe|related|recommended|privacy|terms|copyright|share)(?:\s|$)/i.test(text)) return true;
  const linkSignals = (value.match(/https?:\/\//gi) || []).length;
  return linkSignals >= 3;
}

function sentenceChunks(value: string) {
  if (value.length <= MAX_FRAGMENT_CHARACTERS) return [value];
  const sentences = value.split(/(?<=[。！？!?；;])\s*/).map(normalizeLine).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_FRAGMENT_CHARACTERS) {
      chunks.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => chunk.length <= MAX_FRAGMENT_CHARACTERS
    ? [chunk]
    : Array.from({ length: Math.ceil(chunk.length / MAX_FRAGMENT_CHARACTERS) }, (_, index) => chunk.slice(index * MAX_FRAGMENT_CHARACTERS, (index + 1) * MAX_FRAGMENT_CHARACTERS)));
}

function sourceBlocks(text: string) {
  const normalized = text.slice(0, MAX_SOURCE_CHARACTERS).replace(/\r/g, "");
  const coarseBlocks = normalized.includes("\n\n")
    ? normalized.split(/\n{2,}/)
    : normalized.split(/\n+/);
  const seen = new Set<string>();
  return coarseBlocks
    .map(normalizeLine)
    .filter((block) => !isBoilerplate(block))
    .flatMap(sentenceChunks)
    .map(normalizeLine)
    .filter((block) => {
      const key = block.toLocaleLowerCase().replace(/\s+/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FRAGMENTS);
}

function stableHotspotKey(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "hotspot";
}

export function buildHotspotSourceEvidence(input: {
  hotspot: AihotTrendItem;
  document: { title: string; text: string; provider: string; fetchedAt: string; contentHash: string };
}): HotspotSourceEvidence {
  const blocks = sourceBlocks(input.document.text);
  const totalCharacters = blocks.reduce((sum, block) => sum + block.length, 0);
  if (blocks.length < MIN_FRAGMENT_COUNT || totalCharacters < MIN_DOCUMENT_CHARACTERS) {
    throw new Error(`热点原始来源正文不足：仅提取 ${blocks.length} 个有效片段、${totalCharacters} 个字符。`);
  }
  const key = stableHotspotKey(input.hotspot.id);
  return {
    version: HOTSPOT_SOURCE_EVIDENCE_VERSION,
    hotspotId: input.hotspot.id,
    requestedUrl: input.hotspot.originalUrl,
    sourceTitle: input.document.title || input.hotspot.originalTitle || input.hotspot.title,
    sourceName: input.hotspot.sourceName,
    provider: input.document.provider,
    fetchedAt: input.document.fetchedAt,
    contentHash: input.document.contentHash,
    totalCharacters,
    fragments: blocks.map((text, index) => ({ id: `trend-${key}-p${String(index + 1).padStart(3, "0")}`, index: index + 1, text }))
  };
}

export async function fetchHotspotSourceEvidence(hotspot: AihotTrendItem) {
  const document = await fetchPublicKnowledgeDocument(hotspot.originalUrl);
  return buildHotspotSourceEvidence({ hotspot, document });
}
