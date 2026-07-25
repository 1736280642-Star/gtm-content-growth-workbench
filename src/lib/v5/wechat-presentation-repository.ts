import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import type { SingleArticleActor } from "./single-article-contracts";
import type {
  WechatHtmlValidationResult,
  WechatPresentationArtifact,
  WechatPresentationInput,
  WechatTemplateRecommendation,
  WechatTemplateSelection
} from "./wechat-presentation-contracts";

export interface WechatPresentationDraftContext {
  draftVersionId: string;
  title: string;
  markdown: string;
  channel: string;
  platformContentType: string;
  titleCategory: string;
  targetAudience: string;
  ctaType: string;
}

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : undefined;
}

function mapSelection(row: RowDataPacket): WechatTemplateSelection {
  return {
    selectionId: String(row.id),
    draftVersionId: String(row.draft_version_id),
    sourceContentHash: String(row.source_content_hash),
    platformKey: "weixin",
    recommendedTemplateId: row.recommended_template_id ? String(row.recommended_template_id) as WechatTemplateSelection["recommendedTemplateId"] : undefined,
    selectedTemplateId: String(row.selected_template_id) as WechatTemplateSelection["selectedTemplateId"],
    templateVersion: String(row.template_version),
    selectionSource: "human",
    selectionReason: row.selection_reason ? String(row.selection_reason) : undefined,
    status: String(row.status) as WechatTemplateSelection["status"],
    selectedBy: String(row.selected_by),
    selectedAt: asDate(row.selected_at) || ""
  };
}

function mapArtifact(row: RowDataPacket): WechatPresentationArtifact {
  return {
    artifactId: String(row.id),
    selectionId: String(row.selection_id),
    draftVersionId: String(row.draft_version_id),
    sourceContentHash: String(row.source_content_hash),
    templateId: String(row.template_id) as WechatPresentationArtifact["templateId"],
    templateVersion: String(row.template_version),
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
    `SELECT d.id, d.title, d.markdown, i.channel, i.platform_content_type, i.content_type, i.target_audience, crv.cta_boundary
     FROM draft_version d
     JOIN content_matrix_item i ON i.id = d.matrix_item_id
     LEFT JOIN generation_run g ON g.id = d.generation_run_id
     LEFT JOIN channel_rule_version crv ON crv.id = g.channel_rule_version_id
     WHERE d.id = ? AND d.test_only = FALSE LIMIT 1`,
    [draftVersionId]
  );
  const row = rows[0];
  if (!row) throw new V5GovernanceRepositoryError("formal_draft_not_found", "正式正文不存在，无法处理公众号排版。", 404, "返回批量生成中心刷新正文版本后重试。");
  return {
    draftVersionId: String(row.id),
    title: String(row.title),
    markdown: String(row.markdown),
    channel: String(row.channel || ""),
    platformContentType: String(row.platform_content_type || ""),
    titleCategory: String(row.content_type || ""),
    targetAudience: String(row.target_audience || ""),
    ctaType: String(row.cta_boundary || "")
  };
}

export async function readCurrentWechatTemplateSelection(draftVersionId: string, sourceContentHash: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM wechat_template_selection
     WHERE draft_version_id = ? AND source_content_hash = ? AND status = 'selected'
     ORDER BY selected_at DESC LIMIT 1`,
    [draftVersionId, sourceContentHash]
  );
  return rows[0] ? mapSelection(rows[0]) : undefined;
}

export async function createWechatTemplateSelection(input: {
  draftVersionId: string;
  sourceContentHash: string;
  recommendation: WechatTemplateRecommendation;
  selectedTemplateId: WechatTemplateSelection["selectedTemplateId"];
  templateVersion: string;
  selectionReason?: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}) {
  const requestHash = hashV5GovernancePayload({
    operation: "wechat_manual_template_selection_v1",
    draftVersionId: input.draftVersionId,
    sourceContentHash: input.sourceContentHash,
    selectedTemplateId: input.selectedTemplateId,
    templateVersion: input.templateVersion,
    selectionReason: input.selectionReason || ""
  });
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM wechat_template_selection WHERE draft_version_id = ? AND idempotency_key = ? FOR UPDATE",
      [input.draftVersionId, input.idempotencyKey]
    );
    if (existing[0]) {
      if (String(existing[0].request_hash) !== requestHash) {
        throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同的模板选择。", 409, "刷新页面后重新选择模板。");
      }
      return mapSelection(existing[0]);
    }

    await connection.query(
      "UPDATE wechat_template_selection SET status = 'superseded' WHERE draft_version_id = ? AND status = 'selected'",
      [input.draftVersionId]
    );
    const selectionId = `wechat-selection-${randomUUID()}`;
    await connection.query(
      `INSERT INTO wechat_template_selection
       (id, draft_version_id, source_content_hash, platform_key, recommender_version, recommended_template_id,
        recommendation_result, selected_template_id, template_version, selection_source, selection_reason,
        status, idempotency_key, request_hash, selected_by, selected_at)
       VALUES (?, ?, ?, 'weixin', ?, ?, ?, ?, ?, 'human', ?, 'selected', ?, ?, ?, NOW())`,
      [selectionId, input.draftVersionId, input.sourceContentHash, input.recommendation.recommenderVersion,
        input.recommendation.recommendedTemplateId || null, stringifyV5Json(input.recommendation),
        input.selectedTemplateId, input.templateVersion, input.selectionReason || null,
        input.idempotencyKey, requestHash, input.actor.actorId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "wechat_template_selected",
      objectType: "wechat_template_selection",
      objectId: selectionId,
      relatedSourceIds: [input.draftVersionId],
      afterSummary: {
        platformKey: "weixin",
        recommendedTemplateId: input.recommendation.recommendedTemplateId,
        selectedTemplateId: input.selectedTemplateId,
        selectionSource: "human"
      }
    });
    const [created] = await connection.query<RowDataPacket[]>("SELECT * FROM wechat_template_selection WHERE id = ? LIMIT 1", [selectionId]);
    return mapSelection(created[0]);
  });
}

export async function readLatestWechatPresentation(selectionId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM wechat_presentation_artifact WHERE selection_id = ? ORDER BY created_at DESC LIMIT 1",
    [selectionId]
  );
  return rows[0] ? mapArtifact(rows[0]) : undefined;
}

export async function createWechatPresentationArtifact(input: {
  presentationInput: WechatPresentationInput;
  selection: WechatTemplateSelection;
  sourceContentHash: string;
  inputHash: string;
  html: string;
  htmlHash: string;
  validation: WechatHtmlValidationResult;
  actor: SingleArticleActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM wechat_presentation_artifact WHERE selection_id = ? AND input_hash = ? LIMIT 1 FOR UPDATE",
      [input.selection.selectionId, input.inputHash]
    );
    if (existing[0]) return mapArtifact(existing[0]);
    const artifactId = `wechat-presentation-${randomUUID()}`;
    const reviewStatus = input.validation.passed ? "pending_review" : "stale";
    await connection.query(
      `INSERT INTO wechat_presentation_artifact
       (id, selection_id, draft_version_id, source_content_hash, input_hash, template_id, template_version,
        html, html_hash, validation_result, review_status, cover_image_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [artifactId, input.selection.selectionId, input.presentationInput.draftVersionId, input.sourceContentHash,
        input.inputHash, input.selection.selectedTemplateId, input.selection.templateVersion, input.html,
        input.htmlHash, stringifyV5Json(input.validation), reviewStatus,
        input.presentationInput.coverImageRef || null, input.actor.actorId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "wechat_presentation_rendered",
      objectType: "wechat_presentation_artifact",
      objectId: artifactId,
      relatedSourceIds: [input.presentationInput.draftVersionId, input.selection.selectionId],
      afterSummary: { templateId: input.selection.selectedTemplateId, validationPassed: input.validation.passed, reviewStatus }
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
    if (!row) throw new V5GovernanceRepositoryError("wechat_presentation_not_found", "公众号呈现工件不存在。", 404, "重新生成图文预览后再审核。");
    if (String(row.draft_version_id) !== input.draftVersionId) throw new V5GovernanceRepositoryError("wechat_presentation_draft_mismatch", "公众号呈现不属于当前正文版本。", 409, "刷新正文后重新打开图文预览。");
    if (String(row.source_content_hash) !== input.currentSourceContentHash) {
      await connection.query("UPDATE wechat_presentation_artifact SET review_status = 'stale' WHERE id = ?", [input.artifactId]);
      throw new V5GovernanceRepositoryError("wechat_presentation_stale", "正文已变化，当前图文预览已失效。", 409, "基于最新正文重新选择模板并生成预览。");
    }
    const validation = parseV5Json<WechatHtmlValidationResult>(row.validation_result, { passed: false, blockers: [], warnings: [], checkedAt: "" });
    if (input.decision === "approved" && (!validation.passed || !row.html)) throw new V5GovernanceRepositoryError("wechat_presentation_not_approvable", "HTML 校验尚未通过。", 409, "修正内容或模板后重新生成图文预览。");
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
    if (!row) throw new V5GovernanceRepositoryError("wechat_presentation_not_found", "公众号呈现工件不存在。", 404, "重新生成并审核图文预览。");
    if (String(row.review_status) !== "approved") throw new V5GovernanceRepositoryError("wechat_presentation_not_approved", "图文预览尚未批准。", 409, "先确认最终呈现可发布。");
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
