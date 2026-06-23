import { readFile } from "node:fs/promises";
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
    const schemaPath = join(process.cwd(), "database/schema.sql");
    const sql = await readFile(schemaPath, "utf8");
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter((statement) => statement && !statement.startsWith("--"));

    for (const statement of statements) {
      await pool.query(statement);
    }

    emit({ ok: true, status: "success", executed: statements.length });
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown schema init error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
