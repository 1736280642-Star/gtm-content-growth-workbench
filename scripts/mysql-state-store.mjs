import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readStdin() {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
  });
}

function assertReady() {
  if (missingEnv.length) {
    const error = new Error(`Missing MySQL env: ${missingEnv.join(", ")}`);
    error.missingEnv = missingEnv;
    throw error;
  }
}

function getConfig() {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  };
}

function toMysqlDateTime(value) {
  const fallback = new Date();
  const date = value ? new Date(value) : fallback;

  if (Number.isNaN(date.getTime())) {
    return fallback.toISOString().slice(0, 19).replace("T", " ");
  }

  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function createPool() {
  assertReady();
  return mysql.createPool({
    ...getConfig(),
    connectionLimit: 5,
    connectTimeout: 10000,
    waitForConnections: true,
    namedPlaceholders: false
  });
}

async function readState(pool) {
  const [rows] = await pool.query("SELECT state_json FROM workbench_state_snapshot WHERE id = 'current' LIMIT 1");
  const row = Array.isArray(rows) ? rows[0] : undefined;

  if (!row) {
    return null;
  }

  const value = typeof row.state_json === "string" ? row.state_json : JSON.stringify(row.state_json);
  return JSON.parse(value);
}

async function writeState(pool, state) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO workbench_state_snapshot (id, storage, state_json) VALUES ('current', 'mysql', ?) ON DUPLICATE KEY UPDATE storage = VALUES(storage), state_json = VALUES(state_json)",
      [JSON.stringify(state)]
    );
    await connection.query("DELETE FROM workbench_audit_event");

    if (Array.isArray(state.auditLog) && state.auditLog.length) {
      const rows = state.auditLog.map((event) => [event.id, event.event, event.message, toMysqlDateTime(event.createdAt)]);
      await connection.query("INSERT INTO workbench_audit_event (id, event, message, created_at) VALUES ?", [rows]);
    }

    await connection.commit();
    return { ok: true };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original query error as the bridge response.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  let pool;

  try {
    const action = process.argv[2];
    pool = await createPool();

    if (action === "read") {
      const state = await readState(pool);
      emit({ ok: true, found: Boolean(state), state });
      return;
    }

    if (action === "write") {
      const stdin = await readStdin();
      const payload = stdin ? JSON.parse(stdin) : {};
      const result = await writeState(pool, payload.state);
      emit({ ok: true, ...result });
      return;
    }

    emit({ ok: false, status: "failed", message: `Unknown action: ${action}` });
    process.exitCode = 1;
  } catch (error) {
    emit({
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown MySQL bridge error",
      missingEnv: error && error.missingEnv ? error.missingEnv : undefined
    });
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

await main();
