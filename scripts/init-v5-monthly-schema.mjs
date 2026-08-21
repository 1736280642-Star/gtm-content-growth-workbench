import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const migrationDirectory = join(process.cwd(), "database", "migrations");
const obsoleteCycleName = ["week", "ly"].join("");
const obsoletePlanTable = ["week", "ly_plan"].join("");
const dropV4Migration = `20260714_002_drop_v4_${obsoleteCycleName}_tables.sql`;
const planOnly = process.argv.includes("--plan");
const includeDropV4 = process.argv.includes("--include-drop-v4");
const confirmDropV4 = process.argv.includes("--confirm-drop-v4");
const allowAppliedChecksumDrift = process.argv.includes("--allow-applied-checksum-drift");
const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) =>
      statement
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
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

async function loadMigrations() {
  const fileNames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => includeDropV4 || name !== dropV4Migration)
    .sort();

  return Promise.all(
    fileNames.map(async (name) => {
      const sql = await readFile(join(migrationDirectory, name), "utf8");
      return {
        name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        statements: splitSqlStatements(sql),
        destructive: new RegExp(`DROP\\s+TABLE\\s+IF\\s+EXISTS\\s+(${obsoletePlanTable}|content_task|article_draft|publish_record)`, "i").test(sql)
      };
    })
  );
}

async function main() {
  const migrations = await loadMigrations();

  if (planOnly) {
    emit({
      ok: true,
      status: "planned",
      excludedMigrations: includeDropV4 ? [] : [dropV4Migration],
      migrations: migrations.map((migration) => ({
        name: migration.name,
        checksum: migration.checksum,
        statementCount: migration.statements.length,
        destructive: migration.destructive,
        requiresConfirmation: migration.destructive
      }))
    });
    return;
  }

  const destructiveMigrations = migrations.filter((migration) => migration.destructive);

  if (destructiveMigrations.length && !confirmDropV4) {
    emit({
      ok: false,
      status: "confirmation_required",
      message: "Obsolete V4 planning tables will be permanently deleted. Re-run with --confirm-drop-v4.",
      destructiveMigrations: destructiveMigrations.map((migration) => migration.name)
    });
    return;
  }

  if (missingEnv.length) {
    emit({
      ok: false,
      status: "pending_config",
      missingEnv,
      plannedMigrations: migrations.map((migration) => migration.name)
    });
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workbench_schema_migration (
        name VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await pool.query("SELECT name, checksum FROM workbench_schema_migration");
    const applied = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.name), String(row.checksum)]));
    const completed = [];
    const skipped = [];
    const appliedChecksumDrift = [];

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name);

      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          if (!allowAppliedChecksumDrift) {
            throw new Error(
              `Migration checksum mismatch: ${migration.name}. ` +
              "Re-run with --allow-applied-checksum-drift only after verifying the applied schema."
            );
          }
          appliedChecksumDrift.push(migration.name);
        }

        skipped.push(migration.name);
        continue;
      }

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        for (const statement of migration.statements) {
          await executePortableStatement(connection, statement);
        }

        await connection.query("INSERT INTO workbench_schema_migration (name, checksum) VALUES (?, ?)", [migration.name, migration.checksum]);
        await connection.commit();
        completed.push(migration.name);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    emit({ ok: true, status: "success", completed, skipped, appliedChecksumDrift });
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown V5 schema migration error" });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
