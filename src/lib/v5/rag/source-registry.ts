import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { V5AuthorityLevel, V5LifecycleStatus, V5Visibility } from "../knowledge-governance-contracts";
import type { RagNamespace } from "./contracts";

export type RagSourceDisposition = "production_candidate" | "governance_preview" | "excluded_text" | "audit_only";

export interface RagSourceRegistryEntry {
  registryId: string;
  rootPath: string;
  productId: "pharaoh-command" | "noteflow" | "weike-ai-guardrail";
  productName: string;
  knowledgeBaseId: string;
  manifestRelativePath?: string;
  classify(relativePath: string): RagSourceClassification;
}

export interface RagSourceClassification {
  disposition: RagSourceDisposition;
  namespace: RagNamespace;
  documentType: string;
  authorityLevel: V5AuthorityLevel;
  lifecycleStatus: V5LifecycleStatus;
  visibility: V5Visibility;
  allowedEvidenceRoles: string[];
  forbiddenUsage: string[];
  reason: string;
}

export interface RagSourceImportCandidate extends RagSourceClassification {
  registryId: string;
  sourceId: string;
  productId: string;
  productName: string;
  knowledgeBaseId: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  canonicalUrl?: string;
  contentHash: string;
  contentLength: number;
  normalizedTextRef: string;
  rawAssetRef?: string;
}

export const RAG_SOURCE_ROOT_ENV = {
  command: "RAG_SOURCE_ROOT_PHARAOH_COMMAND",
  noteflow: "RAG_SOURCE_ROOT_NOTEFLOW",
  weike: "RAG_SOURCE_ROOT_WEIKE_GUARDRAIL",
  wechat: "RAG_SOURCE_ROOT_PHARAOH_WECHAT"
} as const;

const roots = {
  command: process.env[RAG_SOURCE_ROOT_ENV.command]?.trim() || "D:/GTM/工作台/保存/command.jotoai.com-2026-07-07-xcrawl",
  noteflow: process.env[RAG_SOURCE_ROOT_ENV.noteflow]?.trim() || "D:/GTM/工作台/保存/note.jotoai.com-2026-07-09-xcrawl",
  weike: process.env[RAG_SOURCE_ROOT_ENV.weike]?.trim() || "D:/GTM/工作台/保存/sec.jotoai.com-2026-07-07-xcrawl",
  wechat: process.env[RAG_SOURCE_ROOT_ENV.wechat]?.trim() || "D:/GTM/工作台/保存/wechat-joto-pharaoh-command-2026-07-09"
} as const;

const backgroundOnly = ["industry_background", "scenario", "faq", "change_history"];
const productFactForbidden = ["current_product_capability", "performance_result", "privacy_commitment", "customer_result"];

function baseClassification(overrides: Partial<RagSourceClassification>): RagSourceClassification {
  return {
    disposition: "audit_only",
    namespace: "isolated",
    documentType: "audit_asset",
    authorityLevel: "E",
    lifecycleStatus: "unknown",
    visibility: "internal",
    allowedEvidenceRoles: [],
    forbiddenUsage: ["production_retrieval"],
    reason: "仅保留原始资产与审计关系。",
    ...overrides
  };
}

export const ragSourceRegistry: RagSourceRegistryEntry[] = [
  {
    registryId: "pharaoh-command-official-site-20260707",
    rootPath: roots.command,
    productId: "pharaoh-command",
    productName: "Pharaoh Command",
    knowledgeBaseId: "kb-pharaoh-command-official",
    manifestRelativePath: "manifest.json",
    classify(relativePath) {
      const file = normalizeRelative(relativePath);
      if (/^pages\/00[1-5]-solutions-/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_solution_page", authorityLevel: "A2",
        lifecycleStatus: "current", visibility: "public", allowedEvidenceRoles: ["scenario", "product_capability", "official_citation"],
        forbiddenUsage: ["unqualified_performance", "customer_result"], reason: "官网行业方案页，可支撑分行业场景与明确能力。"
      });
      if (file === "pages/006-page-6.md") return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_product_page", authorityLevel: "A2",
        lifecycleStatus: "current", visibility: "public", allowedEvidenceRoles: ["product_definition", "product_capability", "official_citation"],
        forbiddenUsage: ["unqualified_performance", "customer_result"], reason: "产品官网首页。"
      });
      if (/^pages\/00[89]-/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: file.includes("privacy") ? "official_privacy_policy" : "official_terms",
        authorityLevel: "A1", lifecycleStatus: "current", visibility: "public", allowedEvidenceRoles: ["limitation", "permission_boundary", "privacy_boundary", "official_citation"],
        forbiddenUsage: ["marketing_result", "industry_trend"], reason: "正式条款或隐私来源。"
      });
      if (file === "pages/007-register.md" || file === "combined.md") return baseClassification({ disposition: "excluded_text", reason: "注册页或聚合重复稿不进入正文索引。" });
      return baseClassification({ reason: "抓取元数据、Raw 或 source map 仅用于追溯。" });
    }
  },
  {
    registryId: "noteflow-official-site-20260709",
    rootPath: roots.noteflow,
    productId: "noteflow",
    productName: "Noteflow",
    knowledgeBaseId: "kb-noteflow-official",
    manifestRelativePath: "public-rendered-full/manifest.json",
    classify(relativePath) {
      const file = normalizeRelative(relativePath);
      if (/^public-rendered-full\/pages\/(001-page-1|002-features|003-use-cases|006-privacy)\.md$/.test(file)) {
        const privacy = file.includes("006-privacy");
        return baseClassification({ disposition: "production_candidate", namespace: "production_public", documentType: privacy ? "official_privacy_policy" : "official_product_page",
          authorityLevel: privacy ? "A1" : "A2", lifecycleStatus: "current", visibility: "public",
          allowedEvidenceRoles: privacy ? ["privacy_boundary", "limitation", "official_citation"] : ["product_definition", "product_capability", "scenario", "official_citation"],
          forbiddenUsage: privacy ? ["marketing_result"] : ["unqualified_performance", "customer_result"], reason: "Noteflow 正式产品或隐私页面。" });
      }
      if (/^public-rendered-full\/blog\/.+\.md$/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_history_blog", authorityLevel: "B2",
        lifecycleStatus: "unknown", visibility: "public", allowedEvidenceRoles: backgroundOnly,
        forbiddenUsage: productFactForbidden, reason: "历史博客仅作为背景、场景、FAQ 与变化历史。"
      });
      if (file.endsWith("296-blog-1776356574926-rewritten.md") || file === "noteflow：终于有一个 ai 知识库，能把你的资料真正用起来了.md") return baseClassification({
        disposition: "governance_preview", namespace: "governance_preview", documentType: "unverified_or_rewritten_article", authorityLevel: "C2",
        lifecycleStatus: "unknown", visibility: "internal", allowedEvidenceRoles: ["expression_reference"], forbiddenUsage: ["production_fact", "public_citation"],
        reason: "来源身份或二次改写状态未确认。"
      });
      if (/^public-rendered-full\/pages\/(004-blog|005-contact|007-download)\.md$/.test(file) || file.endsWith("combined.md")) {
        return baseClassification({ disposition: "excluded_text", reason: "列表、联系、下载或聚合页不作为独立生产 SourceAsset。" });
      }
      return baseClassification({ reason: "Playwright 原始产物、sitemap 与 Manifest 只作审计。" });
    }
  },
  {
    registryId: "weike-guardrail-official-site-20260707",
    rootPath: roots.weike,
    productId: "weike-ai-guardrail",
    productName: "唯客 AI 护栏",
    knowledgeBaseId: "kb-weike-ai-guardrail-official",
    manifestRelativePath: "manifest.json",
    classify(relativePath) {
      const file = normalizeRelative(relativePath);
      if (/^public-html-full\/pages\/.+\.md$/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_product_page", authorityLevel: "A2",
        lifecycleStatus: "current", visibility: "public", allowedEvidenceRoles: ["product_definition", "product_capability", "deployment", "official_citation"],
        forbiddenUsage: ["unqualified_performance", "absolute_security", "unverified_integration_scope"], reason: "唯客正式产品页面。"
      });
      if (/^public-html-full\/articles\/.+\.md$/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_security_article", authorityLevel: "B2",
        lifecycleStatus: "unknown", visibility: "public", allowedEvidenceRoles: ["industry_background", "scenario", "faq", "security_knowledge"],
        forbiddenUsage: [...productFactForbidden, "product_detection_capability"], reason: "安全文章默认为行业背景，不能自动升级为产品能力。"
      });
      if (file.endsWith("combined.md")) return baseClassification({ disposition: "excluded_text", reason: "聚合稿不重复进入。" });
      return baseClassification({ reason: "Raw HTML、列表与抓取说明只作审计。" });
    }
  },
  {
    registryId: "pharaoh-command-wechat-history-20260709",
    rootPath: roots.wechat,
    productId: "pharaoh-command",
    productName: "Pharaoh Command",
    knowledgeBaseId: "kb-pharaoh-command-wechat-history",
    manifestRelativePath: "manifest.json",
    classify(relativePath) {
      const file = normalizeRelative(relativePath);
      if (/^0[1-3]\.md$/.test(file)) return baseClassification({
        disposition: "production_candidate", namespace: "production_public", documentType: "official_channel_history", authorityLevel: "B2",
        lifecycleStatus: "unknown", visibility: "public", allowedEvidenceRoles: ["scenario", "user_problem", "brand_expression", "channel_history"],
        forbiddenUsage: productFactForbidden, reason: "Manifest 确认的 JOTO / Pharaoh Command 微信历史文章。"
      });
      if (["04-new-angle-ai-netops-system.md", "article.md", "article.cleaned.md"].includes(file)) return baseClassification({
        disposition: "governance_preview", namespace: "governance_preview", documentType: "local_rewrite", authorityLevel: "C2",
        lifecycleStatus: "unknown", visibility: "internal", allowedEvidenceRoles: ["expression_reference", "badcase"],
        forbiddenUsage: ["production_fact", "public_citation"], reason: "本地二次创作或加工稿。"
      });
      return baseClassification({ reason: "媒体、海报、索引与抓取 Manifest 只保留资产关系。" });
    }
  }
];

function normalizeRelative(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function sourceId(registryId: string, relativePath: string) {
  return `src-${createHash("sha256").update(`${registryId}:${normalizeRelative(relativePath)}`).digest("hex").slice(0, 24)}`;
}

function titleFromMarkdown(content: string, fallback: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.basename(fallback, path.extname(fallback));
}

async function listFiles(rootPath: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else output.push(path.relative(rootPath, absolute));
    }
  }
  await walk(rootPath);
  return output;
}

async function manifestUrlMap(entry: RagSourceRegistryEntry) {
  const urls = new Map<string, string>();
  if (!entry.manifestRelativePath) return urls;
  const manifestPath = path.join(entry.rootPath, entry.manifestRelativePath);
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files?: Array<{ file?: string; url?: string }>; results?: Array<{ file?: string; url?: string }> };
    for (const item of [...(manifest.files || []), ...(manifest.results || [])]) {
      if (!item.file || !item.url) continue;
      const relative = path.isAbsolute(item.file) ? path.relative(entry.rootPath, item.file) : path.join(path.dirname(entry.manifestRelativePath), item.file);
      urls.set(normalizeRelative(relative), item.url);
    }
  } catch {
    return urls;
  }
  return urls;
}

export async function buildRagSourceImportPlan(options: { includeAuditAssets?: boolean; productIds?: string[] } = {}) {
  const candidates: RagSourceImportCandidate[] = [];
  const selectedProducts = options.productIds?.length ? new Set(options.productIds) : undefined;
  for (const entry of ragSourceRegistry) {
    if (selectedProducts && !selectedProducts.has(entry.productId)) continue;
    const urlMap = await manifestUrlMap(entry);
    for (const relativePath of await listFiles(entry.rootPath)) {
      const classification = entry.classify(relativePath);
      if (!options.includeAuditAssets && classification.disposition === "audit_only") continue;
      const absolutePath = path.join(entry.rootPath, relativePath);
      const fileStat = await stat(absolutePath);
      const isMarkdown = path.extname(relativePath).toLowerCase() === ".md";
      const content = isMarkdown ? await readFile(absolutePath, "utf8") : "";
      candidates.push({
        ...classification,
        registryId: entry.registryId,
        sourceId: sourceId(entry.registryId, relativePath),
        productId: entry.productId,
        productName: entry.productName,
        knowledgeBaseId: entry.knowledgeBaseId,
        relativePath: normalizeRelative(relativePath),
        absolutePath,
        title: isMarkdown ? titleFromMarkdown(content, relativePath) : path.basename(relativePath),
        canonicalUrl: urlMap.get(normalizeRelative(relativePath)),
        contentHash: createHash("sha256").update(isMarkdown ? content.replace(/\r\n/g, "\n") : `${fileStat.size}:${fileStat.mtimeMs}`).digest("hex"),
        contentLength: isMarkdown ? content.length : fileStat.size,
        normalizedTextRef: isMarkdown ? absolutePath : "",
        rawAssetRef: classification.disposition === "audit_only" ? absolutePath : undefined
      });
    }
  }
  return candidates;
}

export function summarizeRagSourceImportPlan(candidates: RagSourceImportCandidate[]) {
  const byDisposition = Object.fromEntries(["production_candidate", "governance_preview", "excluded_text", "audit_only"].map((key) => [key, candidates.filter((item) => item.disposition === key).length]));
  const byProduct = Object.fromEntries(Array.from(new Set(candidates.map((item) => item.productId))).map((productId) => [productId, candidates.filter((item) => item.productId === productId).length]));
  return { total: candidates.length, byDisposition, byProduct };
}
