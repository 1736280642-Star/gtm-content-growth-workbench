import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
const expectedTables = [
  "knowledge_base",
  "product_entity",
  "product_entity_candidate",
  "knowledge_base_product_link",
  "ingestion_batch",
  "source_asset",
  "ingestion_batch_source_asset",
  "knowledge_base_source_asset",
  "source_revision",
  "product_claim",
  "claim_conflict",
  "claim_conflict_item",
  "evidence_gap",
  "ingestion_issue",
  "product_expression_rule_package",
  "rule_package_version",
  "rule_package_claim",
  "rule_package_source_revision",
  "rule_package_change",
  "approval_record",
  "term_candidate",
  "question_candidate",
  "source_snapshot",
  "source_snapshot_item",
  "knowledge_governance_run",
  "knowledge_governance_gate_result",
  "governance_idempotency_record",
  "governance_audit_event"
];

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (missingEnv.length) {
  emit({ ok: false, status: "pending_config", missingEnv });
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
    const placeholders = expectedTables.map(() => "?").join(", ");
    const [tableRows] = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (${placeholders})`,
      [process.env.MYSQL_DATABASE, ...expectedTables]
    );
    const presentTables = new Set((Array.isArray(tableRows) ? tableRows : []).map((row) => String(row.TABLE_NAME || row.table_name)));
    const missingTables = expectedTables.filter((table) => !presentTables.has(table));
    const [columnRows] = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = ? AND (
         (table_name = 'monthly_production_readiness' AND column_name IN ('source_snapshot_id', 'source_snapshot_hash', 'reason_codes', 'evaluated_at', 'evaluator_version', 'governance_run_id'))
         OR (table_name = 'production_pool_entry' AND column_name IN ('version', 'activated_at', 'suspended_at'))
         OR (column_name = 'row_version' AND table_name IN ('knowledge_base', 'product_entity', 'product_entity_candidate', 'knowledge_base_product_link', 'ingestion_batch', 'source_asset', 'product_claim', 'claim_conflict', 'evidence_gap', 'ingestion_issue', 'product_expression_rule_package', 'rule_package_version', 'rule_package_change', 'term_candidate', 'question_candidate'))
       )`,
      [process.env.MYSQL_DATABASE]
    );
    const presentColumns = new Set(
      (Array.isArray(columnRows) ? columnRows : []).map((row) => `${String(row.TABLE_NAME || row.table_name)}.${String(row.COLUMN_NAME || row.column_name)}`)
    );
    const expectedColumns = [
      "monthly_production_readiness.source_snapshot_id",
      "monthly_production_readiness.source_snapshot_hash",
      "monthly_production_readiness.reason_codes",
      "monthly_production_readiness.evaluated_at",
      "monthly_production_readiness.evaluator_version",
      "monthly_production_readiness.governance_run_id",
      "production_pool_entry.version",
      "production_pool_entry.activated_at",
      "production_pool_entry.suspended_at",
      ...[
        "knowledge_base",
        "product_entity",
        "product_entity_candidate",
        "knowledge_base_product_link",
        "ingestion_batch",
        "source_asset",
        "product_claim",
        "claim_conflict",
        "evidence_gap",
        "ingestion_issue",
        "product_expression_rule_package",
        "rule_package_version",
        "rule_package_change",
        "term_candidate",
        "question_candidate"
      ].map((table) => `${table}.row_version`)
    ];
    const missingColumns = expectedColumns.filter((column) => !presentColumns.has(column));
    const [migrationRows] = await pool.query(
      "SELECT name, checksum, applied_at FROM workbench_schema_migration WHERE name IN (?, ?, ?, ?, ?) ORDER BY name",
      [
        "20260714_003_v5_knowledge_governance_foundation.sql",
        "20260714_004_v5_governance_write_concurrency.sql",
        "20260714_005_v5_ingestion_source_relation.sql",
        "20260714_006_v5_knowledge_base_registry.sql",
        "20260714_007_v5_idempotency_status_width.sql"
      ]
    );
    const migrations = (Array.isArray(migrationRows) ? migrationRows : []).map((migration) => ({
      name: String(migration.name),
      checksumLength: String(migration.checksum).length,
      appliedAt: migration.applied_at
    }));
    const migrationVerified = migrations.length === 5 && migrations.every((migration) => migration.checksumLength === 64);
    const ok = missingTables.length === 0 && missingColumns.length === 0 && migrationVerified;

    emit({
      ok,
      status: ok ? "success" : "failed",
      expectedTableCount: expectedTables.length,
      presentTableCount: expectedTables.length - missingTables.length,
      missingTables,
      expectedColumnCount: expectedColumns.length,
      missingColumns,
      migrations
    });

    if (!ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown governance schema verification error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
