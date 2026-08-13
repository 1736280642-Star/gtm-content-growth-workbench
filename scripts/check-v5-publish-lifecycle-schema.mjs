import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const expectedColumns = [
  "publish_schedule_id",
  "url_status",
  "first_public_observed_at",
  "last_verified_at",
  "stable_published_at",
  "removed_at",
  "verification_count"
];

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, status: "pending_config", missingEnv })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 1
  });
  try {
    const [rows] = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'content_publish_result'
         AND column_name IN (?)`,
      [expectedColumns]
    );
    const actual = new Set(rows.map((row) => String(row.column_name || row.COLUMN_NAME || "")));
    const missingColumns = expectedColumns.filter((name) => !actual.has(name));
    process.stdout.write(`${JSON.stringify({
      ok: missingColumns.length === 0,
      status: missingColumns.length ? "schema_incomplete" : "ready",
      verifiedColumns: expectedColumns.filter((name) => actual.has(name)),
      missingColumns
    })}\n`);
    if (missingColumns.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
