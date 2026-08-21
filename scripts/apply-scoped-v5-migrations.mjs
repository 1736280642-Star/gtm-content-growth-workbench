import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const migrationNames = process.argv.slice(2);
if (!migrationNames.length || migrationNames.some((name) => !/^20\d{6}_\d{3}_[a-z0-9_]+\.sql$/i.test(name))) {
  throw new Error("Usage: node scripts/apply-scoped-v5-migrations.mjs <migration.sql> [...]");
}

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = requiredEnv.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`pending_config:${missing.join(",")}`);

function statements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim()).filter(Boolean);
}

async function executePortable(connection, statement) {
  const addColumn = statement.match(/^ALTER\s+TABLE\s+`?([a-zA-Z0-9_]+)`?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s+([\s\S]+)$/i);
  if (addColumn) {
    const [, tableName, columnName, definition] = addColumn;
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
      [tableName, columnName]
    );
    if (!rows.length) await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    return;
  }
  const createIndex = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s+ON\s+`?([a-zA-Z0-9_]+)`?\s*([\s\S]+)$/i);
  if (createIndex) {
    const [, unique, indexName, tableName, definition] = createIndex;
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
      [tableName, indexName]
    );
    if (!rows.length) await connection.query(`CREATE ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` ON \`${tableName}\` ${definition}`);
    return;
  }
  return connection.query(statement);
}

const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectionLimit: 2
});

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS workbench_schema_migration (
    name VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  const [migrationColumns] = await pool.query("SHOW COLUMNS FROM workbench_schema_migration");
  const migrationColumnNames = new Set(migrationColumns.map((row) => String(row.Field)));
  const nameColumn = migrationColumnNames.has("name") ? "name" : "migration_name";
  const hasChecksum = migrationColumnNames.has("checksum");
  const completed = [];
  const skipped = [];
  for (const requestedName of migrationNames) {
    const name = basename(requestedName);
    const sql = await readFile(resolve("database", "migrations", name), "utf8");
    if (/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(sql)) throw new Error(`destructive_migration_forbidden:${name}`);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [rows] = await pool.query(
      `SELECT ${hasChecksum ? "checksum" : nameColumn} FROM workbench_schema_migration WHERE \`${nameColumn}\` = ? LIMIT 1`,
      [name]
    );
    if (rows[0]) {
      if (hasChecksum && String(rows[0].checksum) !== checksum) throw new Error(`migration_checksum_mismatch:${name}`);
      skipped.push(name);
      continue;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of statements(sql)) await executePortable(connection, statement);
      await connection.query(
        hasChecksum
          ? `INSERT INTO workbench_schema_migration (\`${nameColumn}\`, checksum) VALUES (?, ?)`
          : `INSERT INTO workbench_schema_migration (\`${nameColumn}\`) VALUES (?)`,
        hasChecksum ? [name, checksum] : [name]
      );
      await connection.commit();
      completed.push(name);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  console.log(JSON.stringify({ status: "completed", completed, skipped }));
} finally {
  await pool.end();
}
