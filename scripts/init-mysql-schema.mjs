import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  if (missingEnv.length) {
    emit({ ok: false, status: "pending_config", missingEnv });
    return;
  }

  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 5
  });

  try {
    const splitStatements = (sql) => sql
      .replace(/^\s*--.*$/gm, "")
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    const schemaPath = join(process.cwd(), "database/schema.sql");
    const statements = splitStatements(await readFile(schemaPath, "utf8"));

    for (const statement of statements) {
      await pool.query(statement);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS workbench_schema_migration (
      migration_name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const migrationsDirectory = join(process.cwd(), "database/migrations");
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));
    let appliedMigrations = 0;
    for (const migrationName of migrationNames) {
      const [existing] = await pool.query("SELECT migration_name FROM workbench_schema_migration WHERE migration_name = ? LIMIT 1", [migrationName]);
      if (existing.length) continue;
      const migrationSql = await readFile(join(migrationsDirectory, migrationName), "utf8");
      for (const statement of splitStatements(migrationSql)) await pool.query(statement);
      await pool.query("INSERT INTO workbench_schema_migration (migration_name) VALUES (?)", [migrationName]);
      appliedMigrations += 1;
    }

    emit({ ok: true, status: "success", baseStatements: statements.length, appliedMigrations, totalMigrations: migrationNames.length });
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown schema init error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
