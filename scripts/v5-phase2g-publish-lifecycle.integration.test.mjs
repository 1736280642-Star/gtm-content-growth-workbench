import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";
import { backfillFormalPublishJobResult } from "../src/lib/v5/monthly-execution-repository";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository";

loadProjectEnv();

test("formal MySQL result retains publication and advances liveness without duplicating rows", async (t) => {
  const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
  if (requiredEnv.some((name) => !process.env[name])) return t.skip("MySQL is not configured");

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const planId = `it-plan-${suffix}`;
  const matrixItemId = `it-item-${suffix}`;
  const scheduleId = `it-schedule-${suffix}`;
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
      `INSERT INTO monthly_plan
       (id, plan_month, status, goals, product_quotas, channel_mix, content_type_mix, publish_frequency, version)
       VALUES (?, '2099-12', 'in_execution', '{}', '{}', '{}', '{}', '{}', 1)`,
      [planId]
    );
    await pool.query(
      `INSERT INTO content_matrix_item
       (id, monthly_plan_id, matrix_version_id, publish_date, week_index, product_id, channel, content_type,
        title, secondary_distilled_term_ids, knowledge_base_ids, status, version)
       VALUES (?, ?, ?, '2099-12-01', 1, 'integration-product', 'wechat', 'boundary-guide',
        'Phase2G lifecycle integration fixture', '[]', '[]', 'scheduled', 1)`,
      [matrixItemId, planId, `it-matrix-${suffix}`]
    );

    const firstObservedAt = "2099-12-01T00:00:00.000Z";
    await backfillFormalPublishJobResult({
      taskId: matrixItemId,
      status: "published",
      publicUrl: `https://example.com/${suffix}`,
      publishScheduleId: scheduleId,
      publishedAt: firstObservedAt,
      urlStatus: "public",
      firstPublicObservedAt: firstObservedAt,
      lastVerifiedAt: firstObservedAt,
      verificationCount: 1
    });
    await backfillFormalPublishJobResult({
      taskId: matrixItemId,
      status: "published",
      publicUrl: `https://example.com/${suffix}`,
      publishScheduleId: scheduleId,
      publishedAt: firstObservedAt,
      urlStatus: "removed",
      firstPublicObservedAt: firstObservedAt,
      lastVerifiedAt: "2099-12-01T12:00:00.000Z",
      removedAt: "2099-12-01T12:00:00.000Z",
      verificationCount: 2,
      failureReason: "fixture removed after publication"
    });

    const [rows] = await pool.query("SELECT * FROM content_publish_result WHERE matrix_item_id = ?", [matrixItemId]);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].status), "published");
    assert.equal(String(rows[0].publish_schedule_id), scheduleId);
    assert.equal(Number(rows[0].verification_count), 2);
    assert.ok(rows[0].first_public_observed_at);
    assert.ok(rows[0].removed_at);
    assert.equal(Number(rows[0].version), 2);
  } finally {
    await pool.query("DELETE FROM content_publish_result WHERE matrix_item_id = ?", [matrixItemId]);
    await pool.query("DELETE FROM content_matrix_item WHERE id = ?", [matrixItemId]);
    await pool.query("DELETE FROM monthly_plan WHERE id = ?", [planId]);
    await pool.end();
    await getV5GovernancePool().end();
  }
});
