import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const v4WeeklyTables = ["weekly_plan", "content_task", "article_draft", "publish_record"];
const v5Tables = [
  "monthly_plan",
  "monthly_strategy_package_version",
  "content_matrix_version",
  "content_matrix_item",
  "monthly_production_readiness",
  "production_pool_entry",
  "artifact_reference"
];

test("base schema no longer creates V4 weekly tables", async () => {
  const schema = await readFile("database/schema.sql", "utf8");

  for (const table of v4WeeklyTables) {
    assert.doesNotMatch(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test("V5 foundation is greenfield and contains no legacy migration fields", async () => {
  const migration = await readFile("database/migrations/20260714_001_v5_monthly_foundation.sql", "utf8");

  for (const table of v5Tables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }

  assert.doesNotMatch(migration, /legacy_|weekly_plan|v5_migration_run|v5_migration_item_map/i);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\s+/im);
});

test("cutover migration drops exactly the obsolete V4 weekly tables", async () => {
  const migration = await readFile("database/migrations/20260714_002_drop_v4_weekly_tables.sql", "utf8");

  for (const table of v4WeeklyTables) {
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS ${table}\\s*;`));
  }

  for (const table of ["workspace_setting", "knowledge_base", "blog_article", "geo_test_result", "workbench_state_snapshot"]) {
    assert.doesNotMatch(migration, new RegExp(`DROP TABLE IF EXISTS ${table}\\s*;`));
  }
});

test("migration plan marks the V4 drop as destructive", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/init-v5-monthly-schema.mjs", "--plan"], {
    cwd: process.cwd()
  });
  const result = JSON.parse(stdout.trim());
  const dropMigration = result.migrations.find((migration) => migration.name === "20260714_002_drop_v4_weekly_tables.sql");

  assert.equal(result.status, "planned");
  assert.equal(dropMigration.destructive, true);
  assert.equal(dropMigration.requiresConfirmation, true);
});

test("migration runner refuses destructive cutover without explicit confirmation", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/init-v5-monthly-schema.mjs"], {
    cwd: process.cwd()
  });
  const result = JSON.parse(stdout.trim());

  assert.equal(result.status, "confirmation_required");
  assert.deepEqual(result.destructiveMigrations, ["20260714_002_drop_v4_weekly_tables.sql"]);
});

test("monthly TypeScript contract contains only native V5 entities", async () => {
  const contract = await readFile("src/lib/v5/monthly-contracts.ts", "utf8");

  assert.match(contract, /export interface V5MonthlyPlan\b/);
  assert.match(contract, /export interface V5ContentMatrixItem\b/);
  assert.match(contract, /export interface V5MonthlyProductionReadiness\b/);
  assert.doesNotMatch(contract, /V4|WeeklyPlan|legacy/i);
});
