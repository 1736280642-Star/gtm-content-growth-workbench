import { createHash } from "node:crypto";
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

async function executePortableStatement(connection, statement) {
  const columnMatch = statement.match(/^ALTER\s+TABLE\s+`?([a-zA-Z0-9_]+)`?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s+([\s\S]+)$/i);
  if (columnMatch) {
    const [, tableName, columnName, definition] = columnMatch;
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
      [tableName, columnName]
    );
    if (rows.length) return;
    return connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  }
  const dropIndexMatch = statement.match(/^ALTER\s+TABLE\s+`?([a-zA-Z0-9_]+)`?\s+DROP\s+INDEX\s+IF\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?$/i);
  if (dropIndexMatch) {
    const [, tableName, indexName] = dropIndexMatch;
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
      [tableName, indexName]
    );
    if (!rows.length) return;
    return connection.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``);
  }
  const indexMatch = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s+ON\s+`?([a-zA-Z0-9_]+)`?\s*([\s\S]+)$/i);
  if (!indexMatch) return connection.query(statement);
  const [, unique, indexName, tableName, definition] = indexMatch;
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
    [tableName, indexName]
  );
  if (rows.length) return;
  return connection.query(`CREATE ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` ON \`${tableName}\` ${definition}`);
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
      await executePortableStatement(pool, statement);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS workbench_schema_migration (
      name VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const [ledgerColumns] = await pool.query("SHOW COLUMNS FROM workbench_schema_migration");
    const ledgerColumnNames = new Set(ledgerColumns.map((column) => String(column.Field)));
    const migrationNameColumn = ledgerColumnNames.has("name") ? "name" : "migration_name";
    const hasChecksum = ledgerColumnNames.has("checksum");
    const migrationsDirectory = join(process.cwd(), "database/migrations");
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));
    let appliedMigrations = 0;
    for (const migrationName of migrationNames) {
      const [existing] = await pool.query(`SELECT ${migrationNameColumn} FROM workbench_schema_migration WHERE ${migrationNameColumn} = ? LIMIT 1`, [migrationName]);
      if (existing.length) continue;
      const migrationSql = await readFile(join(migrationsDirectory, migrationName), "utf8");
      for (const statement of splitStatements(migrationSql)) await executePortableStatement(pool, statement);
      if (hasChecksum) {
        const checksum = createHash("sha256").update(migrationSql).digest("hex");
        await pool.query(`INSERT INTO workbench_schema_migration (${migrationNameColumn}, checksum) VALUES (?, ?)`, [migrationName, checksum]);
      } else {
        await pool.query(`INSERT INTO workbench_schema_migration (${migrationNameColumn}) VALUES (?)`, [migrationName]);
      }
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
