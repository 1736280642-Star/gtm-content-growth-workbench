import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import { checkFormalPublishAuth, submitFormalPublish } from "@/lib/formal-publish-client";
import { getRuntimeConfigStatus } from "@/lib/runtime-config";
import type { DirectPublishPlatformKey } from "@/lib/types";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type { ProductionMatrixTask, V5MonthlyPlanRecord } from "./monthly-workspace-contracts";
import { readV5FoundationState } from "./foundation-repository";
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
import { compileExpressionPlan } from "./free-production-expression-plan";
import { assertPublishPayloadSanitized, validateFreeProductionOutput } from "./free-production-output-validator";
import {
  blockingFreeProductionRisks,
  freeProductionGateStatus,
  hasCurrentSourceReview,
  visibleFreeProductionRisks
} from "./free-production-presentation";
import { getActiveFreeContentExpressionTypeVersion, listFreeContentExpressionTypes, markFreeExpressionUsed } from "./free-content-expression-type-service";
import { readFreeExpressionBrandBaseline } from "./free-content-expression-type-repository";
import { readFreeProductionState, updateFreeProductionState, type FreeProductionState } from "./free-production-repository";
import {
  JOTO_OFFICIAL_WECHAT_TEMPLATE_ID,
  renderJotoOfficialWechatBody,
  renderJotoOfficialWechatPreviewDocument
} from "./joto-wechat-layout-renderer";
import { updateV5MonthlyState } from "./monthly-repository";
import { validateWechatHtml } from "./wechat-layout-validator";

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

function catalogProducts(): FreeProductionCatalogProduct[] {
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

export async function getFreeProductionCatalog(): Promise<FreeProductionCatalog> {
  return { products: catalogProducts(), expressionTypes: (await listFreeContentExpressionTypes()).filter((item) => item.status === "active" && item.activeVersion), channelReadiness: channelReadiness(), currentMonth: currentMonth() };
}
export function getPublishingChannelReadiness() { return channelReadiness(); }

async function ensureMonthlyPlan(month: string, actorId: string) {
  return updateV5MonthlyState((state) => {
    if (state.plans[month]) return state.plans[month];
    const now = new Date().toISOString();
    const plan: V5MonthlyPlanRecord = { id: `monthly-plan-${month}`, version: 1, status: "draft", config: { month, businessGoal: "承载当月自由内容生产补充任务", targetDeliverableCount: 0, questionVersionIds: [], quotaRules: [], groups: [] }, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId, matrixTasks: [] };
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

function knowledgeFor(knowledgeSnapshotIds: string[], product?: FreeProductionCatalogProduct) {
  if (!product) return [];
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

export function buildFreeProductionSourceExcerpts(input: { knowledge: ReturnType<typeof knowledgeFor>; factItems: FreeProductionFactInput[]; meetingText: string }) {
  const knowledgeSources: FreeProductionSourceExcerpt[] = input.knowledge.flatMap((item) => (item.evidence as Array<{ evidenceExcerpt?: string; summary?: string }>).flatMap((evidence, index) => {
    const excerpt = String(evidence.evidenceExcerpt || evidence.summary || "").trim();
    return excerpt ? [{ id: `source-${randomUUID()}`, sourceType: "knowledge" as const, excerpt, sourceSnapshotId: item.sourceSnapshotId, sourceSnapshotHash: item.sourceSnapshotHash }] : [];
  }));
  const factSources: FreeProductionSourceExcerpt[] = input.factItems.map((item) => ({
    id: `source-${randomUUID()}`,
    sourceType: "human_fact",
    excerpt: [`时间：${item.time}`, `地点：${item.location}`, `人物：${item.people}`, `事件：${item.event}`].join("\n")
  }));
  const meetingSources: FreeProductionSourceExcerpt[] = meetingTextExcerpts(input.meetingText).map((excerpt) => ({ id: `source-${randomUUID()}`, sourceType: "meeting_text", excerpt }));
  return [...knowledgeSources, ...factSources, ...meetingSources];
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
      const sourceIds = Array.isArray(citationRecord.sourceIds)
        ? citationRecord.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string").map((sourceId) => sourceId.trim()).filter(Boolean)
        : [];
      return claimText ? [{ claimText, sourceIds }] : [];
    }) : [];
    return typeof record.sectionKey === "string" && typeof record.heading === "string" && typeof record.markdown === "string"
      ? [{ sectionKey: record.sectionKey.trim(), heading: record.heading.trim(), markdown: record.markdown.trim(), citations }]
      : [];
  }) : [];
  return { titleCandidates, summary, sections };
}

function generationPrompt(input: { batch: FreeProductionBatch; expression: FreeContentExpressionTypeVersion; knowledge: Array<Record<string, unknown>>; brandBaseline: Record<string, unknown>; affectedSectionKeys?: string[]; currentArtifact?: ContentDraftArtifact }) {
  const firstSourceId = input.batch.sourceExcerpts[0]?.id || "source-id";
  const schema = {
    titleCandidates: ["标题1", "标题2", "标题3"],
    summary: "80字以内摘要",
    sections: input.expression.structureModules.map((sectionKey) => ({
      sectionKey,
      heading: "中文章节标题",
      markdown: "该章节正文，所有事实必须来自 sourceExcerpts。",
      citations: [{ claimText: "正文中逐字出现的完整句子", sourceIds: [firstSourceId] }]
    }))
  };
  return {
    systemPrompt: "你是 JOTO 企业公众号内容生产助手。只能使用提供的知识、补充事实和规则，不得猜测客户名称、数据、上线状态、合作范围、能力边界、CTA 或合规结论。缺失事实直接省略，不写待补充标记。每个章节必须输出 citations；markdown 中每个完整句子都必须有一条 citation，claimText 必须逐字等于该句正文，sourceIds 只能引用 sourceExcerpts 提供的 id。严格输出单个 JSON 对象，不输出 Markdown 代码围栏或解释。",
    userPrompt: JSON.stringify({
      task: input.affectedSectionKeys?.length ? "只重写 affectedSectionKeys 对应章节；其余章节原样返回，最终仍输出完整 sections。" : "生成一篇单篇渠道正文。",
      subjectName: input.batch.productName || "JOTO",
      expression: { presetKey: input.expression.presetKey, contentGoal: input.expression.contentGoal, audience: input.expression.defaultAudience, audienceLens: input.expression.audienceLensPolicy, titleStrategy: input.expression.defaultTitleStrategyKey, structureModules: input.expression.structureModules, length: input.expression.recommendedLength, expressionConfig: input.expression.expressionConfig, promotionConfig: input.expression.promotionConfig, requirements: input.expression.additionalWritingRequirements },
      knowledge: input.knowledge,
      sourceExcerpts: input.batch.sourceExcerpts.map(({ id, sourceType, excerpt }) => ({ id, sourceType, excerpt })),
      expressionFocus: input.batch.expressionFocus,
      supplementalFacts: input.batch.inputSnapshots.at(-1)?.supplementalFacts || {},
      brandBaseline: input.brandBaseline,
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
  if (input.affectedSectionKeys?.length && input.currentArtifact) {
    parsed.sections = mergeRegeneratedSections(input.currentArtifact.sections, parsed.sections, input.affectedSectionKeys);
    parsed.titleCandidates = parsed.titleCandidates.length === 3 ? parsed.titleCandidates : input.currentArtifact.titleCandidates;
    parsed.summary = parsed.summary || input.currentArtifact.summary;
  }
  let validation = validateFreeProductionOutput({ expression: input.expression, productName: input.batch.productName || "JOTO", sources: input.batch.sourceExcerpts, ...parsed });
  let repairCount: 0 | 1 = 0;
  if (validation.repairableIssues.length && !validation.blockingIssues.length) {
    response = await callAiProvider({ provider, systemPrompt: prompt.systemPrompt, userPrompt: `${prompt.userPrompt}\n\n上次输出未通过确定性检查：${validation.repairableIssues.join("；")}。只修复这些结构与表达问题，仍输出完整 JSON。`, temperature: 0.15 });
    repairCount = 1;
    if (response.ok && response.content) {
      try { parsed = parseProviderJson(response.content); } catch { /* Preserve the last parse for actionable failure reporting. */ }
      validation = validateFreeProductionOutput({ expression: input.expression, productName: input.batch.productName || "JOTO", sources: input.batch.sourceExcerpts, ...parsed });
    }
  }
  const selectedTitle = parsed.titleCandidates[0] || `${input.batch.productName || "JOTO"}：一段真实工作流的变化`;
  const body = articleBody(selectedTitle, parsed.sections);
  return { ok: true as const, parsed, selectedTitle, body, validation, repairCount };
}

async function runGeneration(batchId: string, options?: { affectedSectionKeys?: string[]; auditReason?: string; actorId?: string }) {
  const state = await readFreeProductionState();
  const batch = state.batches[batchId];
  if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "自由生产任务不存在。", "返回表达列表后刷新。");
  const expression = await getActiveFreeContentExpressionTypeVersion(batch.freeContentExpressionTypeVersionId);
  const catalog = await getFreeProductionCatalog();
  const selection = selectionFor(batch, catalog);
  if (selection.issues.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CONFIG_INVALID", "当前资料暂时不可生产。", "返回内容类型并重新选择资料。", selection.issues);
  const knowledge = knowledgeFor(batch.knowledgeSnapshotIds, selection.product);
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
          includeVisualPlaceholders: true
        });
        const publishHtml = renderJotoOfficialWechatBody({
          sections: generated.parsed.sections,
          visualSuggestions: plan.visualMaterialPlan,
          includeVisualPlaceholders: false
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
      factCheck: { supportedClaims: generated.parsed.sections.flatMap((section) => (section.citations || []).map((citation) => citation.claimText)), needsConfirmation: target.risks.filter((risk) => risk.status === "needs_approval").map((risk) => risk.title), rejectedClaims: generated.validation.blockingIssues },
      editorCheck: { deterministicResults: generated.validation.repairableIssues, advisoryResults: generated.validation.advisoryIssues },
      riskAndGapSnapshot: target.risks,
      contentDigest: wechatPresentation?.htmlHash || contentDigest(generated.body),
      createdAt: now,
      version: (currentArtifact?.version || 0) + 1
    };
    const artifact = artifactPartial satisfies ContentDraftArtifact;
    target.draftArtifacts.push(artifact);
    target.currentDraftArtifactId = artifact.id;
    target.sourceReview = undefined;
    target.status = freeProductionGateStatus(target);
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
  const knowledge = knowledgeFor(knowledgeSnapshotIds, selection.product);
  const sourceExcerpts = buildFreeProductionSourceExcerpts({ knowledge, factItems, meetingText });
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
export async function getFreeProductionBatch(batchId: string) { const state = await readFreeProductionState(); const batch = state.batches[batchId]; if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "自由生产任务不存在。", "返回任务列表并刷新。"); return batch; }
function version(batch: FreeProductionBatch, expected: number) { if (batch.version !== expected) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VERSION_CONFLICT", "配置已被其他操作更新。", "刷新页面读取最新版本后重试。"); }

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
    const affectedSectionKeys = resolved.flatMap((item) => batch.risks.find((risk) => risk.id === item.riskId)?.affectedSectionKeys || []);
    batch.riskAndGapSummary = summarizeRisks(visibleFreeProductionRisks(batch));
    batch.status = affectedSectionKeys.length ? "checking" : freeProductionGateStatus(batch);
    batch.version += 1; batch.updatedAt = now;
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

export async function reviewFreeProductionSources(batchId: string, input: { expectedVersion: number; auditReason: string; artifactId: string }, header: string | null) {
  const actorId = actor();
  const context = mutationContext(input, header);
  return updateFreeProductionState((state) => idempotent(state, context.key, { batchId, ...input }, () => {
    const batch = state.batches[batchId];
    if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "自由生产任务不存在。", "返回任务列表并刷新。");
    version(batch, input.expectedVersion);
    const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId && item.id === input.artifactId);
    if (!artifact) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_ARTIFACT_CHANGED", "正文已经更新，本次来源核对不再有效。", "刷新后重新核对最新正文与来源。");
    const citationCheck = assertPublishPayloadSanitized(artifact);
    if (!artifact.sourceExcerpts.length || citationCheck.blocked.some((item) => item.includes("来源") || item.includes("引用"))) {
      throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SOURCE_TRACEABILITY_INVALID", "正文缺少完整的来源映射。", "重新选择资料生成正文后再核对来源。", citationCheck.blocked);
    }
    const now = new Date().toISOString();
    batch.sourceReview = { artifactId: artifact.id, reviewedBy: actorId, reviewedAt: now };
    batch.status = freeProductionGateStatus(batch);
    batch.version += 1;
    batch.updatedAt = now;
    const task = state.tasks[`free-task-${batchId}`];
    if (task) { task.status = batch.status; task.updatedAt = now; }
    state.audits.push({ auditId: randomUUID(), action: "free_production_sources_reviewed", objectId: batchId, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { artifactId: artifact.id, sourceCount: artifact.sourceExcerpts.length } });
    return batch;
  }));
}

function publishPlatform(channel: FreeProductionChannel): DirectPublishPlatformKey | undefined { if (channel === "zhihu") return "zhihu"; if (channel === "wechat_official_account") return "wechat"; return undefined; }
function toMatrixTask(batch: FreeProductionBatch, artifact: ContentDraftArtifact, expression: FreeContentExpressionTypeVersion): ProductionMatrixTask {
  return { taskId: `free-task-${batch.id}`, monthlyPlanId: batch.monthlyPlanId, planningSource: "free_production", freeProductionBatchId: batch.id, freeContentExpressionTypeVersionId: expression.freeContentExpressionTypeVersionId, strategyPackageId: "", quotaRuleId: "", questionVersionId: "", question: "自由内容生产补充任务", baseTopicIndex: 1, title: artifact.selectedTitle, contentType: expression.name, articleTypeProfileVersionId: "", articleTypeNameSnapshot: expression.name, typeMatchRunId: "", typeSelectionSource: "user_selected", matchReasonSnapshot: "用户选择自由内容表达预设", articleTypePromptConstraintSnapshot: JSON.stringify(expression), articleTypePromptConstraintSnapshotHash: expression.snapshotHash, channel: freeProductionChannelLabels[batch.channelConfig.channel], rulePackageVersionId: batch.productExpressionRulePackageVersionId, knowledgeBaseIds: batch.knowledgeSnapshotIds, sourceSnapshotHash: batch.inputSnapshots.at(-1)?.snapshotHash || "", evidencePackSourceSnapshotHash: batch.inputSnapshots.at(-1)?.snapshotHash || "", status: "available", recoveryAttemptCount: 0, automaticRepairCount: batch.repairCount, currentDraft: { draftId: artifact.id, title: artifact.selectedTitle, markdown: artifact.articleBody, status: "available", basisSummary: ["产品规则快照", "知识快照", "品牌基线", "表达版本"], updatedAt: artifact.createdAt }, lastUsableDraft: { draftId: artifact.id, title: artifact.selectedTitle, markdown: artifact.articleBody, status: "available", basisSummary: ["产品规则快照", "知识快照", "品牌基线", "表达版本"], updatedAt: artifact.createdAt }, updatedAt: artifact.createdAt };
}

export async function confirmAndPublishFreeProductionBatch(batchId: string, input: { expectedVersion: number; auditReason: string; contentDigest: string }, header: string | null) {
  const actorId = actor(); const context = mutationContext(input, header); const requestPayload = { batchId, ...input };
  const initialState = await readFreeProductionState();
  const initialReplay = replayBatch(initialState, context.key, requestPayload);
  if (initialReplay) return initialReplay;
  const batch = initialState.batches[batchId];
  if (!batch) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "自由生产任务不存在。", "返回任务列表并刷新。");
  version(batch, input.expectedVersion);
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  if (!artifact || artifact.contentDigest !== input.contentDigest) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_CONTENT_DIGEST_MISMATCH", "正文已更新，当前确认不再有效。", "刷新并查看最新正文后重新确认自动发布。");
  if (!hasCurrentSourceReview(batch, artifact)) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SOURCE_REVIEW_REQUIRED", "引用来源尚未完成核对。", "核对当前正文的来源片段并确认后再发布。");
  const blockers = blockingFreeProductionRisks(batch);
  if (blockers.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_PUBLISH_BLOCKED", "风险与缺失项尚未清零。", "在当前页补齐全部阻断项并重新检查。", blockers.map((risk) => `${risk.title}：${risk.reason}`));
  const visibleRisks = visibleFreeProductionRisks(batch);
  const requiredAssets = batch.channelConfig.requiredPublishAssetKeys.filter((key) => !visibleRisks.some((risk) => risk.key === key && risk.status === "ready" && risk.assetRef));
  if (requiredAssets.length) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_REQUIRED_ASSET_MISSING", "必需发布素材缺失。", "在当前页上传或选择公众号封面后重新检查。", requiredAssets);
  const readiness = channelReadiness().find((item) => item.channel === batch.channelConfig.channel);
  if (!readiness?.connected) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_CHANNEL_NOT_READY", "表达绑定的发布账号尚未连接。", "在当前页完成连接或选择其他表达。", [readiness?.blockingReason || "连接不可用"]);
  const sanitized = assertPublishPayloadSanitized(artifact);
  if (!sanitized.passed || sanitized.markdown !== sanitizePublishMarkdown(artifact.articleBody)) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_SANITIZATION_FAILED", "发布正文仍包含内部标记或预览批注。", "刷新正文并重新执行完整检查。", sanitized.blocked);
  const isWechat = batch.channelConfig.channel === "wechat_official_account";
  if (isWechat && !artifact.wechatPresentation) throw new FreeProductionServiceError(422, "FREE_PRODUCTION_WECHAT_HTML_MISSING", "公众号正式排版尚未生成。", "重新生成正文后再确认自动发布。");
  if (isWechat && artifact.wechatPresentation) {
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
    if (!target) throw new FreeProductionServiceError(404, "FREE_PRODUCTION_BATCH_NOT_FOUND", "自由生产任务不存在。", "返回任务列表并刷新。");
    version(target, input.expectedVersion);
    target.status = "publishing";
    target.confirmedContentDigest = artifact.contentDigest;
    target.version += 1;
    target.updatedAt = new Date().toISOString();
    state.idempotency[context.key] = { requestHash: hash(requestPayload), response: target, createdAt: target.updatedAt };
    return { batch: target, replayed: false };
  });
  if (reservation.replayed) return reservation.batch;
  const result = await submitFormalPublish(platform, { scheduleId: `free-task-${batch.id}`, contentHash: artifact.contentDigest, idempotencyKey: `${batch.id}:${artifact.contentDigest}`, title: artifact.selectedTitle, markdown: isWechat ? artifact.wechatPresentation!.publishHtml : sanitized.markdown, contentFormat: isWechat ? "wechat_html" : "markdown", summary: artifact.summary, scheduledAt: new Date().toISOString(), sourceDraftId: artifact.id, matrixItemId: `free-task-${batch.id}`, coverMediaId: batch.risks.find((risk) => risk.key === "wechat_cover")?.assetRef });
  const expression = await getActiveFreeContentExpressionTypeVersion(batch.freeContentExpressionTypeVersionId);
  const updated = await updateFreeProductionState((state) => {
    const target = state.batches[batchId]; const task = state.tasks[`free-task-${batchId}`]; const now = new Date().toISOString();
    if (result.ok) { target.status = result.status === "published_verified" || result.status === "published_pending_url" ? "published" : "publishing"; target.publishedAt = target.status === "published" ? now : undefined; target.publishedUrl = result.publicUrl; target.externalRecordId = result.externalTaskId || result.platformArticleId; target.nextAction = result.nextAction; }
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
