import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import { checkFormalPublishAuth } from "@/lib/formal-publish-client";
import { createPublishJobFromApprovedContent, dispatchPublishJob } from "@/lib/publish-job-service";
import { getRuntimeConfigStatus } from "@/lib/runtime-config";
import type { DirectPublishPlatformKey } from "@/lib/types";
import { getWorkspaceSetting } from "@/lib/workbench-store";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type { ProductionMatrixTask, V5MonthlyPlanRecord } from "./monthly-workspace-contracts";
import { readV5FoundationState } from "./foundation-repository";
import { getV5GovernancePool } from "./knowledge-governance-repository";
import type {
  ChannelReadinessItem,
  ContentDraftArtifact,
  CreateFreeProductionInput,
  DraftSection,
  FreeContentExpressionTypeVersion,
  FreeProductionBatch,
  FreeProductionCatalog,
  FreeProductionCatalogProduct,
  FreeProductionChannel,
  FreeProductionFactInput,
  FreeProductionSourceExcerpt,
  FreeProductionTask,
  RiskAndGapItem
} from "./free-production-contracts";
import { freeProductionChannelLabels } from "./free-production-contracts";
import { buildWechatLayout, contentDigest, createInitialRisks, getCalendarMonthBounds, mergeRegeneratedSections, sanitizePublishMarkdown, summarizeRisks } from "./free-production-compiler";
import { compactFreeProductionSourceExcerpts, normalizeFreeProductionCitations, supportedClaimsFromSections } from "./free-production-evidence";
import { compileExpressionPlan } from "./free-production-expression-plan";
import { assertPublishPayloadSanitized, validateFreeProductionOutput } from "./free-production-output-validator";
import { getActiveFreeContentExpressionTypeVersion, listFreeContentExpressionTypes, markFreeExpressionUsed } from "./free-content-expression-type-service";
import { readFreeExpressionBrandBaseline } from "./free-content-expression-type-repository";
import { readFreeProductionState, updateFreeProductionState, type FreeProductionState } from "./free-production-repository";
import { readMediaLibraryState } from "./media-library-repository";
import {
  JOTO_OFFICIAL_WECHAT_TEMPLATE_ID,
  WORKBENCH_MEDIA_REF_PREFIX,
  markdownSections,
  renderJotoOfficialWechatBody,
  renderJotoOfficialWechatPreviewDocument
} from "./joto-wechat-layout-renderer";
import { updateV5MonthlyState } from "./monthly-repository";
import type { WechatRenderableTemplateId } from "./wechat-presentation-contracts";
import { getActiveWechatTemplate } from "./wechat-layout-selector";
import { renderWechatHtml } from "./wechat-layout-renderer";
import { validateWechatHtml } from "./wechat-layout-validator";
import { HUMAN_WRITING_WECHAT_DIRECTIVES, HUMAN_WRITING_WECHAT_PROFILE_VERSION, isWechatContentChannel } from "./human-writing-wechat";
import { getLatestAihotTrends, type AihotTrendItem } from "./aihot-trend-service";
import {
  buildHotspotIntegrationPrompt,
  buildHotspotRepairPrompt,
  collectHotspotRegressionIssues,
  createHotspotIntegrationPlan,
  parseHotspotModelOutput,
  validateHotspotModelOutput,
  type HotspotModelOutput
} from "./hotspot-integration";

export const MAXIMUM_FREE_PRODUCTION_REPAIR_COUNT = 1;

export class FreeProductionServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly nextAction: string, public readonly details?: string[]) {
    super(message);
    this.name = "FreeProductionServiceError";
  }
}

function actor() {
  return WORKSPACE_ACTOR.actorId;
}

function contentGenerationProvider(): AiProviderKey {
  const provider = process.env.CONTENT_GENERATION_PROVIDER?.trim().toLowerCase() || "qwen";
  if (provider === "qwen" || provider === "deepseek" || provider === "doubao") return provider;
  throw new FreeProductionServiceError(
    500,
    "FREE_PRODUCTION_PROVIDER_INVALID",
    "CONTENT_GENERATION_PROVIDER 不是受支持的正文 Provider。",
    "请将 CONTENT_GENERATION_PROVIDER 设置为 qwen、deepseek 或 doubao 后重启工作台。"
  );
}

function mutationContext(input: { auditReason: string }, header: string | null) {
  const auditReason = String(input.auditReason || "").trim();
  const key = header?.trim() || "";
  if (!auditReason || auditReason.length > 200) throw new FreeProductionServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的操作原因。", "补充操作原因后重试。");
  if (key.length < 8 || key.length > 200) throw new FreeProductionServiceError(400, "INVALID_IDEMPOTENCY_KEY", "写请求必须携带 8 到 200 字符的 x-idempotency-key。", "刷新后重新提交。");
  return { auditReason, key };
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new FreeProductionServiceError(500, "FREE_PRODUCTION_MONTH_RESOLUTION_FAILED", "无法确定当前月份。", "检查服务器时区与 Intl 运行时后重试。");
  return `${year}-${month}`;
}

function idempotent<T>(state: FreeProductionState, key: string, payload: unknown, mutation: () => T): T {
  const requestHash = hash(payload);
  const existing = state.idempotency[key];
  if (existing) { if (existing.requestHash !== requestHash) throw new FreeProductionServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求。", "刷新后重新提交。"); return existing.response as T; }
  const response = mutation();
  state.idempotency[key] = { requestHash, response, createdAt: new Date().toISOString() };
  return response;
}

function replayBatch(state: FreeProductionState, key: string, payload: unknown) {
  const existing = state.idempotency[key];
  if (!existing) return undefined;
  if (existing.requestHash !== hash(payload)) throw new FreeProductionServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求。", "刷新后重新提交。");
  const response = existing.response as FreeProductionBatch;
  return state.batches[response.id] || response;
}

function channelReadiness(): ChannelReadinessItem[] {
  const capabilities = new Map(getRuntimeConfigStatus().capabilities.map((item) => [item.key, item.status]));
  return [
    { channel: "official_website", label: "官网", connected: false, accounts: [], blockingReason: "当前正式发布 bridge 尚未提供官网发布适配器。" },
    { channel: "zhihu", label: "知乎", connected: capabilities.get("zhihu_draft") === "ready" && capabilities.get("wechatsync_bridge") === "ready", accounts: capabilities.get("zhihu_draft") === "ready" ? [{ id: "zhihu-configured", name: "已配置知乎连接" }] : [], blockingReason: capabilities.get("zhihu_draft") === "ready" ? undefined : "知乎发布连接尚未配置。" },
    { channel: "wechat_official_account", label: "公众号", connected: capabilities.get("wechat_mp_draft") === "ready" || capabilities.get("wechatsync_bridge") === "ready", accounts: capabilities.get("wechat_mp_draft") === "ready" || capabilities.get("wechatsync_bridge") === "ready" ? [{ id: "wechat-configured", name: "已配置公众号连接" }] : [], blockingReason: capabilities.get("wechat_mp_draft") === "ready" || capabilities.get("wechatsync_bridge") === "ready" ? undefined : "公众号发布连接尚未配置。" }
  ];
}

function legacyCatalogProducts(): FreeProductionCatalogProduct[] {
  const state = readV5FoundationState();
  const versionById = new Map(state.questionVersions.map((version) => [version.questionVersionId, version]));
  return state.knowledgeBases.filter((knowledgeBase) => knowledgeBase.productionStatus === "ready").map((knowledgeBase) => {
    const questions = state.questions.filter((question) => question.knowledgeReadiness.subjectKnowledgeBaseId === knowledgeBase.knowledgeBaseId);
    const productName = questions.map((question) => versionById.get(question.currentVersionId)?.product).find(Boolean) || knowledgeBase.name;
    const ruleIds = Array.from(new Set(questions.map((question) => question.knowledgeReadiness.productExpressionRulePackageId).filter((value): value is string => Boolean(value))));
    return {
      productId: `product-${knowledgeBase.knowledgeBaseId}`,
      name: productName,
      rulePackages: ruleIds.map((id, index) => ({ id, name: `${productName} 服务表达规则`, version: index + 1, status: "active" as const })),
      knowledgeBases: [{ knowledgeBaseId: knowledgeBase.knowledgeBaseId, name: knowledgeBase.name, sourceSnapshotId: `${knowledgeBase.knowledgeBaseId}:v${knowledgeBase.sourceSnapshotVersion}`, sourceSnapshotHash: knowledgeBase.sourceSnapshotHash, status: "ready" as const }]
    };
  }).filter((product) => product.rulePackages.length);
}

function renderFreeProductionWechatPresentation(artifact: Pick<ContentDraftArtifact, "selectedTitle" | "summary" | "sections" | "articleBody" | "visualSuggestions">, templateId: WechatRenderableTemplateId) {
  if (templateId === JOTO_OFFICIAL_WECHAT_TEMPLATE_ID) {
    const previewBodyHtml = renderJotoOfficialWechatBody({ sections: artifact.sections, visualSuggestions: artifact.visualSuggestions, includeVisualPlaceholders: true, assetReferenceMode: "preview" });
    const publishHtml = renderJotoOfficialWechatBody({ sections: artifact.sections, visualSuggestions: artifact.visualSuggestions, includeVisualPlaceholders: false, assetReferenceMode: "publish" });
    return {
      templateId,
      previewHtml: renderJotoOfficialWechatPreviewDocument({ title: artifact.selectedTitle, summary: artifact.summary, bodyHtml: previewBodyHtml }),
      publishHtml,
      htmlHash: contentDigest(publishHtml),
      validation: validateWechatHtml(publishHtml)
    };
  }
  const publishHtml = renderWechatHtml({ title: artifact.selectedTitle, markdown: artifact.articleBody, templateId });
  return {
    templateId,
    previewHtml: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#f3f3f3}body{padding:24px 0}</style></head><body>${publishHtml}</body></html>`,
    publishHtml,
    htmlHash: contentDigest(publishHtml),
    validation: validateWechatHtml(publishHtml)
  };
}

async function formalCatalogProducts(): Promise<FreeProductionCatalogProduct[]> {
  const pool = getV5GovernancePool();
  const [productResult, materialResult, ruleResult] = await Promise.all([
    pool.query<RowDataPacket[]>(
      "SELECT id, display_name FROM product_entity WHERE status = 'active' ORDER BY updated_at DESC, display_name"
    ),
    pool.query<RowDataPacket[]>(
      `SELECT product_link.product_id, knowledge_base.id AS knowledge_base_id,
              COALESCE(source.title, source.file_name, source.canonical_url, knowledge_base.name) AS source_name,
              revision.id AS source_revision_id, revision.content_hash
       FROM knowledge_base_product_link product_link
       JOIN knowledge_base ON knowledge_base.id = product_link.knowledge_base_id
       JOIN knowledge_base_source_asset source_link ON source_link.knowledge_base_id = knowledge_base.id
       JOIN source_asset source ON source.id = source_link.source_id
       JOIN source_revision revision ON revision.source_id = source.id AND revision.parse_status = 'parsed'
       JOIN source_revision_content content ON content.source_revision_id = revision.id
       WHERE product_link.status = 'active'
         AND source.safety_status = 'passed'
         AND source.status = 'approved_for_claim_extraction'
         AND NOT EXISTS (
           SELECT 1 FROM source_revision newer
           WHERE newer.source_id = revision.source_id
             AND newer.parse_status = 'parsed'
             AND newer.revision_number > revision.revision_number
         )
       ORDER BY product_link.product_id, source_name`,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT package.product_id, version.id, version.version
       FROM product_expression_rule_package package
       JOIN rule_package_version version ON version.id = package.active_version_id
       WHERE package.status = 'active' AND version.status = 'active'`
    )
  ]);
  const products = productResult[0];
  const materials = materialResult[0];
  const rules = ruleResult[0];
  return products.map((product) => {
    const productId = String(product.id);
    const name = String(product.display_name);
    return {
      productId,
      name,
      rulePackages: rules.filter((row) => String(row.product_id) === productId).map((row) => ({
        id: String(row.id),
        name: `${name} 服务表达规则`,
        version: Number(row.version) || 1,
        status: "active" as const
      })),
      knowledgeBases: materials.filter((row) => String(row.product_id) === productId).map((row) => ({
        knowledgeBaseId: String(row.knowledge_base_id),
        name: String(row.source_name),
        sourceSnapshotId: String(row.source_revision_id),
        sourceSnapshotHash: String(row.content_hash),
        status: "ready" as const
      }))
    };
  });
}

export async function getFreeProductionCatalog(): Promise<FreeProductionCatalog> {
  let products: FreeProductionCatalogProduct[];
  try {
    products = await formalCatalogProducts();
  } catch {
    products = legacyCatalogProducts();
  }
  return { products, expressionTypes: (await listFreeContentExpressionTypes()).filter((item) => item.status === "active" && item.activeVersion), channelReadiness: channelReadiness(), currentMonth: currentMonth() };
}
export function getPublishingChannelReadiness() { return channelReadiness(); }

async function ensureMonthlyPlan(month: string, actorId: string) {
  return updateV5MonthlyState((state) => {
    if (state.plans[month]) return state.plans[month];
    const now = new Date().toISOString();
    const plan: V5MonthlyPlanRecord = { id: `monthly-plan-${month}`, version: 1, status: "draft", config: { month, businessGoal: "承载当月公众号单篇生产补充任务", targetDeliverableCount: 0, questionVersionIds: [], quotaRules: [], groups: [] }, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId, matrixTasks: [] };
    state.plans[month] = plan;
    return plan;
  });
}

function selectionFor(input: { sourceMode: FreeContentExpressionTypeVersion["sourceMode"]; productId: string; knowledgeSnapshotIds: string[] }, catalog: FreeProductionCatalog) {
  const product = input.productId ? catalog.products.find((item) => item.productId === input.productId) : undefined;
  const issues: string[] = [];
  if (input.sourceMode === "knowledge" && !product) issues.push("请选择已进入生产池的产品。");
  const rulePackage = product?.rulePackages.find((item) => item.status === "active");
  if (input.sourceMode === "knowledge" && !rulePackage) issues.push("所选产品缺少已激活的产品表达规则包。");
  const availableSnapshots = new Set(product?.knowledgeBases.map((item) => item.sourceSnapshotId) || []);
  if (input.sourceMode === "knowledge" && (!input.knowledgeSnapshotIds.length || input.knowledgeSnapshotIds.some((id) => !availableSnapshots.has(id)))) issues.push("请选择与产品一致的可用知识资料。");
  return { product, rulePackage, issues };
}

async function knowledgeFor(knowledgeSnapshotIds: string[], product?: FreeProductionCatalogProduct) {
  if (!product) return [];
  try {
    const pool = getV5GovernancePool();
    const placeholders = knowledgeSnapshotIds.map(() => "?").join(",");
    if (placeholders) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT revision.id AS source_revision_id, revision.content_hash, content.normalized_text,
                COALESCE(source.title, source.file_name, source.canonical_url, knowledge_base.name) AS source_name,
                knowledge_base.id AS knowledge_base_id
         FROM source_revision revision
         JOIN source_asset source ON source.id = revision.source_id
         JOIN source_revision_content content ON content.source_revision_id = revision.id
         JOIN knowledge_base_source_asset source_link ON source_link.source_id = source.id
         JOIN knowledge_base ON knowledge_base.id = source_link.knowledge_base_id
         JOIN knowledge_base_product_link product_link ON product_link.knowledge_base_id = knowledge_base.id
         WHERE product_link.product_id = ? AND product_link.status = 'active'
           AND source.safety_status = 'passed'
           AND revision.id IN (${placeholders})`,
        [product.productId, ...knowledgeSnapshotIds]
      );
      if (rows.length) {
        const revisionIds = rows.map((row) => String(row.source_revision_id));
        const [claimRows] = await pool.query<RowDataPacket[]>(
          `SELECT source_revision_id, normalized_claim, original_quote, limitations
           FROM product_claim
           WHERE product_id = ? AND source_revision_id IN (${revisionIds.map(() => "?").join(",")})
             AND review_status IN ('supported', 'conditional')
           ORDER BY created_at`,
          [product.productId, ...revisionIds]
        );
        return rows.map((row) => {
          const revisionId = String(row.source_revision_id);
          const claims = claimRows.filter((claim) => String(claim.source_revision_id) === revisionId);
          const normalizedText = String(row.normalized_text || "").trim();
          const evidence = claims.length
            ? claims.map((claim) => ({ summary: String(claim.normalized_claim), evidenceExcerpt: String(claim.original_quote || claim.normalized_claim), limitation: String(claim.limitations || "") }))
            : (normalizedText.match(/[\s\S]{1,600}/g) || []).slice(0, 12).map((excerpt) => ({ summary: excerpt, evidenceExcerpt: excerpt }));
          return {
            knowledgeBaseId: String(row.knowledge_base_id),
            name: String(row.source_name),
            sourceSnapshotId: revisionId,
            sourceSnapshotHash: String(row.content_hash),
            evidence
          };
        });
      }
    }
  } catch {
    // Keep the file-backed V5 foundation available for offline development and historical tasks.
  }
  const foundation = readV5FoundationState();
  return product.knowledgeBases.filter((item) => knowledgeSnapshotIds.includes(item.sourceSnapshotId)).map((item) => ({
    knowledgeBaseId: item.knowledgeBaseId,
    name: item.name,
    sourceSnapshotId: item.sourceSnapshotId,
    sourceSnapshotHash: item.sourceSnapshotHash,
    evidence: foundation.knowledgeUnderstanding.filter((understanding) => foundation.knowledgeMaterials.find((material) => material.materialId === understanding.materialId)?.knowledgeBaseId === item.knowledgeBaseId).map((understanding) => ({ summary: understanding.summary, evidenceExcerpt: understanding.evidenceExcerpt, sourceOwner: understanding.sourceOwner, visibility: understanding.visibility, limitation: understanding.limitation }))
  }));
}

function normalizeFactItems(items: FreeProductionFactInput[]) {
  return (items || []).map((item) => ({
    time: String(item.time || "").trim(),
    location: String(item.location || "").trim(),
    people: String(item.people || "").trim(),
    event: String(item.event || "").trim(),
    publicConfirmed: item.publicConfirmed === true
  }));
}

function meetingTextExcerpts(value: string) {
  const paragraphs = value.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.flatMap((paragraph) => paragraph.match(/[\s\S]{1,600}/g) || []).slice(0, 24);
}

export function buildFreeProductionSourceExcerpts(input: { knowledge: Awaited<ReturnType<typeof knowledgeFor>>; factItems: FreeProductionFactInput[]; meetingText: string; retrievalQuery?: string }) {
  const knowledgeSources: FreeProductionSourceExcerpt[] = input.knowledge.flatMap((item) => (item.evidence as Array<{ evidenceExcerpt?: string; summary?: string }>).flatMap((evidence, index) => {
    const excerpt = String(evidence.evidenceExcerpt || evidence.summary || "").trim();
    return excerpt ? [{ id: `source-${randomUUID()}`, sourceType: "knowledge" as const, excerpt, sourceSnapshotId: item.sourceSnapshotId, sourceSnapshotHash: item.sourceSnapshotHash, sourceName: item.name }] : [];
  }));
  const factSources: FreeProductionSourceExcerpt[] = input.factItems.map((item) => ({
    id: `source-${randomUUID()}`,
    sourceType: "human_fact",
    excerpt: [`时间：${item.time}`, `地点：${item.location}`, `人物：${item.people}`, `事件：${item.event}`].join("\n")
  }));
  const meetingSources: FreeProductionSourceExcerpt[] = meetingTextExcerpts(input.meetingText).map((excerpt) => ({ id: `source-${randomUUID()}`, sourceType: "meeting_text", excerpt }));
  return compactFreeProductionSourceExcerpts([...knowledgeSources, ...factSources, ...meetingSources], input.retrievalQuery);
}

function parseProviderJson(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回 JSON 对象。");
  const value = JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
  const titleCandidates = Array.isArray(value.titleCandidates) ? value.titleCandidates.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 3) : [];
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const sections = Array.isArray(value.sections) ? value.sections.flatMap((item): DraftSection[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const citations = Array.isArray(record.citations) ? record.citations.flatMap((citation) => {
      if (!citation || typeof citation !== "object") return [];
      const citationRecord = citation as Record<string, unknown>;
      const claimText = typeof citationRecord.claimText === "string" ? citationRecord.claimText.trim() : "";
      const sourceIds = Array.isArray(citationRecord.sourceIds) ? citationRecord.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string").map((sourceId) => sourceId.trim()).filter(Boolean) : [];
      return claimText && sourceIds.length ? [{ claimText, sourceIds }] : [];
    }) : [];
    return typeof record.sectionKey === "string" && typeof record.heading === "string" && typeof record.markdown === "string" ? [{ sectionKey: record.sectionKey.trim(), heading: record.heading.trim(), markdown: record.markdown.trim(), citations }] : [];
  }) : [];
  return { titleCandidates, summary, sections };
}

function generationPrompt(input: { batch: FreeProductionBatch; expression: FreeContentExpressionTypeVersion; knowledge: Array<Record<string, unknown>>; brandBaseline: Record<string, unknown>; affectedSectionKeys?: string[]; currentArtifact?: ContentDraftArtifact }) {
  const schema = { titleCandidates: ["标题1", "标题2", "标题3"], summary: "80字以内摘要", sections: input.expression.structureModules.map((sectionKey) => ({ sectionKey, heading: "中文章节标题", markdown: "该章节正文", citations: [{ claimText: "正文中由来源支持的具体主张", sourceIds: ["source-id"] }] })) };
  const humanWritingProfile = isWechatContentChannel(input.batch.channelConfig.channel)
    ? { version: HUMAN_WRITING_WECHAT_PROFILE_VERSION, directives: HUMAN_WRITING_WECHAT_DIRECTIVES }
    : undefined;
  return {
    systemPrompt: "你是 JOTO 企业公众号内容生产助手。只能使用提供的知识、补充事实和规则，不得猜测客户名称、数据、上线状态、合作范围、能力边界、CTA 或合规结论。缺失事实直接省略，不写待补充标记。每个章节都必须为实际采用的事实主张填写 citations，只能引用 sourceExcerpts 中真实存在的 id；不要引用没有写进正文的候选资料，也不要编造 sourceId。严格输出单个 JSON 对象，不输出 Markdown 代码围栏或解释。",
    userPrompt: JSON.stringify({
      task: input.affectedSectionKeys?.length ? "只重写 affectedSectionKeys 对应章节；其余章节原样返回，最终仍输出完整 sections。" : "生成一篇单篇渠道正文。",
      subjectName: input.batch.productName || "JOTO",
      expression: { presetKey: input.expression.presetKey, contentGoal: input.expression.contentGoal, audience: input.expression.defaultAudience, audienceLens: input.expression.audienceLensPolicy, titleStrategy: input.expression.defaultTitleStrategyKey, structureModules: input.expression.structureModules, length: input.expression.recommendedLength, expressionConfig: input.expression.expressionConfig, promotionConfig: input.expression.promotionConfig, requirements: input.expression.additionalWritingRequirements },
      knowledgeMetadata: input.knowledge.map((item) => ({ name: item.name, sourceSnapshotId: item.sourceSnapshotId })),
      sourceExcerpts: input.batch.sourceExcerpts.map(({ id, sourceType, excerpt, sourceName }) => ({ id, sourceType, excerpt, sourceName })),
      expressionFocus: input.batch.expressionFocus,
      supplementalFacts: input.batch.inputSnapshots.at(-1)?.supplementalFacts || {},
      brandBaseline: input.brandBaseline,
      humanWritingProfile,
      affectedSectionKeys: input.affectedSectionKeys,
      currentSections: input.currentArtifact?.sections,
      outputSchema: schema
    })
  };
}

function articleBody(title: string, sections: DraftSection[]) { return [`# ${title}`, ...sections.map((section) => `## ${section.heading}\n\n${section.markdown}`)].join("\n\n"); }

async function generateArtifact(input: { batch: FreeProductionBatch; expression: FreeContentExpressionTypeVersion; knowledge: Array<Record<string, unknown>>; brandBaseline: Record<string, unknown>; affectedSectionKeys?: string[]; currentArtifact?: ContentDraftArtifact }) {
  const prompt = generationPrompt(input);
  const provider = contentGenerationProvider();
  let response = await callAiProvider({ provider, ...prompt, temperature: 0.25 });
  if (!response.ok || !response.content) return { ok: false as const, code: response.status === "pending_config" ? "provider_config_missing" : "generation_failed", message: response.status === "pending_config" ? "正式正文模型尚未配置。" : response.errorMessage || "正文模型调用失败。", nextAction: response.status === "pending_config" ? "在配置管理中补齐正式正文 Provider 后重试。" : "检查模型服务后安全重试。" };
  let parsed: ReturnType<typeof parseProviderJson>;
  try { parsed = parseProviderJson(response.content); } catch (error) { parsed = { titleCandidates: [], summary: "", sections: [] }; }
  parsed.sections = normalizeFreeProductionCitations(parsed.sections, input.batch.sourceExcerpts);
  if (input.affectedSectionKeys?.length && input.currentArtifact) {
    parsed.sections = mergeRegeneratedSections(input.currentArtifact.sections, parsed.sections, input.affectedSectionKeys);
    parsed.titleCandidates = parsed.titleCandidates.length === 3 ? parsed.titleCandidates : input.currentArtifact.titleCandidates;
    parsed.summary = parsed.summary || input.currentArtifact.summary;
  }
  let validation = validateFreeProductionOutput({ expression: input.expression, productName: input.batch.productName || "JOTO", ...parsed });
  let repairCount: 0 | 1 = 0;
  if (validation.repairableIssues.length && !validation.blockingIssues.length) {
    response = await callAiProvider({ provider, systemPrompt: prompt.systemPrompt, userPrompt: `${prompt.userPrompt}\n\n上次输出未通过确定性检查：${validation.repairableIssues.join("；")}。只修复这些结构与表达问题，仍输出完整 JSON。`, temperature: 0.15 });
    repairCount = 1;
    if (response.ok && response.content) {
      try { parsed = parseProviderJson(response.content); } catch { /* Preserve the last parse for actionable failure reporting. */ }
      parsed.sections = normalizeFreeProductionCitations(parsed.sections, input.batch.sourceExcerpts);
      validation = validateFreeProductionOutput({ expression: input.expression, productName: input.batch.productName || "JOTO", ...parsed });
    }
  }
  const selectedTitle = parsed.titleCandidates[0] || `${input.batch.productName || "JOTO"}：一段真实工作流的变化`;
  const body = articleBody(selectedTitle, parsed.sections);
  return { ok: true as const, parsed, selectedTitle, body, validation, repairCount };
}

function hotspotSourceExcerpt(hotspot: AihotTrendItem): FreeProductionSourceExcerpt {
  return {
    id: `source-${randomUUID()}`,
    sourceType: "trend_signal",
    excerpt: [hotspot.title, hotspot.summary, hotspot.selectionReason].filter(Boolean).join("\n"),
    sourceSnapshotId: hotspot.id,
    sourceSnapshotHash: hash(hotspot),
    sourceName: hotspot.sourceName,
    originalUrl: hotspot.originalUrl,
    aihotUrl: hotspot.aihotUrl,
    publishedAt: hotspot.publishedAt
  };
}

async function generateHotspotIntegration(input: {
  batch: FreeProductionBatch;
  artifact: ContentDraftArtifact;
  expression: FreeContentExpressionTypeVersion;
  knowledge: Array<Record<string, unknown>>;
  brandBaseline: Record<string, unknown>;
  candidates: AihotTrendItem[];
  excludedHotspotIds: string[];
}) {
  const prompt = buildHotspotIntegrationPrompt({
    expression: input.expression,
    artifact: input.artifact,
    productName: input.batch.productName || "JOTO",
    productKnowledge: input.knowledge,
    brandBaseline: input.brandBaseline,
    candidates: input.candidates,
    excludedHotspotIds: input.excludedHotspotIds
  });
  const provider = contentGenerationProvider();
  let response = await callAiProvider({ provider, ...prompt, temperature: 0.2 });
  if (!response.ok || !response.content) {
    throw new FreeProductionServiceError(
      response.status === "pending_config" ? 422 : 503,
      response.status === "pending_config" ? "FREE_PRODUCTION_HOTSPOT_PROVIDER_MISSING" : "FREE_PRODUCTION_HOTSPOT_GENERATION_FAILED",
      response.status === "pending_config" ? "热点融入模型尚未配置。" : response.errorMessage || "热点融入模型调用失败。",
      response.status === "pending_config" ? "补齐正式正文 Provider 后重试。" : "保留当前正文，稍后重新点击融入热点。"
    );
  }
  let output: HotspotModelOutput;
  try {
    output = parseHotspotModelOutput(response.content);
  } catch (error) {
    throw new FreeProductionServiceError(502, "FREE_PRODUCTION_HOTSPOT_OUTPUT_INVALID", "模型没有返回可用的热点融入计划。", "当前正文未变化，请重新点击融入热点。", [error instanceof Error ? error.message : "invalid_model_output"]);
  }
  if (output.decision === "skip") {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_NO_SUITABLE_HOTSPOT", "最近没有与当前正文自然相关的热点。", "正文未发生变化；稍后有新热点时再试。", [output.selectionReason || "模型判断当前候选均不适合融入"]);
  }
  let contractIssues = validateHotspotModelOutput({ output, expression: input.expression, candidates: input.candidates });
  const baselineValidation = validateFreeProductionOutput({
    expression: input.expression,
    productName: input.batch.productName || "JOTO",
    titleCandidates: input.artifact.titleCandidates,
    summary: input.artifact.summary,
    sections: input.artifact.sections
  });
  let mergedSections = mergeRegeneratedSections(input.artifact.sections, output.sections, output.affectedSectionKeys);
  let validation = validateFreeProductionOutput({
    expression: input.expression,
    productName: input.batch.productName || "JOTO",
    titleCandidates: output.titleCandidates,
    summary: output.summary,
    sections: mergedSections
  });
  const regressionIssues = () => collectHotspotRegressionIssues({
    contractIssues,
    baselineBlockingIssues: baselineValidation.blockingIssues,
    baselineRepairableIssues: baselineValidation.repairableIssues,
    nextBlockingIssues: validation.blockingIssues,
    nextRepairableIssues: validation.repairableIssues
  });
  const lockedHotspotId = output.hotspotId && input.candidates.some((item) => item.id === output.hotspotId) ? output.hotspotId : undefined;
  let issues = regressionIssues();
  if (issues.length) {
    response = await callAiProvider({
      provider,
      systemPrompt: prompt.systemPrompt,
      userPrompt: buildHotspotRepairPrompt({ originalUserPrompt: prompt.userPrompt, previousOutput: output, issues, lockedHotspotId }),
      temperature: 0.1
    });
    if (response.ok && response.content) {
      try {
        output = parseHotspotModelOutput(response.content);
        contractIssues = validateHotspotModelOutput({ output, expression: input.expression, candidates: input.candidates });
        if (lockedHotspotId && output.hotspotId !== lockedHotspotId) contractIssues.push("自动修订不得更换已经选定的热点。");
        mergedSections = mergeRegeneratedSections(input.artifact.sections, output.sections, output.affectedSectionKeys);
        validation = validateFreeProductionOutput({ expression: input.expression, productName: input.batch.productName || "JOTO", titleCandidates: output.titleCandidates, summary: output.summary, sections: mergedSections });
      } catch {
        // Preserve the first result so the caller receives deterministic validation details.
      }
    }
    issues = regressionIssues();
  }
  if (issues.length) {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_HOTSPOT_VALIDATION_FAILED", "热点融入结果未通过正文检查。", "当前正文未变化，请更换热点或稍后重试。", issues);
  }
  const hotspot = input.candidates.find((item) => item.id === output.hotspotId)!;
  return { output, hotspot, sections: mergedSections, validation };
}

async function runGeneration(batchId: string, options?: { affectedSectionKeys?: string[]; auditReason?: string; actorId?: string }) {
  const state = await readFreeProductionState();
  const batch = state.batches[batchId];
  if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回表达列表后刷新。");
  const expression = await getActiveFreeContentExpressionTypeVersion(batch.freeContentExpressionTypeVersionId);
  const catalog = await getFreeProductionCatalog();
  const selection = selectionFor(batch, catalog);
  if (selection.issues.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CONFIG_INVALID", "当前资料暂时不可生产。", "返回内容类型并重新选择资料。", selection.issues);
  const knowledge = await knowledgeFor(batch.knowledgeSnapshotIds, selection.product);
  const taskExpression = { ...expression, productId: batch.productId, knowledgeSnapshotIds: batch.knowledgeSnapshotIds };
  const brandBaseline = await readFreeExpressionBrandBaseline();
  const previousPlan = batch.expressionPlans.find((item) => item.id === batch.currentExpressionPlanId);
  const supplementalFacts = {
    expression_focus: batch.expressionFocus,
    fact_items: batch.factItems.map((item) => `${item.time}｜${item.location}｜${item.people}｜${item.event}`).join("\n"),
    meeting_text: batch.meetingText || "",
    ...Object.fromEntries(batch.risks.filter((risk) => risk.status === "ready" && risk.value).map((risk) => [risk.key, risk.value!]))
  };
  const plan = compileExpressionPlan({ batchId, expression: taskExpression, knowledgeSnapshots: knowledge, supplementalFacts, previousPlan });
  const inputSnapshot = {
    id: `free-input-${randomUUID()}`,
    productExpressionRuleSnapshot: { id: batch.productExpressionRulePackageVersionId, productId: batch.productId, status: "active" },
    knowledgeSnapshots: knowledge,
    brandExpressionBaselineSnapshot: brandBaseline,
    freeContentExpressionPresetSnapshot: taskExpression,
    sourceRuleVersion: expression.sourceRuleVersion,
    sourceRuleDigest: expression.sourceRuleDigest,
    audienceLens: expression.audienceLensPolicy,
    titleStrategy: expression.defaultTitleStrategyKey,
    channelRuleSnapshot: expression.channelBinding,
    supplementalFacts,
    expressionPlanId: plan.id,
    createdAt: new Date().toISOString(),
    snapshotHash: ""
  };
  inputSnapshot.snapshotHash = hash(inputSnapshot);
  await updateFreeProductionState((current) => {
    const target = current.batches[batchId];
    target.status = "generating";
    target.failureCode = undefined;
    target.failureMessage = undefined;
    target.nextAction = undefined;
    target.expressionPlans = target.expressionPlans.map((item) => item.id === target.currentExpressionPlanId ? { ...item, status: "superseded" } : item);
    target.expressionPlans.push(plan);
    target.currentExpressionPlanId = plan.id;
    target.inputSnapshots.push(inputSnapshot);
    target.generationInputSnapshotId = inputSnapshot.id;
    target.updatedAt = new Date().toISOString();
  });
  const currentArtifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  const generated = await generateArtifact({ batch: { ...batch, inputSnapshots: [...batch.inputSnapshots, inputSnapshot] }, expression: taskExpression, knowledge, brandBaseline, affectedSectionKeys: options?.affectedSectionKeys, currentArtifact });
  if (!generated.ok) {
    await updateFreeProductionState((current) => { const target = current.batches[batchId]; target.status = "generation_failed"; target.failureCode = generated.code; target.failureMessage = generated.message; target.nextAction = generated.nextAction; target.version += 1; target.updatedAt = new Date().toISOString(); });
    return getFreeProductionBatch(batchId);
  }
  const wechatPresentation = batch.channelConfig.channel === "wechat_official_account"
    ? (() => {
        const previewBodyHtml = renderJotoOfficialWechatBody({
          sections: generated.parsed.sections,
          visualSuggestions: plan.visualMaterialPlan,
          includeVisualPlaceholders: true,
          assetReferenceMode: "preview"
        });
        const publishHtml = renderJotoOfficialWechatBody({
          sections: generated.parsed.sections,
          visualSuggestions: plan.visualMaterialPlan,
          includeVisualPlaceholders: false,
          assetReferenceMode: "publish"
        });
        return {
          templateId: JOTO_OFFICIAL_WECHAT_TEMPLATE_ID,
          previewHtml: renderJotoOfficialWechatPreviewDocument({
            title: generated.selectedTitle,
            summary: generated.parsed.summary,
            bodyHtml: previewBodyHtml
          }),
          publishHtml,
          htmlHash: contentDigest(publishHtml),
          validation: validateWechatHtml(publishHtml)
        };
      })()
    : undefined;
  return updateFreeProductionState((current) => {
    const target = current.batches[batchId];
    const now = new Date().toISOString();
    const validationRisks: RiskAndGapItem[] = [
      ...generated.validation.blockingIssues.map((issue) => ({ id: `risk-${randomUUID()}`, key: "output_blocker", title: "正文事实或合规冲突", reason: issue, status: "blocked" as const, affectedSectionKeys: expression.structureModules })),
      ...generated.validation.repairableIssues.map((issue) => ({ id: `risk-${randomUUID()}`, key: "output_structure", title: "正文结构未通过检查", reason: issue, status: "blocked" as const, affectedSectionKeys: expression.structureModules })),
      ...generated.validation.advisoryIssues.map((issue) => ({ id: `risk-${randomUUID()}`, key: `advisory-${hash(issue).slice(0, 8)}`, title: "阅读体验建议", reason: issue, status: "warning" as const, affectedSectionKeys: [] }))
    ];
    target.risks = [...target.risks.filter((risk) => !["output_blocker", "output_structure"].includes(risk.key) && !risk.key.startsWith("advisory-")), ...validationRisks];
    target.riskAndGapSummary = summarizeRisks(target.risks);
    const artifactPartial = {
      id: `free-artifact-${randomUUID()}`,
      expressionPlanId: plan.id,
      generationInputSnapshotId: inputSnapshot.id,
      titleCandidates: generated.parsed.titleCandidates,
      selectedTitle: generated.selectedTitle,
      summary: generated.parsed.summary,
      sections: generated.parsed.sections,
      articleBody: generated.body,
      channelLayoutTree: buildWechatLayout({ selectedTitle: generated.selectedTitle, summary: generated.parsed.summary, sections: generated.parsed.sections }),
      visualSuggestions: plan.visualMaterialPlan,
      wechatPresentation,
      sourceExcerpts: target.sourceExcerpts,
      factCheck: { supportedClaims: supportedClaimsFromSections(generated.parsed.sections, target.sourceExcerpts), needsConfirmation: target.risks.filter((risk) => risk.status === "needs_approval").map((risk) => risk.title), rejectedClaims: generated.validation.blockingIssues },
      editorCheck: { deterministicResults: generated.validation.repairableIssues, advisoryResults: generated.validation.advisoryIssues },
      riskAndGapSnapshot: target.risks,
      contentDigest: wechatPresentation?.htmlHash || contentDigest(generated.body),
      createdAt: now,
      version: (currentArtifact?.version || 0) + 1
    };
    const artifact = artifactPartial satisfies ContentDraftArtifact;
    target.draftArtifacts.push(artifact);
    target.currentDraftArtifactId = artifact.id;
    target.status = target.risks.some((risk) => ["needs_input", "needs_approval"].includes(risk.status)) ? "needs_input" : target.risks.some((risk) => risk.status === "blocked") ? "blocked" : "ready_for_confirmation";
    target.repairCount = generated.repairCount;
    target.failureCode = undefined; target.failureMessage = undefined; target.nextAction = undefined;
    target.version += 1; target.updatedAt = now;
    const task = current.tasks[`free-task-${batchId}`];
    if (task) { task.status = target.status; task.title = artifact.selectedTitle; task.contentDigest = artifact.contentDigest; task.updatedAt = now; }
    current.audits.push({ auditId: randomUUID(), action: options?.affectedSectionKeys?.length ? "free_production_rechecked" : "free_production_generated", objectId: batchId, actor: options?.actorId || target.createdBy, auditReason: options?.auditReason || "自动编译表达并生成安全草稿", createdAt: now, summary: { expressionPlanVersion: plan.version, artifactVersion: artifact.version, affectedSectionKeys: options?.affectedSectionKeys, contentDigest: artifact.contentDigest } });
    return target;
  });
}

export async function createFreeProductionFromExpression(input: CreateFreeProductionInput, header: string | null) {
  const actorId = actor(); const context = mutationContext(input, header);
  if (input.expectedVersion !== 0) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VERSION_CONFLICT", "新建任务的 expectedVersion 必须为 0。", "刷新后重新使用表达。");
  const replay = replayBatch(await readFreeProductionState(), context.key, input);
  if (replay) return replay;
  const expression = await getActiveFreeContentExpressionTypeVersion(input.expressionTypeVersionId);
  const expressionFocus = String(input.expressionFocus || "").trim();
  if (!expressionFocus || expressionFocus.length > 1200) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_FOCUS_INVALID", "请填写 1200 字以内的表达重点。", "补充本次正文需要强调的观点后再生成。");
  const factItems = normalizeFactItems(input.factItems || []);
  const meetingText = String(input.meetingText || "").replace(/\r\n?/g, "\n").trim();
  if (expression.sourceMode !== "knowledge") {
    if (!factItems.length || factItems.some((item) => !item.time || !item.location || !item.people || !item.event || !item.publicConfirmed)) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_FACTS_INVALID", "时间、地点、人物、事件和公开确认必须完整。", "补齐至少一条可公开事件后再生成。");
  }
  if (expression.sourceMode === "facts_with_meeting_text" && (!meetingText || meetingText.length > 100000)) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_MEETING_TEXT_INVALID", "请粘贴 10 万字以内的会议文本。", "仅粘贴纯文本或 Markdown 内容后重试。");
  const catalog = await getFreeProductionCatalog();
  const knowledgeSnapshotIds = Array.from(new Set(input.knowledgeSnapshotIds || []));
  const selection = selectionFor({ sourceMode: expression.sourceMode, productId: String(input.productId || ""), knowledgeSnapshotIds }, catalog);
  if (selection.issues.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CONFIG_INVALID", "当前资料暂时不可生产。", "重新选择产品和知识资料后再生成。", selection.issues);
  const knowledge = await knowledgeFor(knowledgeSnapshotIds, selection.product);
  const sourceExcerpts = buildFreeProductionSourceExcerpts({ knowledge, factItems, meetingText, retrievalQuery: `${expressionFocus} ${selection.product?.name || ""}` });
  if (!sourceExcerpts.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SOURCE_EMPTY", "所选资料中没有可追溯的原始片段。", "选择包含原文片段的知识资料，或补充事件事实后再生成。");
  const month = currentMonth(); const bounds = getCalendarMonthBounds(month); const monthlyPlan = await ensureMonthlyPlan(month, actorId);
  const creation = await updateFreeProductionState((state) => {
    const existing = replayBatch(state, context.key, input);
    if (existing) return { batch: existing, created: false };
    const now = new Date().toISOString(); const id = `free-batch-${randomUUID()}`;
    const risks = createInitialRisks(expression).filter((risk) => risk.key === "wechat_cover");
    const value: FreeProductionBatch = {
      id,
      monthlyPlanId: monthlyPlan.id,
      ...bounds,
      productId: selection.product?.productId || "",
      productName: selection.product?.name || "",
      productExpressionRulePackageVersionId: selection.rulePackage?.id || "",
      knowledgeSnapshotIds,
      freeContentExpressionTypeVersionId: expression.freeContentExpressionTypeVersionId,
      sourceMode: expression.sourceMode,
      expressionFocus,
      factItems,
      meetingText: meetingText || undefined,
      sourceExcerpts,
      supplementalMaterialRefs: [],
      riskAndGapSummary: summarizeRisks(risks),
      channelConfig: expression.channelBinding,
      publishPolicy: "automatic_after_confirmation",
      status: "compiling",
      repairCount: 0,
      risks,
      expressionPlans: [],
      inputSnapshots: [],
      draftArtifacts: [],
      idempotencyKey: context.key,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    state.batches[id] = value;
    const task: FreeProductionTask = { id: `free-task-${id}`, batchId: id, monthlyPlanId: monthlyPlan.id, planningSource: "free_production", freeContentExpressionTypeVersionId: expression.freeContentExpressionTypeVersionId, channel: expression.channelBinding.channel, status: "compiling", createdAt: now, updatedAt: now };
    state.tasks[task.id] = task;
    state.audits.push({ auditId: randomUUID(), action: "free_production_created_from_type", objectId: id, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { expressionTypeVersionId: expression.freeContentExpressionTypeVersionId, sourceMode: expression.sourceMode, sourceCount: sourceExcerpts.length, monthlyPlanId: monthlyPlan.id } });
    state.idempotency[context.key] = { requestHash: hash(input), response: value, createdAt: now };
    return { batch: value, created: true };
  });
  if (!creation.created) return creation.batch;
  await markFreeExpressionUsed(expression.typeId);
  const generated = await runGeneration(creation.batch.id, { auditReason: context.auditReason, actorId });
  await updateFreeProductionState((state) => { if (state.idempotency[context.key]) state.idempotency[context.key].response = generated; });
  return generated;
}

export async function listFreeProductionBatches() { const state = await readFreeProductionState(); return Object.values(state.batches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export async function getFreeProductionBatch(batchId: string) { const state = await readFreeProductionState(); const batch = state.batches[batchId]; if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。"); return batch; }
function version(batch: FreeProductionBatch, expected: number) { if (batch.version !== expected) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VERSION_CONFLICT", "配置已被其他操作更新。", "刷新页面读取最新版本后重试。"); }

export async function integrateFreeProductionHotspot(
  batchId: string,
  input: { expectedVersion: number; auditReason: string; artifactId: string; mode: "integrate" | "replace" },
  header: string | null
) {
  const actorId = actor();
  const context = mutationContext(input, header);
  const requestPayload = { batchId, ...input };
  const replay = replayBatch(await readFreeProductionState(), context.key, requestPayload);
  if (replay) return replay;
  const batch = await getFreeProductionBatch(batchId);
  version(batch, input.expectedVersion);
  if (batch.channelConfig.channel !== "wechat_official_account") {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_HOTSPOT_CHANNEL_UNSUPPORTED", "热点融入当前只用于微信公众号正文。", "返回公众号内容生产后重试。");
  }
  if (["publishing", "published", "cancelled"].includes(batch.status)) {
    throw new FreeProductionServiceError(409, "FREE_PRODUCTION_HOTSPOT_LOCKED", "当前正文已进入发布或结束状态，不能融入热点。", "复制为新正文后再操作。");
  }
  const artifact = batch.draftArtifacts.find((item) => item.id === input.artifactId);
  if (!artifact || artifact.id !== batch.currentDraftArtifactId) {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_HOTSPOT_ARTIFACT_INVALID", "只能为当前正文版本融入热点。", "刷新页面后重试。");
  }
  const expression = await getActiveFreeContentExpressionTypeVersion(batch.freeContentExpressionTypeVersionId);
  const catalog = await getFreeProductionCatalog();
  const product = catalog.products.find((item) => item.productId === batch.productId);
  const [knowledge, brandBaseline, trends] = await Promise.all([
    knowledgeFor(batch.knowledgeSnapshotIds, product),
    readFreeExpressionBrandBaseline(),
    getLatestAihotTrends().catch((error) => {
      throw new FreeProductionServiceError(503, "FREE_PRODUCTION_AIHOT_UNAVAILABLE", "最新热点暂时无法读取。", "当前正文未变化，请稍后重新点击融入热点。", [error instanceof Error ? error.message : "aihot_unavailable"]);
    })
  ]);
  const attemptedHotspotIds = Array.from(new Set(batch.draftArtifacts.flatMap((item) => item.hotspotIntegration?.hotspotId ? [item.hotspotIntegration.hotspotId] : [])));
  const excludedHotspotIds = input.mode === "replace" ? attemptedHotspotIds : [];
  const candidates = trends.items.filter((item) => !excludedHotspotIds.includes(item.id)).slice(0, 30);
  if (!candidates.length) {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_HOTSPOT_CANDIDATES_EXHAUSTED", "当前可用热点都已经尝试过。", "保留当前正文，等待热点库更新后再更换。", attemptedHotspotIds);
  }
  const generated = await generateHotspotIntegration({ batch, artifact, expression, knowledge, brandBaseline, candidates, excludedHotspotIds });
  const trendSource = hotspotSourceExcerpt(generated.hotspot);
  const sourceExcerpts = [...artifact.sourceExcerpts.filter((item) => item.sourceType !== "trend_signal"), trendSource];
  const plan = createHotspotIntegrationPlan({
    output: generated.output,
    hotspot: generated.hotspot,
    hotspotDataUpdatedAt: trends.updatedAt,
    hotspotDataFreshness: trends.freshness
  });
  return updateFreeProductionState((state) => idempotent(state, context.key, requestPayload, () => {
    const target = state.batches[batchId];
    if (!target) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(target, input.expectedVersion);
    const current = target.draftArtifacts.find((item) => item.id === input.artifactId);
    if (!current || current.id !== target.currentDraftArtifactId) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_HOTSPOT_VERSION_CHANGED", "正文已被其他操作更新。", "刷新页面后重新融入热点。");
    const now = new Date().toISOString();
    const title = generated.output.titleCandidates[0];
    const nextSections = normalizeFreeProductionCitations(generated.sections.map((section) => {
      if (!generated.output.affectedSectionKeys.includes(section.sectionKey)) return section;
      const previousCitations = current.sections.find((item) => item.sectionKey === section.sectionKey)?.citations || [];
      return { ...section, citations: [...previousCitations, { claimText: `热点背景：${generated.hotspot.title}`, sourceIds: [trendSource.id] }] };
    }), sourceExcerpts);
    const artifactPartial = {
      id: `free-artifact-${randomUUID()}`,
      previousArtifactId: current.id,
      expressionPlanId: current.expressionPlanId,
      generationInputSnapshotId: current.generationInputSnapshotId,
      titleCandidates: generated.output.titleCandidates,
      selectedTitle: title,
      summary: generated.output.summary,
      sections: nextSections,
      articleBody: articleBody(title, nextSections),
      channelLayoutTree: buildWechatLayout({ selectedTitle: title, summary: generated.output.summary, sections: nextSections }),
      visualSuggestions: current.visualSuggestions,
      sourceExcerpts,
      hotspotIntegration: plan,
      factCheck: {
        supportedClaims: supportedClaimsFromSections(nextSections, sourceExcerpts),
        needsConfirmation: plan.riskNotes,
        rejectedClaims: []
      },
      editorCheck: { deterministicResults: [], advisoryResults: generated.validation.advisoryIssues },
      riskAndGapSnapshot: target.risks,
      contentDigest: "",
      createdAt: now,
      version: current.version + 1
    };
    const nextArtifact: ContentDraftArtifact = {
      ...artifactPartial,
      wechatPresentation: renderFreeProductionWechatPresentation(artifactPartial, current.wechatPresentation?.templateId || JOTO_OFFICIAL_WECHAT_TEMPLATE_ID)
    };
    nextArtifact.contentDigest = nextArtifact.wechatPresentation?.htmlHash || contentDigest(nextArtifact.articleBody);
    target.draftArtifacts.push(nextArtifact);
    target.currentDraftArtifactId = nextArtifact.id;
    target.sourceExcerpts = sourceExcerpts;
    target.sourceReview = undefined;
    target.confirmedContentDigest = undefined;
    target.status = target.risks.some((risk) => ["needs_input", "needs_approval"].includes(risk.status)) ? "needs_input" : target.risks.some((risk) => risk.status === "blocked") ? "blocked" : "ready_for_confirmation";
    target.version += 1;
    target.updatedAt = now;
    const task = state.tasks[`free-task-${target.id}`];
    if (task) { task.title = nextArtifact.selectedTitle; task.contentDigest = nextArtifact.contentDigest; task.status = target.status; task.updatedAt = now; }
    state.audits.push({
      auditId: randomUUID(),
      action: input.mode === "replace" ? "free_production_hotspot_replaced" : "free_production_hotspot_integrated",
      objectId: batchId,
      actor: actorId,
      auditReason: context.auditReason,
      createdAt: now,
      summary: { artifactId: nextArtifact.id, previousArtifactId: current.id, hotspotId: plan.hotspotId, relevanceScore: plan.relevanceScore, affectedSectionKeys: plan.affectedSectionKeys }
    });
    return target;
  }));
}

export async function restorePreviousFreeProductionVersion(
  batchId: string,
  input: { expectedVersion: number; auditReason: string; artifactId: string },
  header: string | null
) {
  const actorId = actor();
  const context = mutationContext(input, header);
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    if (["publishing", "published", "cancelled"].includes(batch.status)) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VERSION_RESTORE_LOCKED", "当前正文已进入发布或结束状态，不能恢复版本。", "复制为新正文后再操作。");
    const current = batch.draftArtifacts.find((item) => item.id === input.artifactId);
    const previous = current?.previousArtifactId ? batch.draftArtifacts.find((item) => item.id === current.previousArtifactId) : undefined;
    if (!current || current.id !== batch.currentDraftArtifactId || !previous) {
      throw new FreeProductionServiceError(422, "FREE_PRODUCTION_PREVIOUS_VERSION_MISSING", "当前正文没有可恢复的上一版本。", "刷新页面后继续编辑当前正文。");
    }
    const now = new Date().toISOString();
    batch.currentDraftArtifactId = previous.id;
    batch.sourceExcerpts = previous.sourceExcerpts;
    batch.sourceReview = previous.sourceReview;
    batch.confirmedContentDigest = undefined;
    batch.version += 1;
    batch.updatedAt = now;
    const task = state.tasks[`free-task-${batch.id}`];
    if (task) { task.title = previous.selectedTitle; task.contentDigest = previous.contentDigest; task.updatedAt = now; }
    state.audits.push({ auditId: randomUUID(), action: "free_production_previous_version_restored", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { fromArtifactId: current.id, restoredArtifactId: previous.id } });
    return batch;
  }));
}

export async function reviewFreeProductionSources(batchId: string, input: { expectedVersion: number; auditReason: string; artifactId: string }, header: string | null) {
  const actorId = actor();
  const context = mutationContext(input, header);
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    const artifact = batch.draftArtifacts.find((item) => item.id === input.artifactId);
    if (!artifact || artifact.id !== batch.currentDraftArtifactId || !artifact.sourceExcerpts.length) {
      throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SOURCE_REVIEW_INVALID", "只能核对当前正文版本且必须存在可追溯来源。", "刷新并查看当前正文的来源片段后重新确认。");
    }
    const now = new Date().toISOString();
    batch.sourceReview = { artifactId: artifact.id, reviewedBy: actorId, reviewedAt: now };
    batch.version += 1;
    batch.updatedAt = now;
    state.audits.push({ auditId: randomUUID(), action: "free_production_sources_reviewed", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { artifactId: artifact.id, sourceCount: artifact.sourceExcerpts.length } });
    return batch;
  }));
}

export async function bindFreeProductionVisualAsset(batchId: string, input: { expectedVersion: number; auditReason: string; artifactId: string; suggestionId: string; mediaAssetId?: string }, header: string | null) {
  const actorId = actor();
  const context = mutationContext(input, header);
  const mediaAssetId = String(input.mediaAssetId || "").trim();
  const mediaAsset = mediaAssetId ? (await readMediaLibraryState()).assets[mediaAssetId] : undefined;
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input, mediaAssetId }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    if (["publishing", "published", "cancelled"].includes(batch.status)) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VISUAL_LOCKED", "当前任务已进入发布或结束状态，不能修改配图。", "复制或重新生成正文后再调整配图。");
    const artifact = batch.draftArtifacts.find((item) => item.id === input.artifactId);
    if (!artifact || artifact.id !== batch.currentDraftArtifactId || !artifact.wechatPresentation) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_VISUAL_ARTIFACT_INVALID", "只能为当前公众号正文绑定配图。", "刷新后在最新正文中重新选择素材。");
    const suggestion = artifact.visualSuggestions.find((item) => item.id === input.suggestionId);
    if (!suggestion) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_VISUAL_SUGGESTION_NOT_FOUND", "配图建议不存在或已经失效。", "刷新正文后重新操作。");
    if (mediaAssetId && (!mediaAsset || mediaAsset.status !== "active")) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_MEDIA_ASSET_NOT_FOUND", "所选素材不存在或已移出图库。", "刷新素材列表后重新选择。");
    if (mediaAsset && mediaAsset.productId !== batch.productId) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_MEDIA_PRODUCT_MISMATCH", "所选素材不属于当前正文产品。", "选择同一产品下的素材。");

    suggestion.boundAssetRef = mediaAsset ? `${WORKBENCH_MEDIA_REF_PREFIX}${mediaAsset.id}` : undefined;
    artifact.wechatPresentation = renderFreeProductionWechatPresentation(artifact, artifact.wechatPresentation.templateId);
    artifact.contentDigest = artifact.wechatPresentation.htmlHash;
    artifact.version += 1;
    batch.confirmedContentDigest = undefined;
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    const task = state.tasks[`free-task-${batch.id}`];
    if (task) { task.contentDigest = artifact.contentDigest; task.updatedAt = batch.updatedAt; }
    state.audits.push({ auditId: randomUUID(), action: mediaAsset ? "free_production_visual_asset_bound" : "free_production_visual_asset_unbound", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: batch.updatedAt, summary: { artifactId: artifact.id, suggestionId: suggestion.id, mediaAssetId: mediaAsset?.id, contentDigest: artifact.contentDigest } });
    return batch;
  }));
}

export async function selectFreeProductionWechatLayout(batchId: string, input: { expectedVersion: number; auditReason: string; artifactId: string; templateId: string }, header: string | null) {
  const actorId = actor();
  const context = mutationContext(input, header);
  const templateId = input.templateId as WechatRenderableTemplateId;
  if (templateId !== JOTO_OFFICIAL_WECHAT_TEMPLATE_ID && !getActiveWechatTemplate(templateId)) {
    throw new FreeProductionServiceError(422, "FREE_PRODUCTION_WECHAT_LAYOUT_INVALID", "所选公众号排版风格不存在或未启用。", "刷新页面后重新选择排版风格。");
  }
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    if (["publishing", "published", "cancelled"].includes(batch.status)) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_LAYOUT_LOCKED", "当前任务已进入发布或结束状态，不能更换排版。", "复制或重新生成正文后再选择排版风格。");
    const artifact = batch.draftArtifacts.find((item) => item.id === input.artifactId);
    if (!artifact || artifact.id !== batch.currentDraftArtifactId || !artifact.wechatPresentation) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_LAYOUT_ARTIFACT_INVALID", "只能调整当前公众号正文版本的排版。", "刷新后在最新正文中重新选择。");
    artifact.wechatPresentation = renderFreeProductionWechatPresentation(artifact, templateId);
    artifact.contentDigest = artifact.wechatPresentation.htmlHash;
    artifact.version += 1;
    batch.confirmedContentDigest = undefined;
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    const task = state.tasks[`free-task-${batch.id}`];
    if (task) { task.contentDigest = artifact.contentDigest; task.updatedAt = batch.updatedAt; }
    state.audits.push({ auditId: randomUUID(), action: "free_production_wechat_layout_selected", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: batch.updatedAt, summary: { artifactId: artifact.id, templateId, contentDigest: artifact.contentDigest } });
    return batch;
  }));
}

export async function editFreeProductionArticle(batchId: string, input: { expectedVersion: number; auditReason: string; artifactId: string; title: string; summary: string; articleBody: string }, header: string | null) {
  const actorId = actor();
  const context = mutationContext(input, header);
  const title = String(input.title || "").trim();
  const summary = String(input.summary || "").trim();
  const editedBody = String(input.articleBody || "").replace(/\r\n?/g, "\n").trim().replace(/^#\s+[^\n]+\n+/, "");
  const articleBody = `# ${title}\n\n${editedBody}`.trim();
  if (!title || title.length > 120) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_TITLE_INVALID", "标题不能为空且不能超过 120 字。", "修改标题后重新保存。");
  if (summary.length > 300) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SUMMARY_INVALID", "摘要不能超过 300 字。", "精简摘要后重新保存。");
  if (!editedBody || articleBody.length > 100000) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_ARTICLE_BODY_INVALID", "正文不能为空且不能超过 10 万字。", "修改正文后重新保存。");
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input, title, summary, articleBody }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    if (["publishing", "published", "cancelled"].includes(batch.status)) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_ARTICLE_LOCKED", "当前任务已进入发布或结束状态，不能编辑正文。", "复制或重新生成正文后再编辑。");
    const artifact = batch.draftArtifacts.find((item) => item.id === input.artifactId);
    if (!artifact || artifact.id !== batch.currentDraftArtifactId || !artifact.wechatPresentation) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_ARTICLE_ARTIFACT_INVALID", "只能编辑当前公众号正文版本。", "刷新后在最新正文中重新编辑。");
    const previousSections = artifact.sections;
    artifact.selectedTitle = title;
    artifact.summary = summary;
    artifact.articleBody = articleBody;
    artifact.sections = markdownSections(title, articleBody).map((section, index) => ({
      ...section,
      sectionKey: previousSections[index]?.sectionKey || section.sectionKey,
      citations: previousSections.find((item) => item.heading === section.heading)?.citations || previousSections[index]?.citations
    }));
    artifact.wechatPresentation = renderFreeProductionWechatPresentation(artifact, artifact.wechatPresentation.templateId);
    artifact.contentDigest = artifact.wechatPresentation.htmlHash;
    artifact.sourceReview = undefined;
    artifact.version += 1;
    batch.sourceReview = undefined;
    batch.confirmedContentDigest = undefined;
    batch.version += 1;
    batch.updatedAt = new Date().toISOString();
    const task = state.tasks[`free-task-${batch.id}`];
    if (task) { task.title = title; task.contentDigest = artifact.contentDigest; task.updatedAt = batch.updatedAt; }
    state.audits.push({ auditId: randomUUID(), action: "free_production_article_edited", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: batch.updatedAt, summary: { artifactId: artifact.id, templateId: artifact.wechatPresentation.templateId, contentDigest: artifact.contentDigest } });
    return batch;
  }));
}

interface FileSupplement { fileName: string; mimeType: string; dataBase64: string; }
async function storeSupplementFile(value: FileSupplement, accepted: string[]) {
  if (!accepted.includes(value.mimeType)) throw new FreeProductionServiceError(422, "SUPPLEMENT_FILE_TYPE_INVALID", "文件类型不符合该缺失项要求。", "选择 JPG、PNG 或 WebP 图片后重试。");
  const data = Buffer.from(value.dataBase64, "base64");
  if (!data.length || data.length > 5 * 1024 * 1024) throw new FreeProductionServiceError(422, "SUPPLEMENT_FILE_SIZE_INVALID", "文件必须大于 0 且不超过 5 MB。", "压缩图片后重试。");
  const assetId = `free-asset-${randomUUID()}`; const directory = path.resolve(process.cwd(), "data/free-production-assets"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, assetId), data, { flag: "wx" });
  return { assetRef: assetId, displayValue: value.fileName.slice(0, 160) };
}

export async function supplementFreeProductionBatch(batchId: string, input: { expectedVersion: number; auditReason: string; supplements: Array<{ riskId: string; value: string | FileSupplement }> }, header: string | null) {
  const actorId = actor(); const context = mutationContext(input, header); const snapshot = await getFreeProductionBatch(batchId); version(snapshot, input.expectedVersion);
  const resolved: Array<{ riskId: string; value: string; assetRef?: string }> = [];
  for (const supplement of input.supplements || []) {
    const risk = snapshot.risks.find((item) => item.id === supplement.riskId);
    if (!risk?.inputSchema || !["needs_input", "needs_approval", "blocked"].includes(risk.status)) throw new FreeProductionServiceError(422, "SUPPLEMENT_RISK_INVALID", "补充内容不对应当前可处理的风险项。", "刷新页面后在对应风险项中重新填写。");
    if (risk.inputSchema.type === "file") {
      if (!supplement.value || typeof supplement.value !== "object") throw new FreeProductionServiceError(422, "SUPPLEMENT_FILE_REQUIRED", "请选择需要上传的素材文件。", "选择文件后重新提交。");
      resolved.push({ riskId: risk.id, ...(await storeSupplementFile(supplement.value, risk.inputSchema.acceptedMimeTypes || [])), value: "" });
    } else {
      const value = typeof supplement.value === "string" ? supplement.value.trim() : "";
      if (!value || (risk.inputSchema.maxLength && value.length > risk.inputSchema.maxLength)) throw new FreeProductionServiceError(422, "SUPPLEMENT_VALUE_INVALID", `${risk.inputSchema.label}未填写或长度超限。`, "按字段提示修改后重试。");
      if (risk.inputSchema.type === "url") { try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { throw new FreeProductionServiceError(422, "SUPPLEMENT_URL_INVALID", "CTA 必须是有效的 HTTP 或 HTTPS 链接。", "检查链接后重试。"); } }
      if (risk.inputSchema.type === "select" && !risk.inputSchema.options?.some((option) => option.value === value)) throw new FreeProductionServiceError(422, "SUPPLEMENT_OPTION_INVALID", "选择值不在该风险项允许范围内。", "重新选择后提交。");
      resolved.push({ riskId: risk.id, value });
    }
  }
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input, supplements: input.supplements.map((item) => ({ riskId: item.riskId, value: typeof item.value === "string" ? item.value : { fileName: item.value.fileName, mimeType: item.value.mimeType, digest: hash(item.value.dataBase64) } })) }, () => {
    const batch = state.batches[batchId]; version(batch, input.expectedVersion); const now = new Date().toISOString();
    for (const item of resolved) { const risk = batch.risks.find((candidate) => candidate.id === item.riskId)!; risk.status = "ready"; risk.value = item.value || risk.value; risk.assetRef = item.assetRef; risk.resolvedAt = now; if (item.assetRef) batch.supplementalMaterialRefs.push(item.assetRef); }
    batch.riskAndGapSummary = summarizeRisks(batch.risks); batch.status = "checking"; batch.version += 1; batch.updatedAt = now;
    state.audits.push({ auditId: randomUUID(), action: "free_production_supplements_saved", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { riskIds: resolved.map((item) => item.riskId) } }); return batch;
  }));
}

export async function recheckFreeProductionBatch(batchId: string, input: { expectedVersion: number; auditReason: string }, header: string | null) {
  const actorId = actor(); const context = mutationContext(input, header); const batch = await getFreeProductionBatch(batchId); version(batch, input.expectedVersion);
  const latestArtifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  if (!latestArtifact) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_DRAFT_MISSING", "当前任务没有可重检正文。", "重新使用表达生成正文。");
  const previousSnapshot = latestArtifact.riskAndGapSnapshot;
  const affected = Array.from(new Set(batch.risks.filter((risk) => risk.status === "ready" && previousSnapshot.find((item) => item.id === risk.id)?.status !== "ready").flatMap((risk) => risk.affectedSectionKeys)));
  if (!affected.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_NO_AFFECTED_SECTIONS", "没有需要局部重生成的已补充内容。", "填写风险项后再提交重新检查。");
  return runGeneration(batchId, { affectedSectionKeys: affected, auditReason: context.auditReason, actorId });
}

function publishPlatform(channel: FreeProductionChannel): DirectPublishPlatformKey | undefined { if (channel === "zhihu") return "zhihu"; if (channel === "wechat_official_account") return "wechat"; return undefined; }
function toMatrixTask(batch: FreeProductionBatch, artifact: ContentDraftArtifact, expression: FreeContentExpressionTypeVersion): ProductionMatrixTask {
  return { taskId: `free-task-${batch.id}`, monthlyPlanId: batch.monthlyPlanId, planningSource: "free_production", freeProductionBatchId: batch.id, freeContentExpressionTypeVersionId: expression.freeContentExpressionTypeVersionId, strategyPackageId: "", quotaRuleId: "", questionVersionId: "", question: "公众号单篇生产补充任务", baseTopicIndex: 1, title: artifact.selectedTitle, contentType: expression.name, articleTypeProfileVersionId: "", articleTypeNameSnapshot: expression.name, typeMatchRunId: "", typeSelectionSource: "user_selected", matchReasonSnapshot: "用户选择公众号内容表达预设", articleTypePromptConstraintSnapshot: JSON.stringify(expression), articleTypePromptConstraintSnapshotHash: expression.snapshotHash, channel: freeProductionChannelLabels[batch.channelConfig.channel], rulePackageVersionId: batch.productExpressionRulePackageVersionId, knowledgeBaseIds: batch.knowledgeSnapshotIds, sourceSnapshotHash: batch.inputSnapshots.at(-1)?.snapshotHash || "", evidencePackSourceSnapshotHash: batch.inputSnapshots.at(-1)?.snapshotHash || "", status: "available", recoveryAttemptCount: 0, automaticRepairCount: batch.repairCount, currentDraft: { draftId: artifact.id, title: artifact.selectedTitle, markdown: artifact.articleBody, status: "available", basisSummary: ["产品规则快照", "知识快照", "品牌基线", "表达版本"], updatedAt: artifact.createdAt }, lastUsableDraft: { draftId: artifact.id, title: artifact.selectedTitle, markdown: artifact.articleBody, status: "available", basisSummary: ["产品规则快照", "知识快照", "品牌基线", "表达版本"], updatedAt: artifact.createdAt }, updatedAt: artifact.createdAt };
}

export async function confirmAndPublishFreeProductionBatch(batchId: string, input: { expectedVersion: number; auditReason: string; contentDigest: string }, header: string | null) {
  const actorId = actor(); const context = mutationContext(input, header); const requestPayload = { batchId, ...input };
  const initialState = await readFreeProductionState();
  const initialReplay = replayBatch(initialState, context.key, requestPayload);
  if (initialReplay) return initialReplay;
  const batch = initialState.batches[batchId];
  if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
  version(batch, input.expectedVersion);
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  if (!artifact || artifact.contentDigest !== input.contentDigest) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_CONTENT_DIGEST_MISMATCH", "正文已更新，当前确认不再有效。", "刷新并查看最新正文后重新确认自动发布。");
  const blockers = batch.risks.filter((risk) => ["needs_input", "needs_approval", "blocked"].includes(risk.status));
  if (blockers.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_PUBLISH_BLOCKED", "风险与缺失项尚未清零。", "在当前页补齐全部阻断项并重新检查。", blockers.map((risk) => `${risk.title}：${risk.reason}`));
  const requiredAssets = batch.channelConfig.requiredPublishAssetKeys.filter((key) => !batch.risks.some((risk) => risk.key === key && risk.status === "ready" && risk.assetRef));
  if (requiredAssets.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_REQUIRED_ASSET_MISSING", "必需发布素材缺失。", "在当前页上传或选择公众号封面后重新检查。", requiredAssets);
  const readiness = channelReadiness().find((item) => item.channel === batch.channelConfig.channel);
  if (!readiness?.connected) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CHANNEL_NOT_READY", "表达绑定的发布账号尚未连接。", "在当前页完成连接或选择其他表达。", [readiness?.blockingReason || "连接不可用"]);
  if (batch.channelConfig.channel === "wechat_official_account") {
    const [bindingRows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT account_label FROM product_publish_account_binding
       WHERE product_id = ? AND platform = 'wechat' AND status = 'confirmed' LIMIT 1`,
      [batch.productId]
    );
    const boundAccount = bindingRows[0]?.account_label ? String(bindingRows[0].account_label) : undefined;
    const configuredAccount = getWorkspaceSetting().publishAccountByChannel?.wechat?.trim() || readiness.accounts[0]?.id.trim();
    if (!boundAccount || !configuredAccount || boundAccount !== configuredAccount) {
      throw new FreeProductionServiceError(
        422,
        "FREE_PRODUCTION_WECHAT_ACCOUNT_NOT_BOUND",
        "当前产品尚未绑定正在使用的公众号发布账号。",
        "在正文与排版页选择已连接的公众号并点击“绑定此账号”，再使用“去发布”。"
      );
    }
  }
  const sanitized = assertPublishPayloadSanitized(artifact);
  if (!sanitized.passed || sanitized.markdown !== sanitizePublishMarkdown(artifact.articleBody)) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SANITIZATION_FAILED", "发布正文仍包含内部标记或预览批注。", "刷新正文并重新执行完整检查。", sanitized.blocked);
  const isWechat = batch.channelConfig.channel === "wechat_official_account";
  if (isWechat && !artifact.wechatPresentation) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_WECHAT_HTML_MISSING", "公众号正式排版尚未生成。", "重新生成正文后再确认自动发布。");
  if (isWechat && artifact.wechatPresentation) {
    const mediaState = await readMediaLibraryState();
    const unavailableMedia = artifact.visualSuggestions.flatMap((suggestion) => {
      const ref = suggestion.boundAssetRef || "";
      if (!ref.startsWith(WORKBENCH_MEDIA_REF_PREFIX)) return [];
      const mediaAssetId = ref.slice(WORKBENCH_MEDIA_REF_PREFIX.length);
      const mediaAsset = mediaState.assets[mediaAssetId];
      return mediaAsset?.status === "active" && mediaAsset.productId === batch.productId ? [] : [`${suggestion.recommendation}：素材不存在、已移出图库或产品不一致`];
    });
    if (unavailableMedia.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_BOUND_MEDIA_UNAVAILABLE", "正文已绑定的素材当前不可用于发布。", "重新选择当前产品下的有效素材后再发布。", unavailableMedia);
    const htmlValidation = validateWechatHtml(artifact.wechatPresentation.publishHtml);
    const previewOnlyMarkers = ["data-preview-only", "配图建议", "visual-suggestion"].filter((marker) => artifact.wechatPresentation?.publishHtml.includes(marker));
    if (!artifact.wechatPresentation.validation.passed || !htmlValidation.passed || previewOnlyMarkers.length) {
      throw new FreeProductionServiceError(
        422,
        "FREE_PRODUCTION_WECHAT_HTML_INVALID",
        "公众号正式 HTML 未通过发布检查。",
        "重新生成正文并检查正式排版后再发布。",
        [...artifact.wechatPresentation.validation.blockers, ...htmlValidation.blockers, ...previewOnlyMarkers.map((marker) => `正式 HTML 包含预览标记：${marker}`)]
      );
    }
  }
  const platform = publishPlatform(batch.channelConfig.channel);
  if (!platform) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_PLATFORM_UNSUPPORTED", "当前渠道尚未接入正式自动发布。", "选择已接入自动发布的表达或转人工处理。");
  const auth = await checkFormalPublishAuth(platform);
  if (!auth.ok) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CHANNEL_AUTH_FAILED", auth.message, auth.nextAction);
  const reservation = await updateFreeProductionState((state) => {
    const replay = replayBatch(state, context.key, requestPayload);
    if (replay) return { batch: replay, replayed: true };
    const target = state.batches[batchId];
    if (!target) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "公众号生产任务不存在。", "返回任务列表并刷新。");
    version(target, input.expectedVersion);
    target.status = "publishing";
    target.confirmedContentDigest = artifact.contentDigest;
    target.version += 1;
    target.updatedAt = new Date().toISOString();
    state.idempotency[context.key] = { requestHash: hash(requestPayload), response: target, createdAt: target.updatedAt };
    return { batch: target, replayed: false };
  });
  if (reservation.replayed) return reservation.batch;
  const createdJob = await createPublishJobFromApprovedContent({
    sourceDraftId: artifact.id,
    sourceTaskId: `free-task-${batch.id}`,
    matrixItemId: `free-task-${batch.id}`,
    title: artifact.selectedTitle,
    markdown: isWechat ? artifact.wechatPresentation!.publishHtml : sanitized.markdown,
    summary: artifact.summary,
    contentFormat: isWechat ? "wechat_html" : "markdown",
    platform,
    scheduledAt: new Date().toISOString()
  });
  const schedule = createdJob.ok ? createdJob.data?.schedules[0] : undefined;
  const dispatchedJob = schedule ? await dispatchPublishJob(schedule.id) : undefined;
  const result = {
    ok: Boolean(schedule && dispatchedJob?.ok),
    status: schedule?.status || "failed",
    publicUrl: schedule?.publicUrl,
    externalTaskId: schedule?.id,
    platformArticleId: schedule?.platformArticleId,
    nextAction: dispatchedJob?.ok ? "Publish Job 已进入 Worker 队列；前台会持续轮询、核验并自动回填 URL。" : createdJob.message,
    failureCode: schedule?.failureCode,
    failureReason: dispatchedJob?.ok ? undefined : dispatchedJob?.message || createdJob.message
  };
  const expression = await getActiveFreeContentExpressionTypeVersion(batch.freeContentExpressionTypeVersionId);
  const updated = await updateFreeProductionState((state) => {
    const target = state.batches[batchId]; const task = state.tasks[`free-task-${batchId}`]; const now = new Date().toISOString();
    if (result.ok) { target.status = "publishing"; target.publishedAt = undefined; target.publishedUrl = result.publicUrl; target.externalRecordId = result.externalTaskId || result.platformArticleId; target.nextAction = result.nextAction; }
    else { target.status = "publish_failed"; target.failureCode = result.failureCode || result.status; target.failureMessage = result.failureReason || "发布失败。"; target.nextAction = result.nextAction || "检查发布连接后安全重试。"; }
    target.version += 1; target.updatedAt = now;
    if (task) { task.status = target.status; task.publishedAt = target.publishedAt; task.publishedUrl = target.publishedUrl; task.failureCode = target.failureCode; task.failureMessage = target.failureMessage; task.nextAction = target.nextAction; task.updatedAt = now; }
    state.audits.push({ auditId: randomUUID(), action: "free_production_confirmed_and_published", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { contentDigest: artifact.contentDigest, expressionVersionId: expression.freeContentExpressionTypeVersionId, riskSnapshot: summarizeRisks(target.risks), channel: target.channelConfig.channel, externalRecordId: target.externalRecordId } });
    if (state.idempotency[context.key]) state.idempotency[context.key].response = target;
    return target;
  });
  await updateV5MonthlyState((state) => { const plan = state.plans[batch.monthStart.slice(0, 7)]; if (!plan) return; const matrixTask = toMatrixTask(updated, artifact, expression); const matrixTasks = [...(plan.matrixTasks || [])]; const existing = matrixTasks.findIndex((item) => item.taskId === matrixTask.taskId); if (existing >= 0) matrixTasks[existing] = matrixTask; else matrixTasks.push(matrixTask); plan.matrixTasks = matrixTasks; plan.config.targetDeliverableCount = matrixTasks.length; plan.version += 1; plan.updatedAt = new Date().toISOString(); plan.updatedBy = actorId; });
  return updated;
}

export async function retryFreeProductionFailures(batchId: string, input: { expectedVersion: number; auditReason: string }, header: string | null) {
  const context = mutationContext(input, header); const batch = await getFreeProductionBatch(batchId); version(batch, input.expectedVersion);
  if (batch.status === "generation_failed") return runGeneration(batchId, { auditReason: context.auditReason, actorId: actor() });
  if (batch.status === "publish_failed") { const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId); if (!artifact) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_DRAFT_MISSING", "没有可用于安全重试的正文。", "重新生成正文后再发布。"); return confirmAndPublishFreeProductionBatch(batchId, { ...input, contentDigest: artifact.contentDigest }, header); }
  throw new FreeProductionServiceError(422, "FREE_PRODUCTION_NO_RETRYABLE_FAILURES", "当前任务没有可重试的失败状态。", "刷新任务列表查看最新状态。");
}
