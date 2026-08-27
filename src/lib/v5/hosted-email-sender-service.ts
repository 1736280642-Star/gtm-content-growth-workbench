import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";

export const personalEmailProviders = ["qq", "163", "aliyun", "gmail", "outlook"] as const;
export type PersonalEmailProvider = (typeof personalEmailProviders)[number];

type StoredCredentials =
  | { kind: "smtp_app_password"; appPassword: string }
  | { kind: "oauth_refresh_token"; refreshToken: string };

interface SenderConnection {
  provider: PersonalEmailProvider;
  senderEmail: string;
  authType: StoredCredentials["kind"];
  encryptedCredentials: string;
  status: string;
}

const PRIMARY_CONNECTION_ID = "hosted-email-primary";
const OAUTH_STATE_TTL_MINUTES = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SMTP_PROVIDERS = {
  qq: { host: "smtp.qq.com", port: 465 },
  "163": { host: "smtp.163.com", port: 465 },
  aliyun: { host: "smtp.qiye.aliyun.com", port: 465 }
} as const;
type SmtpPersonalEmailProvider = keyof typeof SMTP_PROVIDERS;

function isSmtpProvider(provider: PersonalEmailProvider): provider is SmtpPersonalEmailProvider {
  return provider in SMTP_PROVIDERS;
}

function repositoryError(code: string, message: string, status = 400, nextAction?: string) {
  return new V5GovernanceRepositoryError(code, message, status, nextAction);
}

function encryptionKey() {
  const configured = process.env.HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw repositoryError(
      "hosted_email_encryption_key_missing",
      "发件邮箱加密密钥尚未配置。",
      503,
      "先在部署环境配置 HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY，再重启 3027。"
    );
  }
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw repositoryError("hosted_email_encryption_key_invalid", "发件邮箱加密密钥格式无效。", 503);
  }
  return key;
}

function encryptJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}

function decryptJson<T>(envelopeText: string): T {
  try {
    const envelope = JSON.parse(envelopeText) as Record<string, unknown>;
    if (envelope.version !== 1) throw new Error("unsupported envelope");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(String(envelope.iv || ""), "base64")
    );
    decipher.setAuthTag(Buffer.from(String(envelope.tag || ""), "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(String(envelope.ciphertext || ""), "base64")),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (error) {
    if (error instanceof V5GovernanceRepositoryError) throw error;
    throw repositoryError("hosted_email_credentials_unreadable", "发件邮箱授权信息无法解密。", 503, "重新授权发件邮箱。" );
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireHostedEmailSetupToken(submitted: string) {
  const expected = process.env.HOSTED_EMAIL_SETUP_TOKEN?.trim();
  if (!expected) {
    throw repositoryError(
      "hosted_email_setup_token_missing",
      "部署级发件邮箱设置口令尚未配置。",
      503,
      "先在部署环境配置 HOSTED_EMAIL_SETUP_TOKEN，再重启 3027。"
    );
  }
  if (!submitted || !safeEqual(submitted, expected)) {
    throw repositoryError("hosted_email_setup_forbidden", "发件邮箱设置口令无效。", 403);
  }
}

function assertEmail(value: string) {
  const email = value.trim().toLocaleLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw repositoryError("hosted_email_sender_invalid", "请输入有效的发件邮箱地址。", 400);
  }
  return email;
}

function assertProvider(value: string): PersonalEmailProvider {
  if (!personalEmailProviders.includes(value as PersonalEmailProvider)) {
    throw repositoryError("hosted_email_provider_invalid", "请选择 QQ、163、阿里云企业邮箱、Gmail 或 Outlook。", 400);
  }
  return value as PersonalEmailProvider;
}

function oauthConfig(provider: "gmail" | "outlook") {
  const prefix = provider === "gmail" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`HOSTED_EMAIL_${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`HOSTED_EMAIL_${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) {
    throw repositoryError(
      "hosted_email_oauth_client_missing",
      `${provider === "gmail" ? "Google" : "Microsoft"} OAuth 客户端尚未配置。`,
      503,
      `配置 HOSTED_EMAIL_${prefix}_CLIENT_ID 与 HOSTED_EMAIL_${prefix}_CLIENT_SECRET 后重试。`
    );
  }
  const baseUrl = (process.env.HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL || process.env.HOSTED_PUBLIC_BASE_URL || "http://127.0.0.1:3027")
    .trim().replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl}/api/v5/hosted/email-sender/oauth/callback/${provider}`
  };
}

function mapConnection(row: RowDataPacket): SenderConnection {
  return {
    provider: assertProvider(String(row.provider)),
    senderEmail: String(row.sender_email),
    authType: String(row.auth_type) as StoredCredentials["kind"],
    encryptedCredentials: String(row.encrypted_credentials),
    status: String(row.status)
  };
}

async function readConnection() {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM hosted_email_sender_connection WHERE id = ? LIMIT 1",
    [PRIMARY_CONNECTION_ID]
  );
  return rows[0] ? mapConnection(rows[0]) : undefined;
}

export async function readHostedEmailSenderStatus() {
  const connection = await readConnection();
  if (!connection) return { configured: false as const };
  return {
    configured: connection.status === "connected",
    provider: connection.provider,
    authType: connection.authType,
    status: connection.status,
    senderHint: connection.senderEmail.replace(/^(.{1,2}).*(@.*)$/, "$1***$2")
  };
}

async function saveConnection(input: {
  provider: PersonalEmailProvider;
  senderEmail: string;
  credentials: StoredCredentials;
  scopes?: string[];
  auditReason: string;
}) {
  const encrypted = encryptJson(input.credentials);
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO hosted_email_sender_connection
       (id, provider, sender_email, auth_type, encrypted_credentials, granted_scopes_json, status, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, 'connected', NOW(3))
       ON DUPLICATE KEY UPDATE provider = VALUES(provider), sender_email = VALUES(sender_email),
         auth_type = VALUES(auth_type), encrypted_credentials = VALUES(encrypted_credentials),
         granted_scopes_json = VALUES(granted_scopes_json), status = 'connected', last_verified_at = NOW(3),
         last_error_code = NULL, last_error_message = NULL, row_version = row_version + 1`,
      [PRIMARY_CONNECTION_ID, input.provider, input.senderEmail, input.credentials.kind, encrypted, JSON.stringify(input.scopes || [])]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: "hosted-email-deployment-admin",
      actorRole: "deployment_admin",
      actorType: "human",
      auditReason: input.auditReason,
      eventType: "hosted_email_sender_connected",
      objectType: "hosted_email_sender_connection",
      objectId: PRIMARY_CONNECTION_ID,
      afterSummary: { provider: input.provider, authType: input.credentials.kind, status: "connected" },
      correlationId: PRIMARY_CONNECTION_ID
    });
  });
}

function smtpTransport(provider: SmtpPersonalEmailProvider, email: string, appPassword: string) {
  const server = SMTP_PROVIDERS[provider];
  return nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: true,
    auth: { user: email, pass: appPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

export async function connectHostedSmtpSender(input: {
  provider: string;
  email: string;
  appPassword: string;
  setupToken: string;
}) {
  requireHostedEmailSetupToken(input.setupToken);
  const provider = assertProvider(input.provider);
  if (!isSmtpProvider(provider)) {
    throw repositoryError("hosted_email_smtp_provider_invalid", "该邮箱需要使用 OAuth 授权。", 400);
  }
  const senderEmail = assertEmail(input.email);
  const appPassword = input.appPassword.trim();
  if (appPassword.length < 6 || appPassword.length > 256) {
    throw repositoryError("hosted_email_app_password_invalid", "请输入邮箱后台生成的 SMTP 授权码。", 400);
  }
  try {
    await smtpTransport(provider, senderEmail, appPassword).verify();
  } catch {
    throw repositoryError(
      "hosted_email_smtp_verification_failed",
      "邮箱服务器未接受本次授权。",
      422,
      "确认已在邮箱后台开启 SMTP，并使用授权码而不是登录密码。"
    );
  }
  await saveConnection({
    provider,
    senderEmail,
    credentials: { kind: "smtp_app_password", appPassword },
    auditReason: "部署管理员通过 SMTP 授权码连接个人发件邮箱"
  });
  return readHostedEmailSenderStatus();
}

export async function beginHostedEmailOAuth(input: { provider: string; setupToken: string }) {
  requireHostedEmailSetupToken(input.setupToken);
  const provider = assertProvider(input.provider);
  if (provider !== "gmail" && provider !== "outlook") {
    throw repositoryError("hosted_email_oauth_provider_invalid", "该邮箱需要使用 SMTP 授权码。", 400);
  }
  const config = oauthConfig(provider);
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  await getV5GovernancePool().query(
    `INSERT INTO hosted_email_oauth_state
     (state_hash, provider, encrypted_code_verifier, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE))`,
    [hash(state), provider, encryptJson({ verifier }), OAUTH_STATE_TTL_MINUTES]
  );
  const authorizationUrl = provider === "gmail"
    ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
    : new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  const scopes = provider === "gmail"
    ? ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
    : ["openid", "email", "offline_access", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/User.Read"];
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(provider === "gmail" ? { access_type: "offline", prompt: "consent" } : { prompt: "select_account" })
  }).toString();
  return { authorizationUrl: authorizationUrl.toString() };
}

async function consumeOAuthState(provider: "gmail" | "outlook", state: string) {
  return withV5GovernanceTransaction(async (connection) => {
    const stateHash = hash(state);
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM hosted_email_oauth_state
       WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL AND expires_at > NOW(3)
       LIMIT 1 FOR UPDATE`,
      [stateHash, provider]
    );
    if (!rows[0]) throw repositoryError("hosted_email_oauth_state_invalid", "邮箱授权请求无效或已过期。", 400);
    await connection.query("UPDATE hosted_email_oauth_state SET consumed_at = NOW(3) WHERE state_hash = ?", [stateHash]);
    return decryptJson<{ verifier: string }>(String(rows[0].encrypted_code_verifier)).verifier;
  });
}

async function exchangeOAuthCode(provider: "gmail" | "outlook", code: string, verifier: string) {
  const config = oauthConfig(provider);
  const tokenEndpoint = provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
    throw repositoryError("hosted_email_oauth_exchange_failed", "邮箱授权未能完成。", 422, "返回设置页后重新发起授权。" );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scopes: String(payload.scope || "").split(/\s+/).filter(Boolean)
  };
}

async function resolveOAuthEmail(provider: "gmail" | "outlook", accessToken: string) {
  const endpoint = provider === "gmail"
    ? "https://openidconnect.googleapis.com/v1/userinfo"
    : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const email = provider === "gmail" ? payload.email : payload.mail || payload.userPrincipalName;
  const verified = provider !== "gmail" || payload.email_verified === true;
  if (!response.ok || typeof email !== "string" || !verified) {
    throw repositoryError("hosted_email_oauth_profile_failed", "无法确认授权邮箱身份。", 422);
  }
  return assertEmail(email);
}

export async function completeHostedEmailOAuth(input: { provider: string; state: string; code: string }) {
  const provider = assertProvider(input.provider);
  if (provider !== "gmail" && provider !== "outlook") {
    throw repositoryError("hosted_email_oauth_provider_invalid", "邮箱授权供应商无效。", 400);
  }
  if (!input.state || !input.code) throw repositoryError("hosted_email_oauth_callback_invalid", "邮箱授权回调缺少必要参数。", 400);
  const verifier = await consumeOAuthState(provider, input.state);
  const tokens = await exchangeOAuthCode(provider, input.code, verifier);
  const senderEmail = await resolveOAuthEmail(provider, tokens.accessToken);
  await saveConnection({
    provider,
    senderEmail,
    credentials: { kind: "oauth_refresh_token", refreshToken: tokens.refreshToken },
    scopes: tokens.scopes,
    auditReason: "部署管理员通过供应商 OAuth 连接个人发件邮箱"
  });
  return { provider, senderEmail };
}

async function refreshAccessToken(provider: "gmail" | "outlook", refreshToken: string) {
  const config = oauthConfig(provider);
  const endpoint = provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  const body: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  };
  if (provider === "outlook") body.scope = "openid email offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw repositoryError("hosted_email_oauth_refresh_failed", "发件邮箱授权已失效。", 503, "重新授权发件邮箱。" );
  }
  if (typeof payload.refresh_token === "string" && payload.refresh_token !== refreshToken) {
    await getV5GovernancePool().query(
      `UPDATE hosted_email_sender_connection
       SET encrypted_credentials = ?, row_version = row_version + 1
       WHERE id = ? AND provider = ? AND status = 'connected'`,
      [encryptJson({ kind: "oauth_refresh_token", refreshToken: payload.refresh_token }), PRIMARY_CONNECTION_ID, provider]
    );
  }
  return payload.access_token;
}

function messageHeaders(input: { idempotencyKey: string }) {
  return { "X-JOTO-Idempotency-Key": input.idempotencyKey };
}

async function sendWithGmailApi(connection: SenderConnection, credentials: Extract<StoredCredentials, { kind: "oauth_refresh_token" }>, input: HostedEmailDelivery) {
  const accessToken = await refreshAccessToken("gmail", credentials.refreshToken);
  const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const compiled = await compiler.sendMail({
    from: connection.senderEmail,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: messageHeaders(input),
    disableFileAccess: true,
    disableUrlAccess: true
  });
  const raw = Buffer.isBuffer(compiled.message) ? compiled.message : Buffer.from(String(compiled.message));
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: raw.toString("base64url") })
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw repositoryError("hosted_email_delivery_failed", "Gmail 拒绝了投递请求。", 502);
  return String(payload.id || randomUUID());
}

async function sendWithMicrosoftGraph(connection: SenderConnection, credentials: Extract<StoredCredentials, { kind: "oauth_refresh_token" }>, input: HostedEmailDelivery) {
  const accessToken = await refreshAccessToken("outlook", credentials.refreshToken);
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: [{ emailAddress: { address: input.to } }],
        internetMessageHeaders: [{ name: "x-joto-idempotency-key", value: input.idempotencyKey }]
      },
      saveToSentItems: true
    })
  });
  if (!response.ok) throw repositoryError("hosted_email_delivery_failed", "Outlook 拒绝了投递请求。", 502);
  return `outlook-accepted-${input.idempotencyKey}`;
}

export interface HostedEmailDelivery {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export async function deliverWithPersonalEmailSender(input: HostedEmailDelivery) {
  const connection = await readConnection();
  if (!connection || connection.status !== "connected") {
    throw repositoryError("hosted_email_provider_missing", "发件邮箱尚未授权。", 503, "使用 QQ、163、阿里云企业邮箱、Gmail 或 Outlook 完成授权。" );
  }
  const credentials = decryptJson<StoredCredentials>(connection.encryptedCredentials);
  if (isSmtpProvider(connection.provider) && credentials.kind === "smtp_app_password") {
    const info = await smtpTransport(connection.provider, connection.senderEmail, credentials.appPassword).sendMail({
      from: connection.senderEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: messageHeaders(input),
      disableFileAccess: true,
      disableUrlAccess: true
    });
    return String(info.messageId || `smtp-accepted-${input.idempotencyKey}`);
  }
  if (connection.provider === "gmail" && credentials.kind === "oauth_refresh_token") {
    return sendWithGmailApi(connection, credentials, input);
  }
  if (connection.provider === "outlook" && credentials.kind === "oauth_refresh_token") {
    return sendWithMicrosoftGraph(connection, credentials, input);
  }
  throw repositoryError("hosted_email_credentials_mismatch", "发件邮箱授权类型不匹配。", 503, "重新授权发件邮箱。" );
}

export async function hasPersonalEmailSender() {
  const connection = await readConnection();
  return Boolean(connection && connection.status === "connected");
}
