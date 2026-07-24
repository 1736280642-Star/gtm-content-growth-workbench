import { createHash } from "node:crypto";
import type { SingleArticleActor } from "./single-article-contracts";
import { renderWechatHtml } from "./wechat-layout-renderer";
import { selectWechatLayout } from "./wechat-layout-selector";
import { validateWechatHtml } from "./wechat-layout-validator";
import {
  createWechatPresentationArtifact,
  readLatestWechatPresentation,
  readWechatPresentationDraftContext,
  reviewWechatPresentation
} from "./wechat-presentation-repository";
import type { WechatPresentationArtifact, WechatPresentationInput } from "./wechat-presentation-contracts";
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

function normalizeCoverImageRef(value: unknown) {
  const coverImageRef = typeof value === "string" ? value.trim() : "";
  if (!coverImageRef) return undefined;
  if (coverImageRef.length > 1000 || /[\u0000\r\n]/.test(coverImageRef)) {
    throw new V5GovernanceRepositoryError("invalid_cover_image_ref", "封面资产引用格式无效。", 422, "使用 media_id:<id> 或工作台内的本地图片路径。");
  }
  return coverImageRef;
}

export async function generateWechatPresentation(input: {
  draftVersionId: string;
  approvedImageRoles?: unknown;
  coverImageRef?: unknown;
  actor: SingleArticleActor;
}) {
  const context = await readWechatPresentationDraftContext(input.draftVersionId);
  const approvedImageRoles = Array.isArray(input.approvedImageRoles)
    ? Array.from(new Set(input.approvedImageRoles.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).sort().slice(0, 30)
    : [];
  const presentationInput: WechatPresentationInput = {
    ...context,
    articleStructureTags: inferStructureTags(context.markdown),
    approvedImageRoles,
    coverImageRef: normalizeCoverImageRef(input.coverImageRef)
  };
  const sourceContentHash = hashWechatSource(context.title, context.markdown);
  const inputHash = createHash("sha256").update(JSON.stringify({ sourceContentHash, approvedImageRoles, coverImageRef: presentationInput.coverImageRef || "" }), "utf8").digest("hex");
  const selection = selectWechatLayout(presentationInput);
  const html = selection.status === "selected" && selection.selectedTemplateId
    ? renderWechatHtml({ title: context.title, markdown: context.markdown, templateId: selection.selectedTemplateId })
    : undefined;
  const validation = validateWechatHtml(html || "");
  return createWechatPresentationArtifact({
    presentationInput,
    sourceContentHash,
    inputHash,
    selection,
    html,
    htmlHash: html ? createHash("sha256").update(html, "utf8").digest("hex") : undefined,
    validation,
    actor: { ...input.actor, auditReason: input.actor.auditReason || "系统自动选择公众号排版并生成 HTML" }
  });
}

export async function getWechatPresentation(draftVersionId: string) {
  const [context, artifact] = await Promise.all([
    readWechatPresentationDraftContext(draftVersionId),
    readLatestWechatPresentation(draftVersionId)
  ]);
  if (!artifact) return undefined;
  const currentHash = hashWechatSource(context.title, context.markdown);
  return currentHash === artifact.sourceContentHash ? artifact : { ...artifact, reviewStatus: "stale" as const };
}

export async function decideWechatPresentation(input: {
  draftVersionId: string;
  artifactId: string;
  decision: "approved" | "rejected";
  reason: string;
  actor: SingleArticleActor;
}) {
  const context = await readWechatPresentationDraftContext(input.draftVersionId);
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
  const artifact = await getWechatPresentation(draftVersionId);
  if (!artifact) throw new V5GovernanceRepositoryError("wechat_presentation_missing", "尚未生成公众号呈现。", 409, "先运行系统自动排版并完成最终呈现审核。");
  if (artifact.reviewStatus !== "approved" || !artifact.validation.passed || !artifact.html) {
    throw new V5GovernanceRepositoryError("wechat_presentation_not_approved", "公众号呈现尚未批准或已经失效。", 409, "审核最新 HTML 呈现；正文变化后必须重新生成并审核。");
  }
  return artifact;
}
