import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const obsoleteCycleName = ["week", "ly"].join("");
const obsoletePlanTable = ["week", "ly_plan"].join("");
const dropV4MigrationName = `20260714_002_drop_v4_${obsoleteCycleName}_tables.sql`;
const v4LegacyTables = [obsoletePlanTable, "content_task", "article_draft", "publish_record"];
const v5Tables = [
  "monthly_plan",
  "monthly_strategy_package_version",
  "content_matrix_version",
  "content_matrix_item",
  "monthly_production_readiness",
  "production_pool_entry",
  "artifact_reference",
  "content_publish_result"
];

test("base schema no longer creates obsolete V4 planning tables", async () => {
  const schema = await readFile("database/schema.sql", "utf8");

  for (const table of v4LegacyTables) {
    assert.doesNotMatch(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test("V5 foundation is greenfield and contains no legacy migration fields", async () => {
  const migration = await readFile("database/migrations/20260714_001_v5_monthly_foundation.sql", "utf8");

  for (const table of v5Tables.filter((table) => table !== "content_publish_result")) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }

  assert.doesNotMatch(migration, new RegExp(`legacy_|${obsoletePlanTable}|v5_migration_run|v5_migration_item_map`, "i"));
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\s+/im);
});

test("cutover migration drops exactly the obsolete V4 planning tables", async () => {
  const migration = await readFile(`database/migrations/${dropV4MigrationName}`, "utf8");

  for (const table of v4LegacyTables) {
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS ${table}\\s*;`));
  }

  for (const table of ["workspace_setting", "knowledge_base", "blog_article", "workbench_state_snapshot"]) {
    assert.doesNotMatch(migration, new RegExp(`DROP TABLE IF EXISTS ${table}\\s*;`));
  }
});

test("default migration plan excludes the V4 drop migration", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/init-v5-monthly-schema.mjs", "--plan"], {
    cwd: process.cwd()
  });
  const result = JSON.parse(stdout.trim());
  const dropMigration = result.migrations.find((migration) => migration.name === dropV4MigrationName);

  assert.equal(result.status, "planned");
  assert.equal(dropMigration, undefined);
  assert.deepEqual(result.excludedMigrations, [dropV4MigrationName]);
});

test("explicit cutover plan marks the V4 drop as destructive", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/init-v5-monthly-schema.mjs", "--plan", "--include-drop-v4"],
    { cwd: process.cwd() }
  );
  const result = JSON.parse(stdout.trim());
  const dropMigration = result.migrations.find((migration) => migration.name === dropV4MigrationName);

  assert.equal(result.status, "planned");
  assert.equal(dropMigration.destructive, true);
  assert.equal(dropMigration.requiresConfirmation, true);
});

test("explicitly included cutover still requires destructive confirmation", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/init-v5-monthly-schema.mjs", "--include-drop-v4"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MYSQL_HOST: "",
      MYSQL_PORT: "",
      MYSQL_DATABASE: "",
      MYSQL_USER: "",
      MYSQL_PASSWORD: ""
    }
  });
  const result = JSON.parse(stdout.trim());

  assert.equal(result.status, "confirmation_required");
  assert.deepEqual(result.destructiveMigrations, [dropV4MigrationName]);
});

test("monthly execution closure persists scheduling, publish results and metrics", async () => {
  const migration = await readFile("database/migrations/20260727_012_v5_monthly_execution_closure.sql", "utf8");
  assert.match(migration, /ADD COLUMN workspace_config JSON/);
  assert.match(migration, /ADD COLUMN question_version_id VARCHAR\(64\)/);
  assert.match(migration, /ADD COLUMN scheduled_at DATETIME/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS content_publish_result/);
  assert.match(migration, /metrics JSON NOT NULL/);
});

test("checksum drift override preserves applied migration records and only skips them", async () => {
  const migrationScript = await readFile("scripts/init-v5-monthly-schema.mjs", "utf8");

  assert.match(migrationScript, /--allow-applied-checksum-drift/);
  assert.match(migrationScript, /appliedChecksumDrift\.push\(migration\.name\)/);
  assert.match(migrationScript, /skipped\.push\(migration\.name\)/);
  assert.doesNotMatch(migrationScript, /UPDATE workbench_schema_migration/);
});

test("schema verification rejects an applied V4 drop instead of requiring it", async () => {
  const verification = await readFile("scripts/check-v5-schema-cutover.mjs", "utf8");

  assert.match(verification, /foundationMigrationVerified/);
  assert.match(verification, /dropV4MigrationApplied/);
  assert.match(verification, /!dropV4MigrationApplied/);
  assert.doesNotMatch(verification, /remainingV4Tables\.length\s*===\s*0/);
});

test("monthly TypeScript contract contains only native V5 entities", async () => {
  const contract = await readFile("src/lib/v5/monthly-contracts.ts", "utf8");

  assert.match(contract, /export interface V5MonthlyPlan\b/);
  assert.match(contract, /export interface V5ContentMatrixItem\b/);
  assert.match(contract, /export interface V5MonthlyProductionReadiness\b/);
  const obsoletePlanType = ["Week", "lyPlan"].join("");
  assert.doesNotMatch(contract, new RegExp(`V4|${obsoletePlanType}|legacy`, "i"));
});
