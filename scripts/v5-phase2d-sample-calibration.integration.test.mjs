import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";
import { decideSampleArticle } from "../src/lib/v5/sample-calibration-repository";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository";

loadProjectEnv();
const required = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const ids = {
  product: `phase2d-product-${suffix}`,
  pack: `phase2d-pack-${suffix}`,
  contract: `phase2d-contract-${suffix}`,
  draft: `phase2d-draft-${suffix}`,
  task: `phase2d-task-${suffix}`
};

const feedback = { decision: "approved" };

test("human sample approval freezes one calibration and advances strategy to production_ready", { skip: missing.length ? `missing ${missing.join(",")}` : false }, async () => {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 2
  });
  try {
    await pool.query(
      `INSERT INTO product_strategy_packs
       (id, product_id, strategy_version, contract_version, rule_version, status, content_plan_json,
        content_plan_hash, row_version, compiled_at)
       VALUES (?, ?, 1, 'product-geo-strategy.v2', '1.0.0', 'strategy_approved', JSON_OBJECT(), ?, 1, NOW())`,
      [ids.pack, ids.product, "a".repeat(64)]
    );
    await pool.query(
      `INSERT INTO product_sample_article_task
       (id, product_id, product_strategy_pack_id, article_type_version_id, channel, platform_content_type,
        title, target_audience, secondary_distilled_term_ids, knowledge_base_ids, rule_package_version_id,
        prompt_group_id, prompt_group_version_id, channel_rule_version_id, status, review_status,
        approved_at, approved_by)
       VALUES (?, ?, ?, 'type-v1', 'wechat', 'explicit_product_intro', '样文', '决策者', JSON_ARRAY(),
        JSON_ARRAY(), 'rule-v1', 'prompt-v1', 'prompt-version-v1', 'channel-v1', 'generated',
        'pending_review', NOW(), 'test')`,
      [ids.task, ids.product, ids.pack]
    );
    await pool.query(
      `INSERT INTO production_contract_snapshot
       (id, contract_version, contract_hash, task_id, task_version, product_id, product_strategy_pack_id,
        article_type_version_id, final_evidence_pack_id, production_mode, contract_json, created_by, immutable_at)
       VALUES (?, 'content-production.v2', ?, ?, 1, ?, ?, 'type-v1', 'pack-v1', 'sample', JSON_OBJECT(), 'test', NOW())`,
      [ids.contract, "b".repeat(64), ids.task, ids.product, ids.pack]
    );
    await pool.query(
      `INSERT INTO draft_version
       (id, generation_run_id, task_id, task_version, matrix_item_id, final_evidence_pack_id,
        production_contract_id, production_contract_hash, rule_package_version_id, version_number, title,
        markdown, fact_traces, hard_rule_result, copy_allowed, test_only, created_by)
       VALUES (?, ?, ?, 1, ?, 'pack-v1', ?, ?, 'rule-v1', 1, '样稿', '# 样稿', JSON_ARRAY(),
        JSON_OBJECT('passed', TRUE), TRUE, FALSE, 'test')`,
      [ids.draft, `generation-${suffix}`, ids.task, ids.task, ids.contract, "b".repeat(64)]
    );

    await assert.rejects(
      () => decideSampleArticle({ draftVersionId: ids.draft, idempotencyKey: `sample-${suffix}`, feedback, actor: { actorId: "system", actorRole: "developer_admin", actorType: "system", auditReason: "not human" } }),
      (error) => error.code === "human_actor_required"
    );
    const actor = { actorId: "phase2d-reviewer", actorRole: "developer_admin", actorType: "human", auditReason: "确认样文" };
    const first = await decideSampleArticle({ draftVersionId: ids.draft, idempotencyKey: `sample-${suffix}`, feedback, actor });
    const replay = await decideSampleArticle({ draftVersionId: ids.draft, idempotencyKey: `sample-${suffix}`, feedback, actor });
    assert.equal(first.decision, "approved");
    assert.ok(first.calibrationVersionId);
    assert.equal(replay.replayed, true);
    await assert.rejects(
      () => decideSampleArticle({ draftVersionId: ids.draft, idempotencyKey: `sample-second-${suffix}`, feedback, actor }),
      (error) => error.code === "sample_already_approved"
    );
    const [[pack]] = await pool.query("SELECT status FROM product_strategy_packs WHERE id = ?", [ids.pack]);
    const [[calibration]] = await pool.query("SELECT status, article_type_version_id, immutable_at FROM expression_calibration_version WHERE id = ?", [first.calibrationVersionId]);
    assert.equal(pack.status, "production_ready");
    assert.equal(calibration.status, "active");
    assert.equal(calibration.article_type_version_id, "type-v1");
    assert.ok(calibration.immutable_at);
  } finally {
    await pool.query("DELETE FROM expression_calibration_version WHERE product_id = ?", [ids.product]);
    await pool.query("DELETE FROM sample_article_feedback WHERE product_id = ?", [ids.product]);
    await pool.query("DELETE FROM draft_version WHERE id = ?", [ids.draft]);
    await pool.query("DELETE FROM production_contract_snapshot WHERE id = ?", [ids.contract]);
    await pool.query("DELETE FROM product_sample_article_task WHERE id = ?", [ids.task]);
    await pool.query("DELETE FROM product_strategy_packs WHERE id = ?", [ids.pack]);
    await pool.end();
    await getV5GovernancePool().end();
  }
});
