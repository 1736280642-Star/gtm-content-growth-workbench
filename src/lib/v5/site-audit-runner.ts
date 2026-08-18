import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SiteAuditFinding, SiteAuditPageSnapshot, SiteAuditPageType, SiteAuditRemediationGuidance } from "./site-audit-contracts";

export const SITE_AUDIT_RULESET_VERSION = "v5-core-geo-readiness@2";
export const SITE_AUDIT_EXECUTOR_VERSION = "v5-site-audit-runner@2";
const DEFAULT_MAX_PAGES = 25;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

export interface SiteAuditRunnerInput {
  runId: string;
  scopeUrl: string;
  sitemapUrl?: string;
  scopeMode?: "single_page" | "site";
  maxPages?: number;
  renderPage?: (url: string) => Promise<{ html: string; finalUrl?: string; httpStatus?: number }>;
}

export interface SiteAuditRunnerResult {
  pages: SiteAuditPageSnapshot[];
  findings: Omit<SiteAuditFinding, "version" | "firstSeenAt" | "lastSeenAt">[];
  failedUrlCount: number;
  coreReadinessScore: number;
  technicalReadinessScore: number;
  contentCitabilityScore: number;
  platformComplianceScore: number;
  experimentalSignals: Array<{ code: string; status: "present" | "missing" | "unknown"; note: string }>;
  discoveredSitemapUrl?: string;
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 192 && parts[1] === 0)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51))
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

function privateIpv6(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized.startsWith("::ffff:")) return privateIpv4(normalized.slice("::ffff:".length));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
    || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
}

export async function assertSafePublicUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("invalid_public_url"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) throw new Error("invalid_public_url");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain"].includes(hostname.toLowerCase())) throw new Error("private_network_target");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address, family }) => family === 4 ? privateIpv4(address) : privateIpv6(address))) {
    throw new Error("private_network_target");
  }
  return parsed;
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("response_too_large"); }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

async function safeFetchText(value: string) {
  let current = await assertSafePublicUrl(value);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "JOTO-GEO-Audit/1.0 (+website-readiness-audit)", accept: "text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("redirect_limit_exceeded");
      current = await assertSafePublicUrl(new URL(location, current).toString());
      continue;
    }
    return { response, text: await readLimitedText(response), finalUrl: current.toString() };
  }
  throw new Error("redirect_limit_exceeded");
}

function stripHtml(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function matches(value: string, pattern: RegExp) { return pattern.test(value); }
function firstMatch(value: string, pattern: RegExp) { return value.match(pattern)?.[1]?.trim(); }
function countWords(value: string) { return stripHtml(value).split(/\s+|(?<=[\u4e00-\u9fff])(?=[\u4e00-\u9fff])/).filter(Boolean).length; }
function normalizedHost(value: string) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }

function classifyPageType(url: string, title: string | undefined, html: string, schemaTypes: Set<string>): SiteAuditPageType {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  const routeIdentity = `${path} ${title || ""} ${firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || ""}`.toLowerCase();
  const contentIdentity = `${routeIdentity} ${stripHtml(html).slice(0, 1200)}`;
  if (/privacy(?:-policy)?|隐私政策|隐私声明/.test(routeIdentity)) return "privacy_policy";
  if (/(?:^|[\s/_-])terms(?:[\s/_-]|$)|terms of service|服务条款|使用条款/.test(routeIdentity)) return "terms";
  if (path.startsWith("/blog/") || [...schemaTypes].some((type) => ["Article", "BlogPosting", "NewsArticle"].includes(type))) return "article";
  if ([...schemaTypes].some((type) => ["Product", "SoftwareApplication", "Service"].includes(type)) || /product|service|solution|platform|workspace|tool|产品|服务|解决方案|平台|工具/.test(contentIdentity)) return "product_service";
  return "general";
}

function pageTypeLabel(pageType: SiteAuditPageType) {
  return ({ privacy_policy: "隐私政策页", terms: "服务条款页", article: "文章页", product_service: "产品/服务说明页", general: "普通内容页", technical_resource: "技术资源" } as const)[pageType];
}

function isTraceableEvidenceCandidate(link: string, anchorText: string) {
  const host = normalizedHost(link);
  const recognizedAuthority = /(?:^|\.)(?:gov(?:\.cn|\.uk)?|edu|edu\.cn|ac\.[a-z]{2}|rfc-editor\.org|w3\.org|schema\.org|doi\.org|arxiv\.org|oecd\.org|worldbank\.org|who\.int|iso\.org)$/.test(host);
  const officialDocumentation = /^(?:docs?|developers?|support|learn|research)\./.test(host)
    || ["developers.google.com", "support.google.com", "openai.com", "anthropic.com", "microsoft.com", "aws.amazon.com"].includes(host);
  const explicitSourceLabel = /official|documentation|policy|terms|report|research|study|standard|source|官方|文档|政策|条款|报告|研究|标准|来源/i.test(anchorText);
  return recognizedAuthority || officialDocumentation || explicitSourceLabel;
}

function remediationGuidance(input: {
  code: string;
  pageType: SiteAuditPageType;
  pageTitle?: string;
  headings?: string[];
  recommendedRemediation: string;
  missingControls?: string[];
}): SiteAuditRemediationGuidance {
  const heading = input.headings?.find(Boolean);
  const base: SiteAuditRemediationGuidance = {
    pageType: input.pageType,
    pageContext: `${pageTypeLabel(input.pageType)}${input.pageTitle ? `；当前页面标题为“${stripHtml(input.pageTitle)}”` : ""}`,
    targetLocations: [heading ? `正文“${stripHtml(heading)}”相关段落` : "页面对应内容模块"],
    actions: [input.recommendedRemediation],
    suggestedCopy: [],
    acceptanceCriteria: ["重新审计后该问题不再出现，并确认页面可见内容与结构化信息一致。"]
  };
  if (input.code === "platform_terms_reference_unlinked") return {
    ...base,
    targetLocations: ["“Acceptance and eligibility / 接受与资格”中提及 Google Ads 与 Google API policies 的段落", "页面底部政策导航"],
    actions: ["把正文中的 Google Ads、Google API policies 改为可访问的官方政策链接。", "由条款负责人确认这些链接是参考说明还是构成合同义务，避免无意扩大适用条款。"],
    suggestedCopy: ["使用 AdsBridge 连接 Google Ads 时，操作方还应遵守适用的 Google Ads API Terms and Conditions、Google APIs Terms of Service 及 Google API Services User Data Policy。"],
    acceptanceCriteria: ["正文至少包含一个 developers.google.com 官方政策链接。", "链接返回 2xx/3xx，锚文本能说明对应政策。", "政策名称、适用主体与页面公开表述经过业务或法务确认。"]
  };
  if (input.code === "platform_reference_missing") return {
    ...base,
    targetLocations: ["“How Google data is used / Google 数据如何使用”之后", "“Security and related policies / 安全与相关政策”模块"],
    actions: ["新增“官方平台依据”小节，连接 Google Ads API、OAuth 数据政策与本网站隐私政策。", "补充数据类别、只读/写入动作、用途和授权边界的对应关系。"],
    suggestedCopy: ["官方平台依据：AdsBridge 仅在操作方授权范围内连接 Google Ads API。数据访问与使用同时受 Google API Services User Data Policy 和 Google Ads API Terms and Conditions 约束。"],
    acceptanceCriteria: ["至少包含 Google 官方 API 政策链接、站内 Privacy Policy 和 Terms 三类入口。", "页面明确说明访问什么数据、为什么访问、是否执行写入。", "公开说明与 OAuth consent screen 的应用名称、域名和用途一致。"]
  };
  if (input.code === "google_data_policy_reference_missing") return {
    ...base,
    targetLocations: ["“Google API and Google user data”小节", "隐私政策末尾的相关政策链接区"],
    actions: ["直接链接 Google API Services User Data Policy 与 Google Ads API Terms。", "仅在系统真实符合时，明确声明 Google API 数据使用遵循 Limited Use 要求。"],
    suggestedCopy: ["AdsBridge 对 Google API 数据的访问和使用遵循 Google API Services User Data Policy，包括其中的 Limited Use 要求；数据只用于操作方授权的功能。"],
    acceptanceCriteria: ["存在可访问的 Google 官方用户数据政策链接。", "Limited Use 声明与实际数据处理、日志和共享行为一致。", "站内政策 URL 与 OAuth consent screen 配置一致。"]
  };
  if (input.code === "google_data_controls_incomplete") return {
    ...base,
    targetLocations: ["“Google API and Google user data”之后新增“授权、保留与删除”小节", "“Requests, updates, and contact”小节"],
    actions: [
      `补齐本次未检测到的披露项：${(input.missingControls || []).join("、")}。`,
      "用实际系统配置填写 scope、保留期限、删除入口和处理时限，不使用无法兑现的模板承诺。"
    ],
    suggestedCopy: [
      "授权范围：列出 AdsBridge 实际请求的 OAuth scope，并逐项说明对应功能。",
      "撤销与删除：用户可以在 Google Account 的第三方连接页面撤销授权，也可以通过公开联系邮箱提交删除请求；请补充实际处理时限。",
      "保留期限：按 OAuth 凭证、广告数据、操作日志分别填写明确期限或可验证的删除条件。"
    ],
    acceptanceCriteria: ["公开列出生产环境实际请求的全部 OAuth scopes。", "用户能够找到撤销授权和删除数据的具体步骤。", "每类数据有明确保留期限或确定的删除条件。", "变更内容经隐私/安全责任人复核。"]
  };
  if (input.code === "source_evidence_missing") return {
    ...base,
    targetLocations: ["包含数字、比较、研究结论或行业判断的正文段落", "页面末尾的“来源/参考资料”模块"],
    actions: ["仅为可验证的事实主张补充一手或权威来源，不为了通过审计堆砌外链。", "让链接锚文本说明被支持的结论，并优先链接原始报告、标准或官方文档。"],
    suggestedCopy: ["参考依据：在具体结论之后写明来源名称、发布日期和原始链接；如为 JOTO 自有数据，明确统计口径与时间范围。"],
    acceptanceCriteria: ["至少一个关键事实主张能追溯到有效来源。", "来源与结论直接相关，且不是搜索结果页或聚合转载页。", "删除来源链接后，页面不应仍保留无法验证的精确数据或绝对化结论。"]
  };
  return base;
}
function likelyClientRendered(html: string, wordCount: number) {
  if (wordCount >= 80) return false;
  return /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html)
    || /<script[^>]+src=["'][^"']+(?:_next|webpack|vite|chunk)[^"']*["']/i.test(html);
}

async function renderWithConfiguredService(url: string) {
  const endpoint = process.env.SITE_AUDIT_RENDERER_URL?.trim();
  if (!endpoint) throw new Error("render_service_not_configured");
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      ...(process.env.SITE_AUDIT_RENDERER_TOKEN ? { authorization: `Bearer ${process.env.SITE_AUDIT_RENDERER_TOKEN}` } : {})
    },
    body: JSON.stringify({ url, waitUntil: "networkidle", maxBytes: MAX_RESPONSE_BYTES })
  });
  if (!response.ok) throw new Error(`render_service_http_${response.status}`);
  const raw = await readLimitedText(response);
  const payload = JSON.parse(raw) as { html?: unknown; finalUrl?: unknown; httpStatus?: unknown };
  if (typeof payload.html !== "string" || !payload.html.trim()) throw new Error("render_service_invalid_payload");
  const finalUrl = typeof payload.finalUrl === "string" ? (await assertSafePublicUrl(payload.finalUrl)).toString() : url;
  return { html: payload.html, finalUrl, httpStatus: Number(payload.httpStatus) || 200 };
}

function robotsBlocksCitationBots(robots: string) {
  const groups = robots.split(/\n\s*\n/).map((block) => block.split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean));
  const bots = ["oai-searchbot", "claude-searchbot", "perplexitybot", "googlebot", "applebot"];
  return bots.filter((bot) => groups.some((lines) => {
    const agents = lines.filter((line) => /^user-agent\s*:/i.test(line)).map((line) => line.split(":").slice(1).join(":").trim().toLowerCase());
    if (!agents.includes(bot) && !agents.includes("*")) return false;
    return lines.some((line) => /^disallow\s*:\s*\/\s*$/i.test(line));
  }));
}

function finding(input: Omit<SiteAuditFinding, "id" | "version" | "firstSeenAt" | "lastSeenAt" | "claimIds" | "publishedContentIds" | "status" | "evidenceSource"> & { runId: string }) {
  const id = `site-audit-finding-${createHash("sha256").update(`${input.runId}:${input.url}:${input.code}`).digest("hex").slice(0, 24)}`;
  return {
    ...input,
    remediationGuidance: input.remediationGuidance || remediationGuidance({ code: input.code, pageType: "technical_resource", recommendedRemediation: input.recommendedRemediation }),
    id, evidenceSource: "page_audit_deterministic" as const, claimIds: [], publishedContentIds: [], status: "open" as const
  };
}

export function auditSiteHtml(runId: string, url: string, html: string) {
  const findings: ReturnType<typeof finding>[] = [];
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const canonical = firstMatch(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const wordCount = countWords(html);
  const noindex = matches(html, /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i);
  const lang = firstMatch(html, /<html[^>]+lang=["']([^"']+)["']/i);
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  let validSchema = 0;
  const schemaTypes = new Set<string>();
  const schemaNodes: Record<string, unknown>[] = [];
  let schemaContextCount = 0;
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown> | Record<string, unknown>[];
      validSchema += 1;
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      const nodes = roots.flatMap((root) => Array.isArray(root?.["@graph"]) ? root["@graph"] as Record<string, unknown>[] : [root]);
      for (const node of nodes) {
        schemaNodes.push(node);
        if (String(node?.["@context"] || roots.find((root) => root["@context"])?.["@context"] || "").toLowerCase().includes("schema.org")) schemaContextCount += 1;
        const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
        types.filter(Boolean).forEach((item) => schemaTypes.add(String(item)));
      }
    } catch { /* reported below */ }
  }
  const externalLinkEntries = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: match[1], anchorText: stripHtml(match[2]) }))
    .filter((link) => normalizedHost(link.url) !== normalizedHost(url));
  const externalLinks = externalLinkEntries.map((item) => item.url);
  const traceableEvidenceLinks = externalLinkEntries.filter((item) => isTraceableEvidenceCandidate(item.url, item.anchorText));
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => stripHtml(match[1])).filter(Boolean);
  const visibleText = stripHtml(html);
  const pageType = classifyPageType(url, title, html, schemaTypes);
  const googleContext = /google ads|google api|google user data|oauth|谷歌广告|谷歌 api/i.test(visibleText);
  const googleOfficialLinks = externalLinks.filter((link) => ["developers.google.com", "support.google.com", "ads.google.com", "policies.google.com"].includes(normalizedHost(link)));
  const claimSignals = /\b\d+(?:\.\d+)?%|\b(?:19|20)\d{2}\b|according to|research|study|report|data shows|benchmark|industry[- ]leading|best|faster|increase|decrease|根据.{0,12}(?:研究|报告|数据)|数据显示|提升|降低|领先|最佳|超过|\d+(?:\.\d+)?\s*倍/i.test(visibleText);
  const add = (condition: boolean, data: Parameters<typeof finding>[0] & { missingControls?: string[] }) => {
    if (!condition) return;
    const { missingControls, ...findingData } = data;
    findings.push(finding({
      ...findingData,
      remediationGuidance: data.remediationGuidance || remediationGuidance({ code: data.code, pageType, pageTitle: title, headings, recommendedRemediation: data.recommendedRemediation, missingControls })
    }));
  };
  add(!title, { runId, url, category: "technical", severity: "high", code: "missing_title", title: "页面缺少标题", detectionEvidence: "HTML 中未发现非空 title。", userImpact: "AI 与搜索系统难以稳定识别页面主题。", recommendedRemediation: "增加唯一且准确概括页面主题的 title。" });
  add(!description, { runId, url, category: "technical", severity: "medium", code: "missing_meta_description", title: "页面缺少描述", detectionEvidence: "HTML 中未发现 meta description。", userImpact: "页面摘要缺少明确的机器可读入口。", recommendedRemediation: "增加与正文一致的简洁 description。" });
  add(!canonical, { runId, url, category: "technical", severity: "medium", code: "missing_canonical", title: "页面缺少 canonical", detectionEvidence: "HTML 中未发现 canonical 链接。", userImpact: "重复 URL 可能分散实体与引用归属。", recommendedRemediation: "增加指向首选公开 URL 的 canonical。" });
  add(noindex, { runId, url, category: "technical", severity: "critical", code: "page_noindex", title: "页面声明 noindex", detectionEvidence: "robots meta 中检测到 noindex。", userImpact: "搜索与部分 AI 检索系统可能排除该页面。", recommendedRemediation: "若页面应公开检索，请移除 noindex 并验证响应头。" });
  add(!lang, { runId, url, category: "technical", severity: "low", code: "missing_html_lang", title: "页面未声明语言", detectionEvidence: "html 元素没有 lang 属性。", userImpact: "语言识别与地域化解析的确定性下降。", recommendedRemediation: "为 html 设置准确的 BCP 47 语言代码。" });
  add(h1Count !== 1, { runId, url, category: "content", severity: h1Count === 0 ? "high" : "medium", code: h1Count === 0 ? "missing_h1" : "multiple_h1", title: h1Count === 0 ? "页面缺少主标题" : "页面存在多个主标题", detectionEvidence: `检测到 ${h1Count} 个 h1。`, userImpact: "页面核心回答主题不够明确。", recommendedRemediation: "保留一个清晰描述主要问题或实体的 h1。" });
  add(wordCount < 200, { runId, url, category: "content", severity: "medium", code: "thin_content", title: "可读取正文过少", detectionEvidence: `清洗后约 ${wordCount} 个词/字符单元。`, userImpact: "页面缺少足够上下文供检索和引用。", recommendedRemediation: "补充直接回答、事实依据、适用边界和来源。" });
  add(jsonLdBlocks.length === 0, { runId, url, category: "schema", severity: "medium", code: "schema_missing", title: "页面没有 JSON-LD", detectionEvidence: "未发现 application/ld+json。", userImpact: "品牌、页面和内容实体关系只能从正文推断。", recommendedRemediation: "按真实页面类型添加合法 Schema.org JSON-LD。" });
  add(jsonLdBlocks.length > validSchema, { runId, url, category: "schema", severity: "high", code: "schema_invalid_json", title: "JSON-LD 无法解析", detectionEvidence: `${jsonLdBlocks.length - validSchema} 个 JSON-LD 块不是合法 JSON。`, userImpact: "结构化实体信息可能被完全忽略。", recommendedRemediation: "修复 JSON 语法并用 Schema.org 验证工具复核。" });
  add(validSchema > 0 && schemaContextCount === 0, { runId, url, category: "schema", severity: "high", code: "schema_context_missing", title: "JSON-LD 未声明 Schema.org 上下文", detectionEvidence: "可解析的 JSON-LD 节点中没有检测到 schema.org @context。", userImpact: "消费者无法可靠判断字段使用的结构化词汇表。", recommendedRemediation: "在 JSON-LD 根节点声明 https://schema.org，并保持字段与页面事实一致。" });
  const identityIncomplete = schemaNodes.filter((node) => {
    const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).map(String);
    return types.some((type) => ["Organization", "WebSite", "Product", "SoftwareApplication"].includes(type)) && (!node.name || (!node.url && !node["@id"]));
  }).length;
  add(identityIncomplete > 0, { runId, url, category: "schema", severity: "medium", code: "schema_identity_incomplete", title: "实体 Schema 缺少稳定身份字段", detectionEvidence: `${identityIncomplete} 个 Organization/WebSite/Product/SoftwareApplication 节点缺少 name 或 url/@id。`, userImpact: "品牌、产品与官网 URL 的实体归属容易依赖推断。", recommendedRemediation: "为实体补充与页面可见内容一致的 name，以及可长期稳定解析的 url 或 @id。" });
  const articleIncomplete = schemaNodes.filter((node) => {
    const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).map(String);
    return types.some((type) => ["Article", "BlogPosting", "NewsArticle"].includes(type)) && (!node.headline || !node.author || !node.datePublished);
  }).length;
  add(articleIncomplete > 0, { runId, url, category: "schema", severity: "medium", code: "schema_article_incomplete", title: "文章 Schema 缺少来源或时效字段", detectionEvidence: `${articleIncomplete} 个文章节点缺少 headline、author 或 datePublished。`, userImpact: "内容主题、责任主体或发布时间不能被稳定机器读取。", recommendedRemediation: "补齐 headline、author、datePublished，并确保值与页面公开内容一致。" });
  add(pageType === "terms" && googleContext && googleOfficialLinks.length === 0, { runId, url, category: "compliance", severity: "low", code: "platform_terms_reference_unlinked", title: "条款提到平台政策但没有官方链接", detectionEvidence: "服务条款提到了 Google Ads、Google API 或 OAuth 政策，但没有检测到对应 Google 官方链接。", userImpact: "操作方难以确认适用政策的准确版本和具体边界。", recommendedRemediation: "在提及第三方平台政策的原文位置链接对应官方条款，并确认其合同适用方式。" });
  add(pageType === "product_service" && googleContext && googleOfficialLinks.length === 0, { runId, url, category: "compliance", severity: "medium", code: "platform_reference_missing", title: "平台数据用途缺少官方依据入口", detectionEvidence: "产品/服务页描述了 Google Ads 或 OAuth 数据使用，但没有检测到 Google 官方政策链接。", userImpact: "用户和平台审核人员无法从功能说明直接核对数据访问依据。", recommendedRemediation: "在数据用途说明附近增加官方平台政策、站内隐私政策和服务条款入口。" });
  add(pageType === "privacy_policy" && googleContext && googleOfficialLinks.length === 0, { runId, url, category: "compliance", severity: "medium", code: "google_data_policy_reference_missing", title: "Google 数据政策缺少官方入口", detectionEvidence: "隐私政策说明了 Google 数据处理，但没有检测到 Google API Services User Data Policy 等官方链接。", userImpact: "用户和 OAuth 审核人员难以快速核对数据处理承诺与平台规则。", recommendedRemediation: "直接链接适用的 Google 用户数据政策，并让公开承诺与实际处理保持一致。" });
  const privacyControls = pageType === "privacy_policy" && googleContext ? [
    ["数据类别", /information we may process|categories of information|data categories|处理的信息|数据类别/i],
    ["使用目的", /how we use|purpose|使用信息|使用目的/i],
    ["共享与披露", /sharing|disclosure|service provider|共享|披露|服务提供商/i],
    ["保留期限或条件", /retention|retain|保留期限|保留时间|保留.*必要/i],
    ["安全措施", /security|access control|encryption|安全|访问控制|加密/i],
    ["用户删除流程", /delete|deletion|erase|removal request|删除|清除|移除请求/i],
    ["撤销 OAuth 授权步骤", /revoke|disconnect|withdraw authorization|third-party connections|撤销授权|解除连接|第三方连接/i],
    ["OAuth scope 清单", /oauth scopes?|requested scopes?|授权范围|权限范围/i]
  ].filter(([, pattern]) => !(pattern as RegExp).test(visibleText)).map(([label]) => String(label)) : [];
  add(privacyControls.length > 0, { runId, url, category: "compliance", severity: "medium", code: "google_data_controls_incomplete", title: "Google 数据控制说明不完整", detectionEvidence: `未检测到：${privacyControls.join("、")}。`, userImpact: "用户无法完整了解授权范围、数据生命周期以及如何撤销或删除。", recommendedRemediation: "补齐缺失的数据控制说明，并使用生产环境的真实配置和处理时限。", missingControls: privacyControls });
  add(!["terms", "privacy_policy"].includes(pageType) && traceableEvidenceLinks.length === 0 && wordCount >= 200 && claimSignals && !(pageType === "product_service" && googleContext), { runId, url, category: "citability", severity: "medium", code: "source_evidence_missing", title: "可验证主张缺少可追溯来源", detectionEvidence: `检测到数字、比较、研究或行业判断；${externalLinks.length ? `虽有 ${externalLinks.length} 个跨域链接，但没有识别到权威机构、官方文档或明确标注的来源链接` : "没有发现跨域来源链接"}。`, userImpact: "关键事实主张难以被验证或安全引用。", recommendedRemediation: "只为关键数据、定义和比较结论补充可追溯的一手或权威来源。" });
  add(!matches(html, /<ul\b|<ol\b|<table\b/i) && wordCount >= 300, { runId, url, category: "citability", severity: "low", code: "extractable_structure_missing", title: "长正文缺少列表或表格", detectionEvidence: "较长正文中未发现列表或表格结构。", userImpact: "答案片段的抽取边界不够清晰。", recommendedRemediation: "只在适合时使用列表、步骤或比较表，不为得分堆砌结构。" });
  return { findings, evidence: { title, description, canonical, h1Count, wordCount, noindex, lang, validSchema, schemaNodeCount: schemaNodes.length, schemaContextCount, schemaTypes: [...schemaTypes], externalEvidenceLinkCount: externalLinks.length, traceableEvidenceLinkCount: traceableEvidenceLinks.length, pageType, claimSignals, googleOfficialLinkCount: googleOfficialLinks.length } };
}

function extractSitemapUrls(xml: string, scope: URL, maxPages: number) {
  return [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter((value) => { try { const url = new URL(value); return url.hostname === scope.hostname && /^https?:$/.test(url.protocol); } catch { return false; } })
    .slice(0, maxPages);
}

export async function runSiteAudit(input: SiteAuditRunnerInput): Promise<SiteAuditRunnerResult> {
  const scope = await assertSafePublicUrl(input.scopeUrl);
  const maxPages = Math.max(1, Math.min(100, input.maxPages || Number(process.env.SITE_AUDIT_MAX_PAGES) || DEFAULT_MAX_PAGES));
  const findings: SiteAuditRunnerResult["findings"] = [];
  const pages: SiteAuditPageSnapshot[] = [];
  let failedUrlCount = 0;
  let robotsText = "";
  let sitemapUrl = input.sitemapUrl;
  try {
    const robots = await safeFetchText(new URL("/robots.txt", scope).toString());
    if (robots.response.ok) {
      robotsText = robots.text;
      sitemapUrl ||= robotsText.match(/^sitemap\s*:\s*(.+)$/im)?.[1]?.trim();
      const blocked = robotsBlocksCitationBots(robotsText);
      if (blocked.length) findings.push(finding({ runId: input.runId, url: robots.finalUrl, category: "technical", severity: "critical", code: "citation_bots_blocked", title: "AI 搜索抓取器被禁止", detectionEvidence: `robots.txt 禁止：${blocked.join(", ")}`, userImpact: "对应 AI 搜索产品可能无法抓取并引用官网页面。", recommendedRemediation: "区分搜索、训练和用户触发抓取器，按业务政策明确配置 robots.txt。" }));
    }
  } catch { /* missing robots is reported below */ }
  if (!robotsText) findings.push(finding({ runId: input.runId, url: new URL("/robots.txt", scope).toString(), category: "technical", severity: "medium", code: "robots_unavailable", title: "robots.txt 不可用", detectionEvidence: "未能读取有效 robots.txt。", userImpact: "抓取策略不透明，无法确认 AI 搜索访问边界。", recommendedRemediation: "提供符合 RFC 9309 的 robots.txt，并明确搜索型抓取器策略。" }));
  sitemapUrl ||= input.scopeMode === "single_page" ? undefined : new URL("/sitemap.xml", scope).toString();
  let urls = [scope.toString()];
  try {
    if (input.scopeMode === "single_page") throw new Error("single_page_scope");
    const sitemap = await safeFetchText(sitemapUrl!);
    if (sitemap.response.ok) {
      let discovered = extractSitemapUrls(sitemap.text, scope, maxPages);
      if (/<sitemapindex\b/i.test(sitemap.text)) {
        const nestedPages: string[] = [];
        for (const nestedSitemapUrl of discovered.slice(0, 10)) {
          try {
            const nested = await safeFetchText(nestedSitemapUrl);
            if (nested.response.ok) nestedPages.push(...extractSitemapUrls(nested.text, scope, maxPages - nestedPages.length));
            if (nestedPages.length >= maxPages) break;
          } catch { /* keep other sitemap partitions */ }
        }
        discovered = nestedPages;
      }
      urls = [...new Set([scope.toString(), ...discovered])].slice(0, maxPages);
    }
  } catch { sitemapUrl = undefined; }

  for (const requestedUrl of urls) {
    try {
      const fetched = await safeFetchText(requestedUrl);
      if (!fetched.response.ok) throw new Error(`http_${fetched.response.status}`);
      const contentType = fetched.response.headers.get("content-type")?.toLowerCase() || "";
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error(`unsupported_content_type:${contentType.slice(0, 80)}`);
      let auditUrl = fetched.finalUrl;
      let auditHtml = fetched.text;
      let httpStatus = fetched.response.status;
      let renderMode: SiteAuditPageSnapshot["renderMode"] = "raw_html";
      let audit = auditSiteHtml(input.runId, auditUrl, auditHtml);
      let renderStatus: "not_needed" | "rendered" | "unavailable" = "not_needed";
      if (likelyClientRendered(auditHtml, audit.evidence.wordCount)) {
        try {
          const rendered = input.renderPage ? await input.renderPage(auditUrl) : await renderWithConfiguredService(auditUrl);
          auditUrl = rendered.finalUrl ? (await assertSafePublicUrl(rendered.finalUrl)).toString() : auditUrl;
          auditHtml = rendered.html;
          httpStatus = rendered.httpStatus || httpStatus;
          renderMode = "browser_rendered";
          renderStatus = "rendered";
          audit = auditSiteHtml(input.runId, auditUrl, auditHtml);
        } catch {
          renderStatus = "unavailable";
          const contentOnlyCodes = new Set(["missing_h1", "multiple_h1", "thin_content", "source_evidence_missing", "extractable_structure_missing"]);
          audit.findings = audit.findings.filter((item) => !contentOnlyCodes.has(item.code));
          audit.findings.push(finding({ runId: input.runId, url: auditUrl, category: "technical", severity: "medium", code: "javascript_rendering_unverified", title: "客户端渲染内容尚未验证", detectionEvidence: "静态 HTML 正文过少且呈现单页应用特征；未取得浏览器渲染证据。", userImpact: "当前不能可信判断正文结构、证据链接和可引用性。", recommendedRemediation: "配置 SITE_AUDIT_RENDERER_URL 后重跑，或提供可服务端渲染的公开 HTML。" }));
        }
      }
      const { findings: pageFindings, evidence } = audit;
      findings.push(...pageFindings);
      pages.push({
        id: `site-audit-page-${createHash("sha256").update(`${input.runId}:${auditUrl}`).digest("hex").slice(0, 24)}`,
        runId: input.runId, requestedUrl, finalUrl: auditUrl, httpStatus, renderMode,
        contentHash: createHash("sha256").update(auditHtml).digest("hex"), evidence: { ...evidence, renderStatus }, fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      failedUrlCount += 1;
      findings.push(finding({ runId: input.runId, url: requestedUrl, category: "technical", severity: "high", code: "page_fetch_failed", title: "页面抓取失败", detectionEvidence: error instanceof Error ? error.message : "unknown_fetch_error", userImpact: "无法审计页面，也无法证明 AI 抓取器能够读取内容。", recommendedRemediation: "检查状态码、DNS、TLS、CDN 和公开访问策略后重试。" }));
    }
  }

  const experimentalSignals: SiteAuditRunnerResult["experimentalSignals"] = [];
  for (const [code, path, note] of [
    ["llms_txt", "/llms.txt", "社区提案，不是已证明的引用排名因素。"],
    ["ai_discovery", "/.well-known/ai.txt", "实验性发现约定，不计入核心准备度分。"]
  ] as const) {
    try { const result = await safeFetchText(new URL(path, scope).toString()); experimentalSignals.push({ code, status: result.response.ok ? "present" : "missing", note }); }
    catch { experimentalSignals.push({ code, status: "unknown", note }); }
  }
  const score = (categories?: SiteAuditFinding["category"][]) => {
    const selected = categories ? findings.filter((item) => categories.includes(item.category)) : findings;
    const penalties = selected.reduce((sum, item) => sum + ({ critical: 18, high: 10, medium: 5, low: 2 }[item.severity]), 0);
    const raw = pages.length ? Math.max(0, Math.min(100, 100 - penalties / pages.length)) : 0;
    return Math.round(raw * 10) / 10;
  };
  return {
    pages, findings, failedUrlCount,
    coreReadinessScore: score(),
    technicalReadinessScore: score(["technical", "schema"]),
    contentCitabilityScore: score(["content", "citability"]),
    platformComplianceScore: score(["compliance"]),
    experimentalSignals, discoveredSitemapUrl: sitemapUrl
  };
}
