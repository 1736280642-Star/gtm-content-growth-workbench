import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const migrationPath = "database/migrations/20260714_003_v5_knowledge_governance_foundation.sql";
const governanceTables = [
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

test("knowledge governance migration creates the complete V5 entity chain", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const batchSourceMigration = await readFile("database/migrations/20260714_005_v5_ingestion_source_relation.sql", "utf8");
  const knowledgeBaseMigration = await readFile("database/migrations/20260714_006_v5_knowledge_base_registry.sql", "utf8");
  const governanceSchema = `${migration}\n${batchSourceMigration}\n${knowledgeBaseMigration}`;

  for (const table of governanceTables) {
    assert.match(governanceSchema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  }

  assert.doesNotMatch(governanceSchema, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\s+/im);
  assert.match(migration, /ALTER TABLE monthly_production_readiness/);
  assert.match(migration, /ADD COLUMN source_snapshot_hash CHAR\(64\)/);
  assert.match(migration, /ADD COLUMN evaluator_version VARCHAR\(64\)/);
});

test("source and claim contracts preserve immutable evidence traceability", async () => {
  const migration = await readFile(migrationPath, "utf8");

  for (const field of [
    "source_revision_id",
    "source_locator",
    "original_quote",
    "authority_level",
    "support_mode",
    "claim_scope",
    "extractor_version",
    "supersedes_claim_id"
  ]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`), field);
  }

  assert.match(migration, /UNIQUE KEY uq_source_revision_number \(source_id, revision_number\)/);
  assert.match(migration, /UNIQUE KEY uq_rule_package_version \(rule_package_id, version\)/);
  assert.match(migration, /immutable_at DATETIME NULL/);
  const batchSourceMigration = await readFile("database/migrations/20260714_005_v5_ingestion_source_relation.sql", "utf8");
  assert.match(batchSourceMigration, /CREATE TABLE IF NOT EXISTS ingestion_batch_source_asset/);
  assert.match(batchSourceMigration, /UNIQUE KEY uq_batch_source_relation \(batch_id, source_id\)/);
});

test("G0-G6 persistence and service write protections have schema support", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const concurrencyMigration = await readFile("database/migrations/20260714_004_v5_governance_write_concurrency.sql", "utf8");

  assert.match(migration, /knowledge_governance_run/);
  assert.match(migration, /knowledge_governance_gate_result/);
  assert.match(migration, /current_gate VARCHAR\(8\)/);
  assert.match(migration, /input_fingerprint CHAR\(64\)/);
  assert.match(migration, /governance_idempotency_record/);
  assert.match(migration, /governance_audit_event/);
  assert.match(migration, /expected_version INT NOT NULL/);
  for (const table of ["ingestion_batch", "source_asset", "product_claim", "claim_conflict", "evidence_gap", "rule_package_version"]) {
    assert.match(concurrencyMigration, new RegExp(`ALTER TABLE ${table} ADD COLUMN row_version INT NOT NULL DEFAULT 1`), table);
  }
  assert.doesNotMatch(concurrencyMigration, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\s+/im);
  const statusWidthMigration = await readFile("database/migrations/20260714_007_v5_idempotency_status_width.sql", "utf8");
  assert.match(statusWidthMigration, /MODIFY COLUMN response_status VARCHAR\(64\) NOT NULL/);
});

test("migration runner plans governance migration as non-destructive", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/init-v5-monthly-schema.mjs", "--plan"], {
    cwd: process.cwd()
  });
  const result = JSON.parse(stdout.trim());
  const migration = result.migrations.find((item) => item.name === "20260714_003_v5_knowledge_governance_foundation.sql");
  const concurrencyMigration = result.migrations.find((item) => item.name === "20260714_004_v5_governance_write_concurrency.sql");
  const batchSourceMigration = result.migrations.find((item) => item.name === "20260714_005_v5_ingestion_source_relation.sql");
  const knowledgeBaseMigration = result.migrations.find((item) => item.name === "20260714_006_v5_knowledge_base_registry.sql");
  const statusWidthMigration = result.migrations.find((item) => item.name === "20260714_007_v5_idempotency_status_width.sql");

  assert.ok(migration);
  assert.equal(migration.destructive, false);
  assert.equal(migration.requiresConfirmation, false);
  assert.ok(migration.statementCount >= governanceTables.length);
  assert.ok(concurrencyMigration);
  assert.equal(concurrencyMigration.destructive, false);
  assert.ok(batchSourceMigration);
  assert.equal(batchSourceMigration.destructive, false);
  assert.ok(knowledgeBaseMigration);
  assert.equal(knowledgeBaseMigration.destructive, false);
  assert.ok(statusWidthMigration);
  assert.equal(statusWidthMigration.destructive, false);
});

test("TypeScript contract exposes every governed handoff", async () => {
  const contract = await readFile("src/lib/v5/knowledge-governance-contracts.ts", "utf8");

  for (const exportedType of [
    "V5ProductEntity",
    "V5IngestionBatch",
    "V5SourceAsset",
    "V5SourceRevision",
    "V5ProductClaim",
    "V5ClaimConflict",
    "V5EvidenceGap",
    "V5RulePackageVersion",
    "V5ApprovalRecord",
    "V5SourceSnapshot",
    "V5GovernanceAuditEvent"
  ]) {
    assert.match(contract, new RegExp(`export interface ${exportedType}\\b`), exportedType);
  }

  assert.match(contract, /export type V5GateCode = "G0" \| "G1" \| "G2" \| "G3" \| "G4" \| "G5" \| "G6"/);
});
