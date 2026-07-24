import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import type { SingleArticleActor } from "./single-article-contracts";
import type {
  WechatHtmlValidationResult,
  WechatLayoutSelection,
  WechatPresentationArtifact,
  WechatPresentationInput
} from "./wechat-presentation-contracts";

export interface WechatPresentationDraftContext {
  draftVersionId: string;
  title: string;
  markdown: string;
  platformContentType: string;
  titleCategory: string;
  targetAudience: string;
  ctaType: string;
}

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function mapArtifact(row: RowDataPacket): WechatPresentationArtifact {
  return {
    artifactId: String(row.id),
    draftVersionId: String(row.draft_version_id),
    sourceContentHash: String(row.source_content_hash),
    selectorVersion: String(row.selector_version),
    selectionStatus: String(row.selection_status) as WechatPresentationArtifact["selectionStatus"],
    templateId: row.template_id ? String(row.template_id) as WechatPresentationArtifact["templateId"] : undefined,
    templateFamily: row.template_family ? String(row.template_family) as WechatPresentationArtifact["templateFamily"] : undefined,
    selectedScore: row.selected_score === null ? undefined : Number(row.selected_score),
    runnerUpScore: row.runner_up_score === null ? undefined : Number(row.runner_up_score),
    businessReason: String(row.business_reason),
    html: row.html ? String(row.html) : undefined,
    htmlHash: row.html_hash ? String(row.html_hash) : undefined,
    validation: parseV5Json<WechatHtmlValidationResult>(row.validation_result, { passed: false, blockers: ["校验记录缺失"], warnings: [], checkedAt: "" }),
    reviewStatus: String(row.review_status) as WechatPresentationArtifact["reviewStatus"],
    coverImageRef: row.cover_image_ref ? String(row.cover_image_ref) : undefined,
    createdAt: asDate(row.created_at) || "",
    reviewedAt: asDate(row.reviewed_at),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : undefined,
    reviewReason: row.review_reason ? String(row.review_reason) : undefined,
    publishStatus: row.publish_status ? String(row.publish_status) as WechatPresentationArtifact["publishStatus"] : "not_sent",
    externalDraftId: row.external_draft_id ? String(row.external_draft_id) : undefined,
    draftUrl: row.draft_url ? String(row.draft_url) : undefined,
    publishError: row.publish_error ? String(row.publish_error) : undefined,
    publishedAt: asDate(row.published_at)
  };
}

export async function readWechatPresentationDraftContext(draftVersionId: string): Promise<WechatPresentationDraftContext> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT d.id, d.title, d.markdown, i.platform_content_type, i.content_type, i.target_audience, crv.cta_boundary
     FROM draft_version d
     JOIN content_matrix_item i ON i.id = d.matrix_item_id
     LEFT JOIN generation_run g ON g.id = d.generation_run_id
     LEFT JOIN channel_rule_version crv ON crv.id = g.channel_rule_version_id
     WHERE d.id = ? AND d.test_only = FALSE LIMIT 1`,
    [draftVersionId]
  );
  const row = rows[0];
  if (!row) throw new V5GovernanceRepositoryError("formal_draft_not_found", "正式正文不存在，无法生成公众号呈现。", 404, "返回批量生成中心刷新正文版本后重试。");
  return {
    draftVersionId: String(row.id),
    title: String(row.title),
    markdown: String(row.markdown),
    platformContentType: String(row.platform_content_type || ""),
    titleCategory: String(row.content_type || ""),
    targetAudience: String(row.target_audience || ""),
    ctaType: String(row.cta_boundary || "")
  };
}

export async function readLatestWechatPresentation(draftVersionId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM wechat_presentation_artifact WHERE draft_version_id = ? ORDER BY created_at DESC LIMIT 1",
    [draftVersionId]
  );
  return rows[0] ? mapArtifact(rows[0]) : undefined;
}

export async function createWechatPresentationArtifact(input: {
  presentationInput: WechatPresentationInput;
  sourceContentHash: string;
  inputHash: string;
  selection: WechatLayoutSelection;
  html?: string;
  htmlHash?: string;
  validation: WechatHtmlValidationResult;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM wechat_presentation_artifact WHERE draft_version_id = ? AND source_content_hash = ? AND selector_version = ? AND input_hash = ? LIMIT 1 FOR UPDATE",
      [input.presentationInput.draftVersionId, input.sourceContentHash, input.selection.selectorVersion, input.inputHash]
    );
    if (existing[0]) return mapArtifact(existing[0]);
    const artifactId = `wechat-presentation-${randomUUID()}`;
    const reviewStatus = input.selection.status === "selected" && input.validation.passed ? "pending_review" : "stale";
    await connection.query(
      `INSERT INTO wechat_presentation_artifact
       (id, draft_version_id, source_content_hash, input_hash, selector_version, selection_status, template_id, template_family,
        selected_score, runner_up_score, business_reason, candidate_scores, input_snapshot, html, html_hash,
        validation_result, review_status, cover_image_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [artifactId, input.presentationInput.draftVersionId, input.sourceContentHash, input.inputHash, input.selection.selectorVersion,
        input.selection.status, input.selection.selectedTemplateId || null, input.selection.family || null,
        input.selection.selectedScore ?? null, input.selection.runnerUpScore ?? null, input.selection.businessReason,
        stringifyV5Json(input.selection.candidates), stringifyV5Json({
          platformContentType: input.presentationInput.platformContentType,
          titleCategory: input.presentationInput.titleCategory,
          targetAudience: input.presentationInput.targetAudience,
          articleStructureTags: input.presentationInput.articleStructureTags,
          ctaType: input.presentationInput.ctaType,
          approvedImageRoles: input.presentationInput.approvedImageRoles
        }), input.html || null,
        input.htmlHash || null, stringifyV5Json(input.validation), reviewStatus,
        input.presentationInput.coverImageRef || null, input.actor.actorId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "wechat_presentation_generated",
      objectType: "wechat_presentation_artifact",
      objectId: artifactId,
      relatedSourceIds: [input.presentationInput.draftVersionId],
      afterSummary: { selectionStatus: input.selection.status, templateId: input.selection.selectedTemplateId, validationPassed: input.validation.passed, reviewStatus }
    });
    const [created] = await connection.query<RowDataPacket[]>("SELECT * FROM wechat_presentation_artifact WHERE id = ? LIMIT 1", [artifactId]);
    return mapArtifact(created[0]);
  });
}

export async function reviewWechatPresentation(input: {
  artifactId: string;
  draftVersionId: string;
  decision: "approved" | "rejected";
  reason: string;
  currentSourceContentHash: string;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM wechat_presentation_artifact WHERE id = ? FOR UPDATE", [input.artifactId]);
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("wechat_presentation_not_found", "公众号呈现工件不存在。", 404, "重新生成公众号呈现后再审核。");
    if (String(row.draft_version_id) !== input.draftVersionId) {
      throw new V5GovernanceRepositoryError("wechat_presentation_draft_mismatch", "公众号呈现不属于当前正文版本。", 409, "刷新正文后重新打开对应的公众号呈现。");
    }
    if (String(row.source_content_hash) !== input.currentSourceContentHash) {
      await connection.query("UPDATE wechat_presentation_artifact SET review_status = 'stale' WHERE id = ?", [input.artifactId]);
      throw new V5GovernanceRepositoryError("wechat_presentation_stale", "正文已变化，当前排版工件已失效。", 409, "基于最新正文重新生成公众号呈现。");
    }
    const validation = parseV5Json<WechatHtmlValidationResult>(row.validation_result, { passed: false, blockers: [], warnings: [], checkedAt: "" });
    if (input.decision === "approved" && (String(row.selection_status) !== "selected" || !validation.passed || !row.html)) {
      throw new V5GovernanceRepositoryError("wechat_presentation_not_approvable", "自动选版或 HTML 校验尚未通过。", 409, "修正规则后重新生成，不要人工选择模板绕过阻断。");
    }
    await connection.query(
      "UPDATE wechat_presentation_artifact SET review_status = ?, reviewed_by = ?, reviewed_at = NOW(), review_reason = ? WHERE id = ?",
      [input.decision, input.actor.actorId, input.reason, input.artifactId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.decision === "approved" ? "wechat_presentation_approved" : "wechat_presentation_rejected",
      objectType: "wechat_presentation_artifact",
      objectId: input.artifactId,
      beforeSummary: { reviewStatus: String(row.review_status) },
      afterSummary: { reviewStatus: input.decision, reason: input.reason }
    });
    const [updated] = await connection.query<RowDataPacket[]>("SELECT * FROM wechat_presentation_artifact WHERE id = ? LIMIT 1", [input.artifactId]);
    return mapArtifact(updated[0]);
  });
}

export async function claimWechatPresentationPublish(input: { artifactId: string; actor: SingleArticleActor }) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM wechat_presentation_artifact WHERE id = ? FOR UPDATE", [input.artifactId]);
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("wechat_presentation_not_found", "公众号呈现工件不存在。", 404, "重新生成并审核公众号呈现。");
    if (String(row.review_status) !== "approved") throw new V5GovernanceRepositoryError("wechat_presentation_not_approved", "公众号呈现尚未批准。", 409, "先确认最终呈现可发布。");
    if (String(row.publish_status) === "draft_created") return { claimed: false, artifact: mapArtifact(row) };
    if (String(row.publish_status) === "sending") throw new V5GovernanceRepositoryError("wechat_publish_in_progress", "公众号草稿正在写入，请勿重复提交。", 409, "稍后刷新发布状态。");
    await connection.query("UPDATE wechat_presentation_artifact SET publish_status = 'sending', publish_error = NULL WHERE id = ?", [input.artifactId]);
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "wechat_presentation_publish_started",
      objectType: "wechat_presentation_artifact",
      objectId: input.artifactId,
      beforeSummary: { publishStatus: String(row.publish_status) },
      afterSummary: { publishStatus: "sending" }
    });
    return { claimed: true, artifact: { ...mapArtifact(row), publishStatus: "sending" as const } };
  });
}

export async function completeWechatPresentationPublish(input: {
  artifactId: string;
  status: "draft_created" | "failed";
  externalDraftId?: string;
  draftUrl?: string;
  error?: string;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `UPDATE wechat_presentation_artifact
       SET publish_status = ?, external_draft_id = ?, draft_url = ?, publish_error = ?, published_at = ?
       WHERE id = ?`,
      [input.status, input.externalDraftId || null, input.draftUrl || null, input.error || null, input.status === "draft_created" ? new Date() : null, input.artifactId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.status === "draft_created" ? "wechat_presentation_publish_completed" : "wechat_presentation_publish_failed",
      objectType: "wechat_presentation_artifact",
      objectId: input.artifactId,
      afterSummary: { publishStatus: input.status, externalDraftId: input.externalDraftId, error: input.error }
    });
  });
}
