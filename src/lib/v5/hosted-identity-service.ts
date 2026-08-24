import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { DEMO_LOGIN_CODE, isDemoMode } from "../demo/config";
import { recordDemoEmail } from "../demo/email";
import { demoRead, demoReset, demoWrite } from "../demo/store";
import { deliverHostedTransactionalEmail, hostedPublicBaseUrl } from "./hosted-email-client";
import {
  getV5GovernancePool,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";

export const HOSTED_IDENTITY_COOKIE = "joto_hosted_session";
const LOGIN_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;
const hostedRoles = ["workspace_admin", "product_owner", "operator", "viewer"] as const;
export type HostedWorkspaceRole = typeof hostedRoles[number];

const DEMO_SESSION_KEY = "demo:hosted-identity-session";
const DEMO_EMAIL = "demo@joto.ai";
const DEMO_USER_ID = "demo-user-1";
const DEMO_WORKSPACE_ID = "demo-workspace-1";

interface DemoHostedSession {
  token: string;
  context: HostedIdentityContext;
}

function createDemoSession(): { context: HostedIdentityContext; sessionToken: string } {
  const sessionToken = `demo-${randomBytes(24).toString("base64url")}`;
  const context: HostedIdentityContext = {
    sessionId: `demo-session-${randomUUID()}`,
    userId: DEMO_USER_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    email: DEMO_EMAIL,
    role: "workspace_admin"
  };
  demoWrite(DEMO_SESSION_KEY, { token: sessionToken, context } satisfies DemoHostedSession);
  return { context, sessionToken };
}

export interface HostedIdentityContext {
  sessionId: string;
  userId: string;
  workspaceId: string;
  email: string;
  role: HostedWorkspaceRole;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opaqueToken() {
  return randomBytes(32).toString("base64url");
}

function normalizeEmail(value: string) {
  const email = value.trim().toLocaleLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new V5GovernanceRepositoryError("hosted_identity_email_invalid", "请输入有效的邮箱地址。", 400);
  }
  return email;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] || character);
}

export async function requestHostedEmailLogin(rawEmail: string): Promise<{ accepted: boolean; deliveryQueued: boolean; demoCode?: string }> {
  if (isDemoMode()) {
    const email = normalizeEmail(rawEmail);
    recordDemoEmail({
      to: email,
      subject: "登录 JOTO GEO 托管工作台（演示）",
      text: `演示验证码：${DEMO_LOGIN_CODE}`,
      html: `<p>演示验证码：<strong>${DEMO_LOGIN_CODE}</strong></p>`,
      idempotencyKey: `demo-login-${email}`
    });
    return { accepted: true, deliveryQueued: true, demoCode: DEMO_LOGIN_CODE };
  }
  const email = normalizeEmail(rawEmail);
  const [recent] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id FROM hosted_identity_login_challenge
     WHERE email = ? AND status = 'pending' AND expires_at > NOW()
       AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (recent[0]) return { accepted: true, deliveryQueued: true };

  const challengeId = `hosted-login-${randomUUID()}`;
  const token = opaqueToken();
  await getV5GovernancePool().query(
    `INSERT INTO hosted_identity_login_challenge
     (id, email, token_hash, status, expires_at, delivery_status)
     VALUES (?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? MINUTE), 'sending')`,
    [challengeId, email, sha256(token), LOGIN_TTL_MINUTES]
  );
  const actionUrl = `${hostedPublicBaseUrl()}/hosted/login/verify#token=${encodeURIComponent(token)}`;
  try {
    await deliverHostedTransactionalEmail({
      to: email,
      subject: "登录 JOTO GEO 托管工作台",
      text: `点击以下链接登录 JOTO GEO 托管工作台：\n\n${actionUrl}\n\n链接在 ${LOGIN_TTL_MINUTES} 分钟内有效且只能使用一次。若不是你本人操作，请忽略本邮件。`,
      html: `<p>点击下面的按钮登录 JOTO GEO 托管工作台。</p><p><a href="${escapeHtml(actionUrl)}">登录工作台</a></p><p>链接在 ${LOGIN_TTL_MINUTES} 分钟内有效且只能使用一次。若不是你本人操作，请忽略本邮件。</p>`,
      idempotencyKey: challengeId
    });
    await getV5GovernancePool().query(
      "UPDATE hosted_identity_login_challenge SET delivery_status = 'sent', delivery_error = NULL WHERE id = ?",
      [challengeId]
    );
  } catch (error) {
    await getV5GovernancePool().query(
      "UPDATE hosted_identity_login_challenge SET delivery_status = 'failed', delivery_error = ? WHERE id = ?",
      [error instanceof Error ? error.message.slice(0, 500) : "邮件发送失败", challengeId]
    );
    throw error;
  }
  return { accepted: true, deliveryQueued: false };
}

export async function consumeHostedEmailLogin(token: string) {
  if (isDemoMode()) {
    if (token !== DEMO_LOGIN_CODE) {
      throw new V5GovernanceRepositoryError("hosted_identity_login_invalid", "演示模式请输入固定验证码 000000，或使用一键演示登录。", 401);
    }
    return createDemoSession();
  }
  if (!token || token.length < 32 || token.length > 200) {
    throw new V5GovernanceRepositoryError("hosted_identity_login_invalid", "登录链接无效或已过期。", 401);
  }
  const sessionToken = opaqueToken();
  const result = await withV5GovernanceTransaction(async (connection) => {
    const [challenges] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM hosted_identity_login_challenge
       WHERE token_hash = ? AND status = 'pending' AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1 FOR UPDATE`,
      [sha256(token)]
    );
    const challenge = challenges[0];
    if (!challenge) throw new V5GovernanceRepositoryError("hosted_identity_login_invalid", "登录链接无效、已使用或已过期。", 401);
    const email = normalizeEmail(String(challenge.email));
    const [users] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM hosted_identity_user WHERE email = ? LIMIT 1 FOR UPDATE",
      [email]
    );
    const userId = users[0]?.id ? String(users[0].id) : `hosted-user-${randomUUID()}`;
    if (users[0]) {
      if (String(users[0].status) !== "active") {
        throw new V5GovernanceRepositoryError("hosted_identity_user_disabled", "该用户已停用。", 403);
      }
      await connection.query(
        "UPDATE hosted_identity_user SET email_verified_at = NOW(), last_login_at = NOW() WHERE id = ?",
        [userId]
      );
    } else {
      await connection.query(
        `INSERT INTO hosted_identity_user (id, email, status, email_verified_at, last_login_at)
         VALUES (?, ?, 'active', NOW(), NOW())`,
        [userId, email]
      );
    }
    const [memberships] = await connection.query<RowDataPacket[]>(
      `SELECT member.workspace_id, member.role
       FROM hosted_workspace_member member
       JOIN hosted_workspace workspace ON workspace.id = member.workspace_id
       WHERE member.user_id = ? AND member.status = 'active' AND workspace.status = 'active'
       ORDER BY member.joined_at LIMIT 1 FOR UPDATE`,
      [userId]
    );
    let workspaceId: string;
    let role: HostedWorkspaceRole;
    if (memberships[0]) {
      workspaceId = String(memberships[0].workspace_id);
      role = String(memberships[0].role) as HostedWorkspaceRole;
    } else {
      workspaceId = `hosted-workspace-${randomUUID()}`;
      role = "workspace_admin";
      const emailName = email.split("@")[0]?.slice(0, 80) || "我的";
      await connection.query(
        "INSERT INTO hosted_workspace (id, name, status, created_by) VALUES (?, ?, 'active', ?)",
        [workspaceId, `${emailName} 的工作区`, userId]
      );
      await connection.query(
        `INSERT INTO hosted_workspace_member (workspace_id, user_id, role, status, joined_at)
         VALUES (?, ?, 'workspace_admin', 'active', NOW())`,
        [workspaceId, userId]
      );
    }
    const sessionId = `hosted-session-${randomUUID()}`;
    await connection.query(
      `INSERT INTO hosted_identity_session
       (id, user_id, workspace_id, token_hash, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), NOW())`,
      [sessionId, userId, workspaceId, sha256(sessionToken), SESSION_TTL_DAYS]
    );
    await connection.query(
      "UPDATE hosted_identity_login_challenge SET status = 'used', used_at = NOW() WHERE id = ?",
      [String(challenge.id)]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: userId,
      actorRole: role,
      actorType: "human",
      auditReason: "用户通过一次性邮箱链接登录托管工作台",
      eventType: "hosted_identity_login_succeeded",
      objectType: "hosted_identity_session",
      objectId: sessionId,
      afterSummary: { workspaceId, challengeId: String(challenge.id) },
      correlationId: workspaceId
    });
    return { context: { sessionId, userId, workspaceId, email, role } satisfies HostedIdentityContext };
  });
  return { ...result, sessionToken };
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

export async function readHostedIdentity(request: Request): Promise<HostedIdentityContext | undefined> {
  if (isDemoMode()) {
    const token = readCookie(request, HOSTED_IDENTITY_COOKIE);
    if (!token) return undefined;
    const session = demoRead<DemoHostedSession | undefined>(DEMO_SESSION_KEY, () => undefined);
    if (!session || session.token !== token) return undefined;
    return session.context;
  }
  const token = readCookie(request, HOSTED_IDENTITY_COOKIE);
  if (!token) return undefined;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT session.id AS session_id, session.user_id, session.workspace_id,
            user.email, member.role
     FROM hosted_identity_session session
     JOIN hosted_identity_user user ON user.id = session.user_id AND user.status = 'active'
     JOIN hosted_workspace_member member ON member.workspace_id = session.workspace_id
       AND member.user_id = session.user_id AND member.status = 'active'
     JOIN hosted_workspace workspace ON workspace.id = session.workspace_id AND workspace.status = 'active'
     WHERE session.token_hash = ? AND session.revoked_at IS NULL AND session.expires_at > NOW()
     LIMIT 1`,
    [sha256(token)]
  );
  if (!rows[0]) return undefined;
  const role = String(rows[0].role) as HostedWorkspaceRole;
  if (!hostedRoles.includes(role)) return undefined;
  void getV5GovernancePool().query(
    "UPDATE hosted_identity_session SET last_seen_at = NOW() WHERE id = ? AND last_seen_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)",
    [String(rows[0].session_id)]
  ).catch(() => undefined);
  return {
    sessionId: String(rows[0].session_id),
    userId: String(rows[0].user_id),
    workspaceId: String(rows[0].workspace_id),
    email: String(rows[0].email),
    role
  };
}

export async function requireHostedIdentity(request: Request) {
  const context = await readHostedIdentity(request);
  if (!context) throw new V5GovernanceRepositoryError("hosted_identity_required", "请先通过邮箱登录。", 401, "/hosted/login");
  return context;
}

export function requireHostedRole(context: HostedIdentityContext, allowed: HostedWorkspaceRole[]) {
  if (!allowed.includes(context.role)) {
    throw new V5GovernanceRepositoryError("hosted_workspace_role_denied", "当前成员没有执行此操作的权限。", 403);
  }
}

export async function linkWorkspaceProduct(input: { workspaceId: string; productId: string; userId: string }) {
  if (isDemoMode()) return;
  await getV5GovernancePool().query(
    `INSERT INTO hosted_workspace_product (workspace_id, product_id, linked_by, linked_at)
     VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE linked_by = linked_by`,
    [input.workspaceId, input.productId, input.userId]
  );
}

export async function assertWorkspaceProductAccess(workspaceId: string, productId: string) {
  if (isDemoMode()) return;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT product_id FROM hosted_workspace_product WHERE workspace_id = ? AND product_id = ? LIMIT 1",
    [workspaceId, productId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_product_not_found", "产品不存在或当前工作区无权访问。", 404);
}

export async function assertWorkspaceOrderAccess(workspaceId: string, orderId: string) {
  if (isDemoMode()) return;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT id FROM hosted_promotion_order WHERE workspace_id = ? AND id = ? LIMIT 1",
    [workspaceId, orderId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
}

export async function revokeHostedIdentitySession(sessionId: string) {
  if (isDemoMode()) {
    demoReset(DEMO_SESSION_KEY);
    return;
  }
  await getV5GovernancePool().query(
    "UPDATE hosted_identity_session SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?",
    [sessionId]
  );
}

export function hostedSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${HOSTED_IDENTITY_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_DAYS * 86400}${secure}`;
}

export function clearHostedSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${HOSTED_IDENTITY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
