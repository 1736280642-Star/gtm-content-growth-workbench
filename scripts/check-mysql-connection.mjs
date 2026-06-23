import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length) {
  console.log(JSON.stringify({ ok: false, status: "pending_config", missingEnv }, null, 2));
  process.exit(0);
}

let connection;

try {
  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  });

  const [rows] = await connection.query("SELECT 1 AS ok");
  console.log(JSON.stringify({ ok: true, status: "ready", rows }, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown MySQL connection error"
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await connection?.end();
}
