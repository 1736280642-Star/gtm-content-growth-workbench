import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
const productId = "weike-ai-guardrail";
const batchIdempotencyKey = "weike-guardrail-pilot-20260714-batch-create";
const expectedRuleVersionId = "weike-guardrail-pilot-20260714-rule-v0.1.0";

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (missingEnv.length) {
  emit({ ok: false, status: "pending_config", missingEnv });
  process.exitCode = 1;
} else {
  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 2
  });

  try {
    const [batchRows] = await pool.query("SELECT id, status FROM ingestion_batch WHERE idempotency_key = ? LIMIT 1", [batchIdempotencyKey]);
    const batch = Array.isArray(batchRows) ? batchRows[0] : undefined;
    if (!batch) throw new Error("Pilot ingestion batch not found");
    const batchId = String(batch.id);
    const [sourceRows] = await pool.query(
      `SELECT sa.status, sa.safety_status, COUNT(*) AS count
       FROM ingestion_batch_source_asset rel JOIN source_asset sa ON sa.id = rel.source_id
       WHERE rel.batch_id = ? GROUP BY sa.status, sa.safety_status`,
      [batchId]
    );
    const sourceStatusCounts = Object.fromEntries(
      (Array.isArray(sourceRows) ? sourceRows : []).map((row) => [`${String(row.status)}:${String(row.safety_status)}`, Number(row.count)])
    );
    const [revisionRows] = await pool.query(
      `SELECT COUNT(DISTINCT sr.id) AS count
       FROM source_revision sr JOIN ingestion_batch_source_asset rel ON rel.source_id = sr.source_id
       WHERE rel.batch_id = ?`,
      [batchId]
    );
    const [claimRows] = await pool.query("SELECT review_status, COUNT(*) AS count FROM product_claim WHERE product_id = ? GROUP BY review_status", [productId]);
    const claimStatusCounts = Object.fromEntries(
      (Array.isArray(claimRows) ? claimRows : []).map((row) => [String(row.review_status), Number(row.count)])
    );
    const [gapRows] = await pool.query("SELECT severity, status, COUNT(*) AS count FROM evidence_gap WHERE product_id = ? GROUP BY severity, status", [productId]);
    const gapStatusCounts = Object.fromEntries(
      (Array.isArray(gapRows) ? gapRows : []).map((row) => [`${String(row.severity)}:${String(row.status)}`, Number(row.count)])
    );
    const [ruleRows] = await pool.query(
      `SELECT id, status, pending_roles, linked_claim_ids, source_snapshot_hash, row_version
       FROM rule_package_version WHERE id = ? LIMIT 1`,
      [expectedRuleVersionId]
    );
    const rule = Array.isArray(ruleRows) ? ruleRows[0] : undefined;
    const pendingRoles = rule ? (typeof rule.pending_roles === "string" ? JSON.parse(rule.pending_roles) : rule.pending_roles) : [];
    const linkedClaimIds = rule ? (typeof rule.linked_claim_ids === "string" ? JSON.parse(rule.linked_claim_ids) : rule.linked_claim_ids) : [];
    const [approvalRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM approval_record WHERE object_type = 'package' AND object_id = ?",
      [expectedRuleVersionId]
    );
    const [activeRows] = await pool.query("SELECT COUNT(*) AS count FROM rule_package_version WHERE product_id = ? AND status = 'active'", [productId]);
    const [readinessRows] = await pool.query(
      "SELECT id, monthly_production_ready, status FROM monthly_production_readiness WHERE product_id = ? ORDER BY evaluated_at DESC LIMIT 1",
      [productId]
    );
    const [runRows] = await pool.query(
      `SELECT r.id, r.status, r.current_gate, r.version
       FROM knowledge_governance_run r WHERE r.batch_id = ? AND r.product_id = ? ORDER BY r.started_at DESC LIMIT 1`,
      [batchId, productId]
    );
    const run = Array.isArray(runRows) ? runRows[0] : undefined;
    const [gateRows] = run
      ? await pool.query("SELECT gate_code, status, decision FROM knowledge_governance_gate_result WHERE run_id = ? ORDER BY evaluated_at, gate_code", [String(run.id)])
      : [[]];
    const gates = (Array.isArray(gateRows) ? gateRows : []).map((row) => ({ gate: String(row.gate_code), status: String(row.status), decision: String(row.decision) }));
    const sourceTotal = Object.values(sourceStatusCounts).reduce((sum, count) => sum + Number(count), 0);
    const isolatedCount = Object.entries(sourceStatusCounts)
      .filter(([key]) => key.includes("isolated"))
      .reduce((sum, [, count]) => sum + Number(count), 0);
    const revisionCount = Number(Array.isArray(revisionRows) ? revisionRows[0]?.count || 0 : 0);
    const approvalCount = Number(Array.isArray(approvalRows) ? approvalRows[0]?.count || 0 : 0);
    const activeRuleCount = Number(Array.isArray(activeRows) ? activeRows[0]?.count || 0 : 0);
    const readiness = Array.isArray(readinessRows) ? readinessRows[0] : undefined;
    const checks = {
      sourceCountIs16: sourceTotal === 16,
      isolatedCountIs4: isolatedCount === 4,
      revisionCountIs12: revisionCount === 12,
      candidateClaimCountIs9: Number(claimStatusCounts.candidate || 0) === 9,
      evidenceGapCountIs8: Object.values(gapStatusCounts).reduce((sum, count) => sum + Number(count), 0) === 8,
      ruleDraftExists: Boolean(rule),
      ruleDraftNotActive: rule ? String(rule.status).startsWith("draft_pending_") : false,
      sixPendingRoles: Array.isArray(pendingRoles) && pendingRoles.length === 6,
      linkedClaimCountIs9: Array.isArray(linkedClaimIds) && linkedClaimIds.length === 9,
      snapshotHashIsStable: rule ? String(rule.source_snapshot_hash).length === 64 : false,
      noPackageApprovalWritten: approvalCount === 0,
      noActiveRulePackage: activeRuleCount === 0,
      monthlyProductionReadyIsFalse: !readiness || !Boolean(readiness.monthly_production_ready),
      governanceStoppedAtG5: Boolean(run) && String(run.current_gate) === "G5" && gates.at(-1)?.gate === "G5" && gates.at(-1)?.status === "blocked"
    };
    const ok = Object.values(checks).every(Boolean);

    emit({
      ok,
      status: ok ? "success" : "failed",
      productId,
      batchId,
      sourceStatusCounts,
      revisionCount,
      claimStatusCounts,
      gapStatusCounts,
      rulePackage: rule
        ? { id: String(rule.id), status: String(rule.status), pendingRoleCount: pendingRoles.length, linkedClaimCount: linkedClaimIds.length, snapshotHashLength: String(rule.source_snapshot_hash).length, rowVersion: Number(rule.row_version) }
        : null,
      packageApprovalCount: approvalCount,
      activeRuleCount,
      readiness: readiness ? { id: String(readiness.id), monthlyProductionReady: Boolean(readiness.monthly_production_ready), status: String(readiness.status) } : null,
      governanceRun: run ? { id: String(run.id), status: String(run.status), currentGate: String(run.current_gate), version: Number(run.version), gates } : null,
      checks
    });
    if (!ok) process.exitCode = 1;
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown pilot verification error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
