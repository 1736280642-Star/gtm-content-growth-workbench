import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isDemoMode } from "../demo/config";
import { demoOrderChannelConnections } from "../demo/fixtures/hosted";
import type { DirectPublishPlatformKey } from "../types";
import type { HostedIdentityContext } from "./hosted-identity-service";
import { assertWorkspaceOrderAccess, requireHostedRole } from "./hosted-identity-service";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  readV5Idempotency,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5Idempotency,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";

export const managedPublishChannels = ["zhihu", "csdn", "juejin"] as const;
export type ManagedPublishChannel = typeof managedPublishChannels[number];
export type PublishExecutorType = "cloud_browser" | "desktop_connector" | "official_oauth";
export type ChannelAuthorizationStatus =
  | "created"
  | "queued"
  | "waiting_for_user"
  | "manual_takeover_required"
  | "account_detected"
  | "confirmed"
  | "failed"
  | "expired"
  | "cancelled";

export interface DetectedPublishAccount {
  providerAccountRef: string;
  publicDisplayName: string;
  publicAvatarUrl?: string;
  publicProfileUrl?: string;
  accountFingerprint: string;
  capabilities: string[];
}

export interface ChannelAuthorizationSessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  orderId: string;
  productId: string;
  channel: ManagedPublishChannel;
  executorType: PublishExecutorType;
  connectorDeviceId?: string;
  browserProfileRef: string;
  status: ChannelAuthorizationStatus;
  detectedAccount?: DetectedPublishAccount;
  accountConnectionId?: string;
  failureCode?: string;
  failureMessage?: string;
  expiresAt: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapSession(row: RowDataPacket): ChannelAuthorizationSessionRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), userId: String(row.user_id),
    orderId: String(row.order_id), productId: String(row.product_id), channel: String(row.channel) as ManagedPublishChannel,
    executorType: String(row.executor_type) as PublishExecutorType,
    connectorDeviceId: row.connector_device_id ? String(row.connector_device_id) : undefined,
    browserProfileRef: String(row.browser_profile_ref), status: String(row.status) as ChannelAuthorizationStatus,
    detectedAccount: row.detected_account_json ? parseV5Json<DetectedPublishAccount | undefined>(row.detected_account_json, undefined) : undefined,
    accountConnectionId: row.account_connection_id ? String(row.account_connection_id) : undefined,
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    expiresAt: iso(row.expires_at), rowVersion: Number(row.row_version || 1),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function normalizeChannel(channel: string): ManagedPublishChannel {
  if (!managedPublishChannels.includes(channel as ManagedPublishChannel)) {
    throw new V5GovernanceRepositoryError("publish_channel_unsupported", "该渠道不支持浏览器托管授权。", 422);
  }
  return channel as ManagedPublishChannel;
}

function normalizeExecutorType(value?: string): PublishExecutorType {
  const selected = value || process.env.PUBLISH_DEFAULT_EXECUTOR_TYPE || "cloud_browser";
  if (!["cloud_browser", "desktop_connector", "official_oauth"].includes(selected)) {
    throw new V5GovernanceRepositoryError("publish_executor_invalid", "账号连接执行模式无效。", 422);
  }
  return selected as PublishExecutorType;
}

function normalizePublicUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeDetectedPublishAccount(channel: ManagedPublishChannel, input: unknown): DetectedPublishAccount {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const providerAccountRef = String(record.providerAccountRef || "").trim().slice(0, 191);
  const publicDisplayName = String(record.publicDisplayName || "").trim().slice(0, 160);
  if (!providerAccountRef || !publicDisplayName) {
    throw new V5GovernanceRepositoryError("publish_account_identity_incomplete", "未能识别平台公开账号名称或标识。", 409, "在平台创作中心确认登录账号后重试。");
  }
  const capabilities = Array.from(new Set(
    (Array.isArray(record.capabilities) ? record.capabilities : [])
      .map((item) => String(item).trim())
      .filter((item) => /^[a-z0-9_:-]{2,64}$/i.test(item))
  )).slice(0, 20);
  return {
    providerAccountRef,
    publicDisplayName,
    publicAvatarUrl: normalizePublicUrl(record.publicAvatarUrl),
    publicProfileUrl: normalizePublicUrl(record.publicProfileUrl),
    accountFingerprint: createHash("sha256").update(`${channel}:${providerAccountRef}`, "utf8").digest("hex"),
    capabilities
  };
}

async function appendAuthorizationEvent(connection: import("mysql2/promise").PoolConnection, input: {
  sessionId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(sequence_no), 0) AS sequence_no FROM channel_authorization_event WHERE authorization_session_id = ? FOR UPDATE",
    [input.sessionId]
  );
  const sequence = Number(rows[0]?.sequence_no || 0) + 1;
  await connection.query(
    `INSERT INTO channel_authorization_event
     (authorization_session_id, sequence_no, event_type, public_payload_json)
     VALUES (?, ?, ?, ?)`,
    [input.sessionId, sequence, input.eventType, stringifyV5Json(input.payload || {})]
  );
  return sequence;
}

async function selectExecutorNode(connection: import("mysql2/promise").PoolConnection, input: {
  workspaceId: string;
  executorType: PublishExecutorType;
  channel: ManagedPublishChannel;
  connectorDeviceId?: string;
}) {
  if (input.executorType === "official_oauth") return undefined;
  if (input.executorType === "desktop_connector" && input.connectorDeviceId) {
    const [devices] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM browser_executor_node
       WHERE id = ? AND executor_type = 'desktop_connector' AND workspace_id = ?
         AND status = 'online' AND revoked_at IS NULL AND last_heartbeat_at > DATE_SUB(NOW(), INTERVAL 90 SECOND)
       LIMIT 1`,
      [input.connectorDeviceId, input.workspaceId]
    );
    if (!devices[0]) throw new V5GovernanceRepositoryError("desktop_connector_offline", "指定的 Desktop Connector 不在线或不属于当前工作区。", 409);
    return String(devices[0].id);
  }
  const [nodes] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM browser_executor_node
     WHERE executor_type = ? AND status = 'online' AND revoked_at IS NULL
       AND active_lease_count < capacity
       AND (workspace_id IS NULL OR workspace_id = ?)
       AND JSON_CONTAINS(supported_channels_json, JSON_QUOTE(?))
       AND last_heartbeat_at > DATE_SUB(NOW(), INTERVAL 90 SECOND)
     ORDER BY workspace_id IS NOT NULL DESC, active_lease_count / capacity, last_heartbeat_at DESC
     LIMIT 1 FOR UPDATE`,
    [input.executorType, input.workspaceId, input.channel]
  );
  return nodes[0]?.id ? String(nodes[0].id) : undefined;
}

export async function createChannelAuthorizationSession(input: {
  identity: HostedIdentityContext;
  orderId: string;
  channel: string;
  executorType?: string;
  connectorDeviceId?: string;
}) {
  requireHostedRole(input.identity, ["workspace_admin", "product_owner", "operator"]);
  await assertWorkspaceOrderAccess(input.identity.workspaceId, input.orderId);
  const channel = normalizeChannel(input.channel);
  const executorType = normalizeExecutorType(input.executorType);
  const nonce = randomBytes(24).toString("base64url");
  const sessionId = `channel-auth-${randomUUID()}`;
  const browserProfileRef = `publish-profile-${randomUUID()}`;
  const created = await withV5GovernanceTransaction(async (connection) => {
    const [orders] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM hosted_promotion_order WHERE id = ? AND workspace_id = ? LIMIT 1 FOR UPDATE",
      [input.orderId, input.identity.workspaceId]
    );
    const order = orders[0];
    if (!order) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
    const preferences = parseV5Json<Array<{ channel: string }>>(order.channel_preferences_json, []);
    if (!preferences.some((item) => item.channel === channel)) {
      throw new V5GovernanceRepositoryError("hosted_channel_not_selected", "该渠道未包含在当前托管任务中。", 409);
    }
    const executorNodeId = await selectExecutorNode(connection, {
      workspaceId: input.identity.workspaceId,
      executorType,
      channel,
      connectorDeviceId: input.connectorDeviceId
    });
    if (executorType === "official_oauth") {
      throw new V5GovernanceRepositoryError("official_oauth_unavailable", "该渠道当前未提供官方 OAuth，请选择云端浏览器或 Desktop Connector。", 409);
    }
    const status: ChannelAuthorizationStatus = executorNodeId ? "queued" : "created";
    await connection.query(
      `INSERT INTO channel_authorization_session
       (id, workspace_id, user_id, order_id, product_id, channel, executor_type,
        connector_device_id, browser_profile_ref, status, nonce_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [sessionId, input.identity.workspaceId, input.identity.userId, input.orderId, String(order.product_id), channel,
        executorType, input.connectorDeviceId || null, browserProfileRef, status,
        createHash("sha256").update(nonce, "utf8").digest("hex")]
    );
    await appendAuthorizationEvent(connection, { sessionId, eventType: "session_created", payload: { channel, executorType, status } });
    await connection.query(
      `INSERT INTO browser_execution_job
         (id, workspace_id, authorization_session_id, executor_node_id, operation, channel,
          status, command_json, attempt_count, idempotency_key)
         VALUES (?, ?, ?, ?, 'authorize', ?, 'queued', ?, 0, ?)`,
      [`browser-job-${randomUUID()}`, input.identity.workspaceId, sessionId, executorNodeId || null, channel,
        stringifyV5Json({ authorizationSessionId: sessionId, channel, browserProfileRef }),
        `authorize:${sessionId}`]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: input.identity.userId,
      actorRole: input.identity.role,
      actorType: "human",
      auditReason: "用户为托管渠道创建一次性账号授权会话",
      eventType: "channel_authorization_session_created",
      objectType: "channel_authorization_session",
      objectId: sessionId,
      afterSummary: { workspaceId: input.identity.workspaceId, orderId: input.orderId, channel, executorType, status },
      correlationId: input.orderId
    });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM channel_authorization_session WHERE id = ?", [sessionId]);
    return { session: mapSession(rows[0]), executorNodeAvailable: Boolean(executorNodeId) };
  });
  const launchUrl = executorType === "cloud_browser"
      ? `/hosted/browser-session/${encodeURIComponent(sessionId)}`
      : undefined;
  return { ...created, launchUrl };
}

export async function readChannelAuthorizationSession(identity: HostedIdentityContext, sessionId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM channel_authorization_session
     WHERE id = ? AND workspace_id = ? LIMIT 1`,
    [sessionId, identity.workspaceId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("channel_authorization_not_found", "账号授权会话不存在。", 404);
  const session = mapSession(rows[0]);
  if (new Date(session.expiresAt).getTime() <= Date.now() && !["confirmed", "failed", "cancelled", "expired"].includes(session.status)) {
    await getV5GovernancePool().query(
      "UPDATE channel_authorization_session SET status = 'expired', row_version = row_version + 1 WHERE id = ? AND status NOT IN ('confirmed','failed','cancelled','expired')",
      [sessionId]
    );
    session.status = "expired";
  }
  return session;
}

export async function listChannelAuthorizationEvents(identity: HostedIdentityContext, sessionId: string, afterSequence = 0) {
  await readChannelAuthorizationSession(identity, sessionId);
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT sequence_no, event_type, public_payload_json, created_at
     FROM channel_authorization_event
     WHERE authorization_session_id = ? AND sequence_no > ?
     ORDER BY sequence_no LIMIT 100`,
    [sessionId, Math.max(0, afterSequence)]
  );
  return rows.map((row) => ({
    sequence: Number(row.sequence_no),
    eventType: String(row.event_type),
    payload: parseV5Json<Record<string, unknown>>(row.public_payload_json, {}),
    createdAt: iso(row.created_at)
  }));
}

export async function recordExecutorAuthorizationEvent(input: {
  sessionId: string;
  eventType: "window_opened" | "waiting_for_login" | "manual_takeover_required" | "account_detected" | "permission_checked" | "failed";
  payload?: Record<string, unknown>;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM channel_authorization_session WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.sessionId]
    );
    if (!rows[0]) throw new V5GovernanceRepositoryError("channel_authorization_not_found", "账号授权会话不存在。", 404);
    const session = mapSession(rows[0]);
    if (new Date(session.expiresAt).getTime() <= Date.now()) throw new V5GovernanceRepositoryError("channel_authorization_expired", "账号授权会话已过期。", 410);
    if (["confirmed", "cancelled", "expired"].includes(session.status)) {
      throw new V5GovernanceRepositoryError("channel_authorization_terminal", "账号授权会话已经结束。", 409);
    }
    let status: ChannelAuthorizationStatus = session.status;
    let detectedAccount: DetectedPublishAccount | undefined;
    if (input.eventType === "window_opened" || input.eventType === "waiting_for_login") status = "waiting_for_user";
    if (input.eventType === "manual_takeover_required") status = "manual_takeover_required";
    if (input.eventType === "account_detected") {
      detectedAccount = normalizeDetectedPublishAccount(session.channel, input.payload?.account);
      status = "account_detected";
    }
    if (input.eventType === "failed") status = "failed";
    await connection.query(
      `UPDATE channel_authorization_session
       SET status = ?, detected_account_json = COALESCE(?, detected_account_json),
           failure_code = ?, failure_message = ?, row_version = row_version + 1
       WHERE id = ?`,
      [status, detectedAccount ? stringifyV5Json(detectedAccount) : null,
        input.eventType === "failed" ? String(input.payload?.failureCode || "executor_failed").slice(0, 96) : null,
        input.eventType === "failed" ? String(input.payload?.message || "账号授权执行失败").slice(0, 500) : null,
        input.sessionId]
    );
    await appendAuthorizationEvent(connection, {
      sessionId: input.sessionId,
      eventType: input.eventType,
      payload: detectedAccount ? { account: detectedAccount } : input.payload
    });
    const [updated] = await connection.query<RowDataPacket[]>("SELECT * FROM channel_authorization_session WHERE id = ?", [input.sessionId]);
    return mapSession(updated[0]);
  });
}

export async function confirmDetectedPublishAccount(input: {
  identity: HostedIdentityContext;
  sessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  requireHostedRole(input.identity, ["workspace_admin", "product_owner"]);
  return withV5GovernanceTransaction(async (connection) => {
    const requestHash = hashV5GovernancePayload({
      workspaceId: input.identity.workspaceId,
      userId: input.identity.userId,
      sessionId: input.sessionId,
      expectedVersion: input.expectedVersion
    });
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return replay.responseSummary as { session: ChannelAuthorizationSessionRecord; connectionId: string; replayed: boolean };
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM channel_authorization_session
       WHERE id = ? AND workspace_id = ? LIMIT 1 FOR UPDATE`,
      [input.sessionId, input.identity.workspaceId]
    );
    if (!rows[0]) throw new V5GovernanceRepositoryError("channel_authorization_not_found", "账号授权会话不存在。", 404);
    const session = mapSession(rows[0]);
    if (session.status === "confirmed" && session.accountConnectionId) return { session, replayed: true };
    if (session.status !== "account_detected" || !session.detectedAccount) {
      throw new V5GovernanceRepositoryError("publish_account_not_detected", "尚未检测到可确认的平台账号。", 409);
    }
    if (session.rowVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError("channel_authorization_version_conflict", "账号授权状态已经变化，请刷新后重试。", 409);
    }
    const account = session.detectedAccount;
    const [existingConnections] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM publish_account_connection
       WHERE workspace_id = ? AND channel = ? AND account_fingerprint = ? AND revoked_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [input.identity.workspaceId, session.channel, account.accountFingerprint]
    );
    const connectionId = existingConnections[0]?.id ? String(existingConnections[0].id) : `publish-connection-${randomUUID()}`;
    if (existingConnections[0]) {
      await connection.query(
        `UPDATE publish_account_connection
         SET public_display_name = ?, public_avatar_url = ?, public_profile_url = ?,
             executor_type = ?, connector_device_id = ?, browser_profile_ref = ?,
             authorization_status = 'connected', capability_status = 'verified', capabilities_json = ?,
             last_verified_at = NOW(), last_error_code = NULL, last_error_message = NULL,
             row_version = row_version + 1
         WHERE id = ?`,
        [account.publicDisplayName, account.publicAvatarUrl || null, account.publicProfileUrl || null,
          session.executorType, session.connectorDeviceId || null, session.browserProfileRef,
          stringifyV5Json(account.capabilities), connectionId]
      );
    } else {
      await connection.query(
        `INSERT INTO publish_account_connection
         (id, workspace_id, owner_user_id, channel, provider_account_ref, public_display_name,
          public_avatar_url, public_profile_url, account_fingerprint, executor_type,
          connector_device_id, browser_profile_ref, authorization_status, capability_status,
          capabilities_json, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', 'verified', ?, NOW())`,
        [connectionId, input.identity.workspaceId, input.identity.userId, session.channel,
          account.providerAccountRef, account.publicDisplayName, account.publicAvatarUrl || null,
          account.publicProfileUrl || null, account.accountFingerprint, session.executorType,
          session.connectorDeviceId || null, session.browserProfileRef, stringifyV5Json(account.capabilities)]
      );
    }
    const platform = session.channel as DirectPublishPlatformKey;
    const legacyChannel = session.channel === "zhihu" ? "zhihu_toutiao_general" : session.channel;
    const [bindings] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM product_publish_account_binding WHERE workspace_id = ? AND product_id = ? AND platform = ? LIMIT 1 FOR UPDATE",
      [input.identity.workspaceId, session.productId, platform]
    );
    const currentVersion = Number(bindings[0]?.row_version || 0);
    if (bindings[0]) {
      await connection.query(
        `UPDATE product_publish_account_binding
         SET workspace_id = ?, channel = ?, account_connection_id = ?, account_label = ?,
             account_fingerprint = ?, status = 'confirmed', confirmed_by = ?, confirmed_at = NOW(),
             row_version = row_version + 1
         WHERE id = ?`,
        [input.identity.workspaceId, legacyChannel, connectionId, account.publicDisplayName,
          account.accountFingerprint, input.identity.userId, String(bindings[0].id)]
      );
    } else {
      await connection.query(
        `INSERT INTO product_publish_account_binding
         (id, workspace_id, product_id, platform, channel, account_connection_id, account_label,
          account_fingerprint, status, confirmed_by, confirmed_at, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, NOW(), 1)`,
        [`product-account-${randomUUID()}`, input.identity.workspaceId, session.productId, platform,
          legacyChannel, connectionId, account.publicDisplayName, account.accountFingerprint, input.identity.userId]
      );
    }
    await connection.query(
      `UPDATE channel_authorization_session
       SET status = 'confirmed', account_connection_id = ?, completed_at = NOW(), row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [connectionId, session.id, input.expectedVersion]
    );
    await appendAuthorizationEvent(connection, {
      sessionId: session.id,
      eventType: "connected",
      payload: { accountConnectionId: connectionId, publicDisplayName: account.publicDisplayName }
    });
    await writeV5GovernanceAudit(connection, {
      actorId: input.identity.userId,
      actorRole: input.identity.role,
      actorType: "human",
      auditReason: "用户确认真实平台账号用于当前产品托管发布",
      eventType: "publish_account_connection_confirmed",
      objectType: "publish_account_connection",
      objectId: connectionId,
      beforeSummary: bindings[0] ? { previousConnectionId: bindings[0].account_connection_id || null, rowVersion: currentVersion } : undefined,
      afterSummary: { workspaceId: input.identity.workspaceId, productId: session.productId, channel: session.channel, publicDisplayName: account.publicDisplayName },
      correlationId: session.orderId
    });
    const [updated] = await connection.query<RowDataPacket[]>("SELECT * FROM channel_authorization_session WHERE id = ?", [session.id]);
    const response = { session: mapSession(updated[0]), connectionId, replayed: false };
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "confirm_publish_account_connection",
      requestHash,
      resourceType: "publish_account_connection",
      resourceId: connectionId,
      responseStatus: "confirmed",
      responseSummary: response
    });
    return response;
  });
}

export async function listOrderChannelConnections(identity: HostedIdentityContext, orderId: string) {
  if (isDemoMode()) return demoOrderChannelConnections();
  await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
  const [orders] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT product_id, channel_preferences_json FROM hosted_promotion_order WHERE id = ? AND workspace_id = ? LIMIT 1",
    [orderId, identity.workspaceId]
  );
  const order = orders[0];
  if (!order) throw new V5GovernanceRepositoryError("hosted_order_not_found", "托管任务不存在。", 404);
  const preferences = parseV5Json<Array<{ channel: string }>>(order.channel_preferences_json, []);
  const [sessions] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT session.* FROM channel_authorization_session session
     WHERE session.workspace_id = ? AND session.order_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM channel_authorization_session newer
         WHERE newer.workspace_id = session.workspace_id AND newer.order_id = session.order_id
           AND newer.channel = session.channel
           AND (newer.created_at > session.created_at OR (newer.created_at = session.created_at AND newer.id > session.id))
       )`,
    [identity.workspaceId, orderId]
  );
  const sessionByChannel = new Map(sessions.map((row) => [String(row.channel), mapSession(row)]));
  const [bindings] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT binding.platform, binding.account_connection_id, connection.public_display_name,
            connection.public_avatar_url, connection.authorization_status, connection.executor_type
     FROM product_publish_account_binding binding
     JOIN publish_account_connection connection ON connection.id = binding.account_connection_id
     WHERE binding.workspace_id = ? AND binding.product_id = ? AND binding.status = 'confirmed'
       AND connection.revoked_at IS NULL`,
    [identity.workspaceId, String(order.product_id)]
  );
  const bindingByChannel = new Map(bindings.map((row) => [String(row.platform), {
    accountConnectionId: String(row.account_connection_id),
    publicDisplayName: String(row.public_display_name),
    publicAvatarUrl: row.public_avatar_url ? String(row.public_avatar_url) : undefined,
    authorizationStatus: String(row.authorization_status),
    executorType: String(row.executor_type)
  }]));
  return preferences
    .filter((item) => managedPublishChannels.includes(item.channel as ManagedPublishChannel))
    .map((item) => ({ channel: item.channel, session: sessionByChannel.get(item.channel), connection: bindingByChannel.get(item.channel) }));
}
