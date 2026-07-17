import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
const v5Tables = [
  "monthly_plan",
  "monthly_strategy_package_version",
  "content_matrix_version",
  "content_matrix_item",
  "monthly_production_readiness",
  "production_pool_entry",
  "artifact_reference"
];
const foundationMigrationName = "20260714_001_v5_monthly_foundation.sql";
const dropV4MigrationName = "20260714_002_drop_v4_weekly_tables.sql";

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
    const placeholders = v5Tables.map(() => "?").join(", ");
    const [tableRows] = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (${placeholders})`,
      [process.env.MYSQL_DATABASE, ...v5Tables]
    );
    const presentTables = new Set((Array.isArray(tableRows) ? tableRows : []).map((row) => String(row.TABLE_NAME || row.table_name)));
    const missingV5Tables = v5Tables.filter((table) => !presentTables.has(table));
    const [migrationRows] = await pool.query(
      "SELECT name, checksum, applied_at FROM workbench_schema_migration WHERE name IN (?, ?) ORDER BY name",
      [foundationMigrationName, dropV4MigrationName]
    );
    const appliedMigrations = (Array.isArray(migrationRows) ? migrationRows : []).map((row) => ({
      name: String(row.name),
      checksumLength: String(row.checksum).length,
      appliedAt: row.applied_at
    }));
    const foundationMigration = appliedMigrations.find((migration) => migration.name === foundationMigrationName);
    const dropV4MigrationApplied = appliedMigrations.some((migration) => migration.name === dropV4MigrationName);
    const foundationMigrationVerified = foundationMigration?.checksumLength === 64;
    const ok = missingV5Tables.length === 0 && foundationMigrationVerified && !dropV4MigrationApplied;

    emit({
      ok,
      status: ok ? "success" : "failed",
      v5TableCount: v5Tables.length,
      missingV5Tables,
      foundationMigrationVerified,
      dropV4MigrationApplied,
      appliedMigrations
    });

    if (!ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown schema verification error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
