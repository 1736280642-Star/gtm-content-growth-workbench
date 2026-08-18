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
import {
  assertSampleArticleFeedback,
  type SampleArticleFeedbackInput,
  type SampleArticleReviewState
} from "./sample-calibration-contracts";

export async function readSampleArticleReviewState(draftVersionId: string): Promise<SampleArticleReviewState> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT d.production_contract_id, d.production_contract_hash, d.task_id,
       pc.product_id, pc.product_strategy_pack_id, pc.article_type_version_id,
       pc.production_mode, sp.status AS strategy_status, task.review_status,
       sf.decision AS latest_decision, sf.feedback_json AS latest_feedback_json,
       sf.decided_by AS latest_decided_by, sf.decided_at AS latest_decided_at,
       ec.id AS calibration_version_id
     FROM draft_version d
     LEFT JOIN production_contract_snapshot pc ON pc.id = d.production_contract_id
     LEFT JOIN product_strategy_packs sp ON sp.id = pc.product_strategy_pack_id
     LEFT JOIN product_sample_article_task task ON task.id = d.task_id
     LEFT JOIN sample_article_feedback sf ON sf.id = (
       SELECT sf2.id FROM sample_article_feedback sf2 WHERE sf2.draft_version_id = d.id ORDER BY sf2.decided_at DESC LIMIT 1
     )
     LEFT JOIN expression_calibration_version ec
       ON ec.source_sample_draft_id = d.id AND ec.status = 'active'
     WHERE d.id = ? AND d.test_only = FALSE LIMIT 1`,
    [draftVersionId]
  );
  const row = rows[0];
  if (!row) return { eligible: false };
  const latestFeedback = row.latest_feedback_json
    ? parseV5Json<SampleArticleFeedbackInput | undefined>(row.latest_feedback_json, undefined)
    : undefined;
  return {
    eligible: row.production_mode === "sample" && Boolean(row.production_contract_id)
      && ["strategy_approved", "pending_sample_review", "production_ready"].includes(String(row.strategy_status)),
    productId: row.product_id ? String(row.product_id) : undefined,
    productStrategyPackId: row.product_strategy_pack_id ? String(row.product_strategy_pack_id) : undefined,
    articleTypeVersionId: row.article_type_version_id ? String(row.article_type_version_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    strategyStatus: row.strategy_status ? String(row.strategy_status) : undefined,
    reviewStatus: row.review_status ? String(row.review_status) : undefined,
    productionContractId: row.production_contract_id ? String(row.production_contract_id) : undefined,
    productionContractHash: row.production_contract_hash ? String(row.production_contract_hash) : undefined,
    latestDecision: row.latest_decision ? String(row.latest_decision) as SampleArticleFeedbackInput["decision"] : undefined,
    latestFeedback,
    latestDecidedBy: row.latest_decided_by ? String(row.latest_decided_by) : undefined,
    latestDecidedAt: row.latest_decided_at instanceof Date
      ? row.latest_decided_at.toISOString()
      : row.latest_decided_at ? String(row.latest_decided_at) : undefined,
    calibrationVersionId: row.calibration_version_id ? String(row.calibration_version_id) : undefined
  };
}

export async function decideSampleArticle(input: {
  draftVersionId: string;
  idempotencyKey: string;
  feedback: SampleArticleFeedbackInput;
  actor: SingleArticleActor;
}) {
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceRepositoryError("human_actor_required", "样文确认只能由真实用户完成。", 403);
  }
  try {
    assertSampleArticleFeedback(input.feedback);
  } catch (error) {
    const code = error instanceof Error ? error.message : "sample_feedback_invalid";
    const message = code === "sample_revision_instruction_required"
      ? "请直接写下希望模型如何修改这篇文章。"
      : code === "sample_revision_instruction_too_long"
        ? "修改要求不能超过 1200 字。"
        : "样文反馈没有通过结构校验。";
    throw new V5GovernanceRepositoryError(code, message, 422);
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new V5GovernanceRepositoryError("sample_idempotency_key_invalid", "样文确认幂等键长度不合法。", 400);
  }
  const feedback = {
    decision: input.feedback.decision,
    ...(input.feedback.revisionInstruction?.trim()
      ? { revisionInstruction: input.feedback.revisionInstruction.trim() }
      : {})
  } satisfies SampleArticleFeedbackInput;
  const feedbackHash = hashV5GovernancePayload(feedback);

  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT d.id AS draft_id, d.task_id, d.markdown, d.copy_allowed,
         d.production_contract_id, d.production_contract_hash,
         pc.product_id, pc.product_strategy_pack_id, pc.article_type_version_id,
         pc.production_mode, sp.status AS strategy_status, task.review_status
       FROM draft_version d
       JOIN production_contract_snapshot pc ON pc.id = d.production_contract_id
       JOIN product_strategy_packs sp ON sp.id = pc.product_strategy_pack_id
       JOIN product_sample_article_task task ON task.id = d.task_id
       WHERE d.id = ? AND d.test_only = FALSE FOR UPDATE`,
      [input.draftVersionId]
    );
    const row = rows[0];
    if (!row || row.production_mode !== "sample") {
      throw new V5GovernanceRepositoryError("sample_draft_not_eligible", "该正文不是正式样文合同生成的版本。", 409);
    }
    if (!Boolean(row.copy_allowed)) {
      throw new V5GovernanceRepositoryError("sample_draft_not_usable", "该样文尚未通过系统事实与规则检查。", 409);
    }
    const [existingRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM sample_article_feedback WHERE draft_version_id = ? AND idempotency_key = ? LIMIT 1",
      [input.draftVersionId, input.idempotencyKey]
    );
    if (existingRows[0]) {
      if (String(existingRows[0].feedback_hash) !== feedbackHash) {
        throw new V5GovernanceRepositoryError("sample_decision_idempotency_conflict", "相同幂等键对应了不同样文反馈。", 409);
      }
      return {
        feedbackId: String(existingRows[0].id),
        decision: String(existingRows[0].decision),
        productId: String(row.product_id),
        productStrategyPackId: String(row.product_strategy_pack_id),
        articleTypeVersionId: String(row.article_type_version_id),
        taskId: String(row.task_id),
        replayed: true
      };
    }
    if (String(row.review_status) === "approved") {
      throw new V5GovernanceRepositoryError(
        "sample_already_approved",
        "这篇样文已经确认并冻结。",
        409,
        "如需调整写作基准，请生成新的策略包版本。"
      );
    }

    const feedbackId = `sample-feedback-${randomUUID()}`;
    await connection.query(
      `INSERT INTO sample_article_feedback
       (id, product_id, product_strategy_pack_id, draft_version_id, production_contract_id, decision,
        feedback_json, feedback_hash, idempotency_key, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [feedbackId, row.product_id, row.product_strategy_pack_id, input.draftVersionId,
        row.production_contract_id, feedback.decision, stringifyV5Json(feedback), feedbackHash,
        input.idempotencyKey, input.actor.actorId]
    );

    let calibrationVersionId: string | undefined;
    if (feedback.decision === "approved") {
      const [versionRows] = await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM expression_calibration_version WHERE product_id = ? FOR UPDATE",
        [row.product_id]
      );
      const versionNumber = Number(versionRows[0]?.version_number || 0) + 1;
      const calibrationHash = hashV5GovernancePayload({
        productId: row.product_id,
        strategyPackId: row.product_strategy_pack_id,
        articleTypeVersionId: row.article_type_version_id,
        sourceDraftId: input.draftVersionId,
        acceptedMarkdownHash: hashV5GovernancePayload(String(row.markdown))
      });
      calibrationVersionId = `expression-calibration-${calibrationHash.slice(0, 41)}`;
      await connection.query(
        `UPDATE expression_calibration_version SET status = 'superseded'
         WHERE product_id = ? AND article_type_version_id = ? AND status = 'active'`,
        [row.product_id, row.article_type_version_id]
      );
      await connection.query(
        `INSERT INTO expression_calibration_version
         (id, product_id, product_strategy_pack_id, article_type_version_id, version_number, status,
          directives_json, source_sample_draft_id, source_feedback_id, calibration_hash,
          approved_by, approved_at, immutable_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NOW(), NOW())`,
        [calibrationVersionId, row.product_id, row.product_strategy_pack_id, row.article_type_version_id,
          versionNumber, stringifyV5Json([]), input.draftVersionId, feedbackId, calibrationHash,
          input.actor.actorId]
      );
      await connection.query(
        `UPDATE product_sample_article_task
         SET review_status = 'approved', accepted_draft_version_id = ?, accepted_at = NOW(),
             accepted_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [input.draftVersionId, input.actor.actorId, row.task_id]
      );
    } else {
      await connection.query(
        `UPDATE product_sample_article_task
         SET review_status = 'pending_revision', updated_at = NOW()
         WHERE id = ?`,
        [row.task_id]
      );
    }

    const [remainingRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS remaining
       FROM product_sample_article_task
       WHERE product_strategy_pack_id = ? AND review_status <> 'approved'`,
      [row.product_strategy_pack_id]
    );
    const remaining = Number(remainingRows[0]?.remaining || 0);
    await connection.query(
      `UPDATE product_strategy_packs
       SET status = ?, row_version = row_version + 1, updated_at = NOW()
       WHERE id = ? AND status IN ('strategy_approved', 'pending_sample_review', 'production_ready')`,
      [remaining === 0 ? "production_ready" : "pending_sample_review", row.product_strategy_pack_id]
    );

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: feedback.decision === "approved" ? "sample_article_approved" : "sample_article_changes_requested",
      objectType: "sample_article_feedback",
      objectId: feedbackId,
      afterSummary: {
        draftVersionId: input.draftVersionId,
        taskId: String(row.task_id),
        articleTypeVersionId: String(row.article_type_version_id),
        decision: feedback.decision,
        feedbackHash,
        calibrationVersionId,
        remainingSamples: remaining
      },
      correlationId: String(row.production_contract_id)
    });
    return {
      feedbackId,
      decision: feedback.decision,
      calibrationVersionId,
      productId: String(row.product_id),
      productStrategyPackId: String(row.product_strategy_pack_id),
      articleTypeVersionId: String(row.article_type_version_id),
      taskId: String(row.task_id),
      strategyReady: remaining === 0,
      replayed: false
    };
  });
}
