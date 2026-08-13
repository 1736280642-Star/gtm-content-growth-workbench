import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
    `SELECT d.production_contract_id, d.production_contract_hash, pc.product_id, pc.product_strategy_pack_id,
       pc.production_mode, sp.status AS strategy_status,
       sf.decision AS latest_decision, sf.feedback_json AS latest_feedback_json,
       sf.decided_by AS latest_decided_by, sf.decided_at AS latest_decided_at,
       ec.id AS calibration_version_id
     FROM draft_version d
     LEFT JOIN production_contract_snapshot pc ON pc.id = d.production_contract_id
     LEFT JOIN product_strategy_packs sp ON sp.id = pc.product_strategy_pack_id
     LEFT JOIN sample_article_feedback sf ON sf.id = (
       SELECT sf2.id FROM sample_article_feedback sf2 WHERE sf2.draft_version_id = d.id ORDER BY sf2.decided_at DESC LIMIT 1
     )
     LEFT JOIN expression_calibration_version ec ON ec.source_sample_draft_id = d.id AND ec.status = 'active'
     WHERE d.id = ? AND d.test_only = FALSE LIMIT 1`,
    [draftVersionId]
  );
  const row = rows[0];
  if (!row) return { eligible: false };
  const latestFeedback = row.latest_feedback_json
    ? parseV5Json<SampleArticleFeedbackInput | undefined>(row.latest_feedback_json, undefined)
    : undefined;
  return {
    eligible: row.production_mode === "sample" && Boolean(row.production_contract_id) && ["strategy_approved", "pending_sample_review", "production_ready"].includes(String(row.strategy_status)),
    productId: row.product_id ? String(row.product_id) : undefined,
    productStrategyPackId: row.product_strategy_pack_id ? String(row.product_strategy_pack_id) : undefined,
    strategyStatus: row.strategy_status ? String(row.strategy_status) : undefined,
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
  if (input.actor.actorType !== "human") throw new V5GovernanceRepositoryError("human_actor_required", "样稿确认只能由真实用户完成。", 403);
  try { assertSampleArticleFeedback(input.feedback); } catch (error) {
    throw new V5GovernanceRepositoryError(error instanceof Error ? error.message : "sample_feedback_invalid", "样稿反馈没有通过结构校验。", 422);
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new V5GovernanceRepositoryError("sample_idempotency_key_invalid", "样稿确认幂等键长度不合法。", 400);
  }
  const feedbackHash = hashV5GovernancePayload(input.feedback);
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT d.id AS draft_id, d.copy_allowed, d.production_contract_id, d.production_contract_hash,
         pc.product_id, pc.product_strategy_pack_id, pc.production_mode, sp.status AS strategy_status
       FROM draft_version d
       JOIN production_contract_snapshot pc ON pc.id = d.production_contract_id
       JOIN product_strategy_packs sp ON sp.id = pc.product_strategy_pack_id
       WHERE d.id = ? AND d.test_only = FALSE FOR UPDATE`,
      [input.draftVersionId]
    );
    const row = rows[0];
    if (!row || row.production_mode !== "sample") throw new V5GovernanceRepositoryError("sample_draft_not_eligible", "该正文不是正式样稿合同生成的版本。", 409);
    if (!Boolean(row.copy_allowed)) throw new V5GovernanceRepositoryError("sample_draft_not_usable", "该样稿尚未通过系统事实与规则检查。", 409);
    const [existingRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM sample_article_feedback WHERE draft_version_id = ? AND idempotency_key = ? LIMIT 1",
      [input.draftVersionId, input.idempotencyKey]
    );
    if (existingRows[0]) {
      if (String(existingRows[0].feedback_hash) !== feedbackHash) throw new V5GovernanceRepositoryError("sample_decision_idempotency_conflict", "相同幂等键对应了不同样稿反馈。", 409);
      return {
        feedbackId: String(existingRows[0].id),
        decision: String(existingRows[0].decision),
        productId: String(row.product_id),
        productStrategyPackId: String(row.product_strategy_pack_id),
        replayed: true
      };
    }
    if (row.strategy_status === "production_ready" && input.feedback.decision !== "approved") {
      throw new V5GovernanceRepositoryError("production_ready_strategy_immutable", "已进入生产就绪的策略不能由旧样稿回退。", 409);
    }
    if (row.strategy_status === "production_ready") {
      throw new V5GovernanceRepositoryError(
        "sample_already_approved",
        "该样稿已经通过验收并冻结校准版本，不能重复确认。",
        409,
        "如需调整生产基线，请创建新的策略或样稿版本，不要改写已生效校准。"
      );
    }
    const feedbackId = `sample-feedback-${randomUUID()}`;
    await connection.query(
      `INSERT INTO sample_article_feedback
       (id, product_id, product_strategy_pack_id, draft_version_id, production_contract_id, decision,
        feedback_json, feedback_hash, idempotency_key, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [feedbackId, row.product_id, row.product_strategy_pack_id, input.draftVersionId, row.production_contract_id,
        input.feedback.decision, stringifyV5Json(input.feedback), feedbackHash, input.idempotencyKey, input.actor.actorId]
    );
    let calibrationVersionId: string | undefined;
    if (input.feedback.decision === "approved") {
      const [versionRows] = await connection.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM expression_calibration_version WHERE product_id = ? FOR UPDATE",
        [row.product_id]
      );
      const versionNumber = Number(versionRows[0]?.version_number || 0) + 1;
      const directives = Array.from(new Set([
        ...input.feedback.expressionDirectives.map((value) => value.trim()).filter(Boolean),
        ...input.feedback.issues.filter((issue) => issue.category === "expression").map((issue) => issue.instruction.trim())
      ])).slice(0, 20);
      const calibrationHash = hashV5GovernancePayload({ productId: row.product_id, strategyPackId: row.product_strategy_pack_id, directives, sourceDraftId: input.draftVersionId });
      calibrationVersionId = `expression-calibration-${calibrationHash.slice(0, 41)}`;
      await connection.query("UPDATE expression_calibration_version SET status = 'superseded' WHERE product_id = ? AND status = 'active'", [row.product_id]);
      await connection.query(
        `INSERT INTO expression_calibration_version
         (id, product_id, product_strategy_pack_id, version_number, status, directives_json, source_sample_draft_id,
          source_feedback_id, calibration_hash, approved_by, approved_at, immutable_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NOW(), NOW())`,
        [calibrationVersionId, row.product_id, row.product_strategy_pack_id, versionNumber, stringifyV5Json(directives),
          input.draftVersionId, feedbackId, calibrationHash, input.actor.actorId]
      );
      const [strategyUpdated] = await connection.query<ResultSetHeader>(
        "UPDATE product_strategy_packs SET status = 'production_ready', row_version = row_version + 1, updated_at = NOW() WHERE id = ? AND status IN ('strategy_approved', 'pending_sample_review')",
        [row.product_strategy_pack_id]
      );
      if (strategyUpdated.affectedRows !== 1) {
        throw new V5GovernanceRepositoryError(
          "sample_strategy_transition_conflict",
          "样稿校准已生成，但策略状态无法原子推进。",
          409,
          "刷新策略状态后重新验收；本次事务不会留下半完成校准。"
        );
      }
    } else {
      await connection.query(
        "UPDATE product_strategy_packs SET status = 'pending_sample_review', row_version = row_version + 1, updated_at = NOW() WHERE id = ? AND status = 'strategy_approved'",
        [row.product_strategy_pack_id]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: input.feedback.decision === "approved" ? "sample_article_approved" : "sample_article_changes_requested",
      objectType: "sample_article_feedback",
      objectId: feedbackId,
      afterSummary: { draftVersionId: input.draftVersionId, decision: input.feedback.decision, feedbackHash, calibrationVersionId },
      correlationId: String(row.production_contract_id)
    });
    return {
      feedbackId,
      decision: input.feedback.decision,
      calibrationVersionId,
      productId: String(row.product_id),
      productStrategyPackId: String(row.product_strategy_pack_id),
      replayed: false
    };
  });
}
