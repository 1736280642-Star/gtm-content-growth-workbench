import { createHash, randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const baseUrl = String(process.env.HOSTED_ACCEPTANCE_BASE_URL || "http://127.0.0.1:3027").replace(/\/$/, "");
const token = randomBytes(32).toString("base64url");
const challengeId = `hosted-acceptance-${randomUUID()}`;
const email = `hosted-acceptance-${randomUUID()}@example.invalid`;
const database = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});

let userId = "";
let workspaceId = "";
let sessionId = "";
let challengeInserted = false;
try {
  await database.query(
    `INSERT INTO hosted_identity_login_challenge
     (id, email, token_hash, status, expires_at, delivery_status)
     VALUES (?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 5 MINUTE), 'sent')`,
    [challengeId, email, createHash("sha256").update(token, "utf8").digest("hex")]
  );
  challengeInserted = true;
  const verified = await fetch(`${baseUrl}/api/v5/hosted/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token })
  });
  const cookie = verified.headers.get("set-cookie") || "";
  const session = await fetch(`${baseUrl}/api/v5/hosted/auth/session`, {
    headers: { cookie: cookie.split(";")[0] || "" }
  });
  const payload = await session.json().catch(() => ({}));
  userId = String(payload.identity?.userId || "");
  workspaceId = String(payload.identity?.workspaceId || "");
  sessionId = String(payload.identity?.sessionId || "");
  process.stdout.write(`${JSON.stringify({
    ok: verified.ok && session.ok,
    verifyStatus: verified.status,
    sessionStatus: session.status,
    httpOnly: /HttpOnly/i.test(cookie),
    sameSiteLax: /SameSite=Lax/i.test(cookie),
    workspaceCreated: Boolean(workspaceId),
    role: payload.identity?.role
  })}\n`);
  if (!verified.ok || !session.ok || !userId || !workspaceId || !sessionId) process.exitCode = 1;
} finally {
  if (sessionId) await database.query("DELETE FROM governance_audit_event WHERE object_type = 'hosted_identity_session' AND object_id = ?", [sessionId]);
  if (userId) await database.query("DELETE FROM hosted_identity_session WHERE user_id = ?", [userId]);
  if (workspaceId && userId) await database.query("DELETE FROM hosted_workspace_member WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
  if (workspaceId) await database.query("DELETE FROM hosted_workspace WHERE id = ?", [workspaceId]);
  if (userId) await database.query("DELETE FROM hosted_identity_user WHERE id = ?", [userId]);
  if (challengeInserted) await database.query("DELETE FROM hosted_identity_login_challenge WHERE id = ?", [challengeId]);
  await database.end();
}
