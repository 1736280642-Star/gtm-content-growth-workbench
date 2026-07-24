import { createHash } from "node:crypto";
import type { SingleArticleActor } from "./single-article-contracts";
import { renderWechatHtml } from "./wechat-layout-renderer";
import {
  getActiveWechatTemplate,
  recommendWechatLayout,
  WECHAT_LAYOUT_TEMPLATES
} from "./wechat-layout-selector";
import { validateWechatHtml } from "./wechat-layout-validator";
import {
  createWechatPresentationArtifact,
  createWechatTemplateSelection,
  readCurrentWechatTemplateSelection,
  readLatestWechatPresentation,
  readWechatPresentationDraftContext,
  reviewWechatPresentation
} from "./wechat-presentation-repository";
import type {
  WechatPresentationArtifact,
  WechatPresentationInput,
  WechatPresentationState,
  WechatTemplateWorkspace
} from "./wechat-presentation-contracts";
import { resolveWechatPlatformKey } from "./wechat-presentation-contracts";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export function hashWechatSource(title: string, markdown: string) {
  return createHash("sha256").update(`${title.trim()}\n${markdown.trim()}`, "utf8").digest("hex");
}

function inferStructureTags(markdown: string) {
  const tags: string[] = [];
  if (/^\s*\d+[.)]\s+/m.test(markdown) || /步骤|流程|怎么做|如何/.test(markdown)) tags.push("steps", "workflow");
  if (/对比|区别|vs\.?|比较/i.test(markdown)) tags.push("comparison");
  if (/证据|数据|来源|研究/.test(markdown)) tags.push("evidence");
  if (/^>\s+/m.test(markdown)) tags.push("quotation");
  return Array.from(new Set(tags));
}

function normalizeImageRoles(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).sort().slice(0, 30)
    : [];
}

function normalizeCoverImageRef(value: unknown) {
  const coverImageRef = typeof value === "string" ? value.trim() : "";
  if (!coverImageRef) return undefined;
  if (coverImageRef.length > 1000 || /[\u0000\r\n]/.test(coverImageRef)) {
    throw new V5GovernanceRepositoryError("invalid_cover_image_ref", "封面资产引用格式无效。", 422, "使用 media_id:<id> 或工作台内的本地图片路径。");
  }
  return coverImageRef;
}

function assertWechatChannel(channel: string) {
  const platformKey = resolveWechatPlatformKey(channel);
  if (!platformKey) {
    throw new V5GovernanceRepositoryError(
      "wechat_layout_not_applicable",
      "该正文没有标记为微信公众号渠道，不能进入公众号排版。",
      409,
      "返回内容矩阵确认渠道；只有微信渠道文章显示并允许调用该节点。"
    );
  }
  return platformKey;
}

function toPresentationInput(context: Awaited<ReturnType<typeof readWechatPresentationDraftContext>>, input?: { approvedImageRoles?: unknown; coverImageRef?: unknown }): WechatPresentationInput {
  return {
    draftVersionId: context.draftVersionId,
    title: context.title,
    markdown: context.markdown,
    platformKey: assertWechatChannel(context.channel),
    platformContentType: context.platformContentType,
    titleCategory: context.titleCategory,
    targetAudience: context.targetAudience,
    articleStructureTags: inferStructureTags(context.markdown),
    ctaType: context.ctaType,
    approvedImageRoles: normalizeImageRoles(input?.approvedImageRoles),
    coverImageRef: normalizeCoverImageRef(input?.coverImageRef)
  };
}

function previewMarkdown(markdown: string) {
  const selected: string[] = [];
  let length = 0;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("# ")) continue;
    selected.push(trimmed);
    length += trimmed.length;
    if (selected.length >= 10 || length >= 700) break;
  }
  return selected.join("\n\n") || "## 正文预览\n\n文章内容将在这里按所选模板呈现。";
}

export async function getWechatTemplateWorkspace(draftVersionId: string): Promise<WechatTemplateWorkspace> {
  const context = await readWechatPresentationDraftContext(draftVersionId);
  const presentationInput = toPresentationInput(context);
  const sourceContentHash = hashWechatSource(context.title, context.markdown);
  const [selection] = await Promise.all([
    readCurrentWechatTemplateSelection(draftVersionId, sourceContentHash)
  ]);
  const recommendation = recommendWechatLayout(presentationInput);
  const sampleMarkdown = previewMarkdown(context.markdown);
  const templates = WECHAT_LAYOUT_TEMPLATES.filter((item) => item.active).map((item) => ({
    ...item,
    previewHtml: renderWechatHtml({ title: context.title, markdown: sampleMarkdown, templateId: item.templateId })
  }));
  if (recommendation.recommendedTemplateId) {
    templates.sort((a, b) => Number(b.templateId === recommendation.recommendedTemplateId) - Number(a.templateId === recommendation.recommendedTemplateId));
  }
  return {
    applicable: true,
    platformKey: presentationInput.platformKey,
    sourceContentHash,
    recommendation: {
      status: recommendation.status,
      recommenderVersion: recommendation.recommenderVersion,
      recommendedTemplateId: recommendation.recommendedTemplateId,
      family: recommendation.family,
      businessReason: recommendation.businessReason
    },
    templates,
    selection
  };
}

export async function selectWechatTemplate(input: {
  draftVersionId: string;
  templateId: string;
  selectionReason?: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const context = await readWechatPresentationDraftContext(input.draftVersionId);
  const presentationInput = toPresentationInput(context);
  const template = getActiveWechatTemplate(input.templateId);
  if (!template) throw new V5GovernanceRepositoryError("wechat_template_not_available", "所选公众号模板不存在或未启用。", 422, "刷新模板列表后重新选择。");
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 191) throw new V5GovernanceRepositoryError("invalid_idempotency_key", "模板选择缺少有效幂等键。", 422, "刷新页面后重新选择模板。");
  return createWechatTemplateSelection({
    draftVersionId: input.draftVersionId,
    sourceContentHash: hashWechatSource(context.title, context.markdown),
    recommendation: recommendWechatLayout(presentationInput),
    selectedTemplateId: template.templateId,
    templateVersion: template.version,
    selectionReason: input.selectionReason?.trim().slice(0, 500) || undefined,
    idempotencyKey: input.idempotencyKey.trim(),
    actor: { ...input.actor, auditReason: input.actor.auditReason || "人工确认公众号排版模板" }
  });
}

export async function generateWechatPresentation(input: {
  draftVersionId: string;
  approvedImageRoles?: unknown;
  coverImageRef?: unknown;
  actor: SingleArticleActor;
}) {
  const context = await readWechatPresentationDraftContext(input.draftVersionId);
  const presentationInput = toPresentationInput(context, input);
  const sourceContentHash = hashWechatSource(context.title, context.markdown);
  const selection = await readCurrentWechatTemplateSelection(input.draftVersionId, sourceContentHash);
  if (!selection) throw new V5GovernanceRepositoryError("wechat_template_selection_required", "尚未人工确认公众号排版模板。", 409, "先在“排版模板”页选择并确认模板，再生成图文预览。");
  const activeTemplate = getActiveWechatTemplate(selection.selectedTemplateId);
  if (!activeTemplate || activeTemplate.version !== selection.templateVersion) throw new V5GovernanceRepositoryError("wechat_template_selection_stale", "已选模板版本已失效。", 409, "重新查看模板并人工确认当前有效版本。");
  const inputHash = createHash("sha256").update(JSON.stringify({
    sourceContentHash,
    selectionId: selection.selectionId,
    approvedImageRoles: presentationInput.approvedImageRoles,
    coverImageRef: presentationInput.coverImageRef || ""
  }), "utf8").digest("hex");
  const html = renderWechatHtml({ title: context.title, markdown: context.markdown, templateId: selection.selectedTemplateId });
  const validation = validateWechatHtml(html);
  return createWechatPresentationArtifact({
    presentationInput,
    selection,
    sourceContentHash,
    inputHash,
    html,
    htmlHash: createHash("sha256").update(html, "utf8").digest("hex"),
    validation,
    actor: { ...input.actor, auditReason: input.actor.auditReason || "基于人工所选模板生成公众号图文预览" }
  });
}

export async function getWechatPresentationState(draftVersionId: string): Promise<WechatPresentationState> {
  const context = await readWechatPresentationDraftContext(draftVersionId);
  const platformKey = assertWechatChannel(context.channel);
  const sourceContentHash = hashWechatSource(context.title, context.markdown);
  const selection = await readCurrentWechatTemplateSelection(draftVersionId, sourceContentHash);
  const artifact = selection ? await readLatestWechatPresentation(selection.selectionId) : undefined;
  return { applicable: true, platformKey, selection, artifact };
}

export async function decideWechatPresentation(input: {
  draftVersionId: string;
  artifactId: string;
  decision: "approved" | "rejected";
  reason: string;
  actor: SingleArticleActor;
}) {
  const context = await readWechatPresentationDraftContext(input.draftVersionId);
  assertWechatChannel(context.channel);
  return reviewWechatPresentation({
    artifactId: input.artifactId,
    draftVersionId: input.draftVersionId,
    decision: input.decision,
    reason: input.reason,
    currentSourceContentHash: hashWechatSource(context.title, context.markdown),
    actor: input.actor
  });
}

export async function getPublishableWechatPresentation(draftVersionId: string): Promise<WechatPresentationArtifact> {
  const state = await getWechatPresentationState(draftVersionId);
  const artifact = state.artifact;
  if (!state.selection) throw new V5GovernanceRepositoryError("wechat_template_selection_required", "尚未人工确认公众号排版模板。", 409, "先选择并确认模板。");
  if (!artifact) throw new V5GovernanceRepositoryError("wechat_presentation_missing", "尚未生成公众号图文预览。", 409, "使用已选模板生成图文预览并完成最终审核。");
  if (artifact.reviewStatus !== "approved" || !artifact.validation.passed || !artifact.html) {
    throw new V5GovernanceRepositoryError("wechat_presentation_not_approved", "公众号图文预览尚未批准或已经失效。", 409, "审核最新图文预览；正文变化后必须重新选择模板并审核。");
  }
  return artifact;
}
