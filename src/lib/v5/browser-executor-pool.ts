import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { HostedIdentityContext } from "./hosted-identity-service";
import { requireHostedRole } from "./hosted-identity-service";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction
} from "./knowledge-governance-repository";

type ExecutorType = "cloud_browser" | "desktop_connector";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function token() {
  return randomBytes(32).toString("base64url");
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createDesktopExecutorPairingCode(identity: HostedIdentityContext, displayName: string) {
  requireHostedRole(identity, ["workspace_admin", "product_owner"]);
  const value = randomBytes(18).toString("base64url");
  await getV5GovernancePool().query(
    `INSERT INTO browser_executor_pairing_code
     (code_hash, workspace_id, user_id, display_name, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [sha256(value), identity.workspaceId, identity.userId, displayName.trim().slice(0, 160) || "Desktop Connector"]
  );
  return { pairingCode: value, expiresInSeconds: 600 };
}

export async function listWorkspaceBrowserExecutors(identity: HostedIdentityContext) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id, executor_type, display_name, status, supported_channels_json, capacity,
            active_lease_count, adapter_version, last_heartbeat_at
     FROM browser_executor_node
     WHERE revoked_at IS NULL AND (workspace_id = ? OR executor_type = 'cloud_browser')
     ORDER BY executor_type, last_heartbeat_at DESC`,
    [identity.workspaceId]
  );
  return rows.map((row) => ({
    nodeId: String(row.id),
    executorType: String(row.executor_type) as ExecutorType,
    displayName: String(row.display_name),
    status: String(row.status) === "online" && row.last_heartbeat_at
      && Date.now() - new Date(String(row.last_heartbeat_at)).getTime() < 90_000 ? "online" : "offline",
    supportedChannels: parseV5Json<string[]>(row.supported_channels_json, []),
    capacity: Number(row.capacity || 1),
    activeLeaseCount: Number(row.active_lease_count || 0),
    adapterVersion: row.adapter_version ? String(row.adapter_version) : undefined,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(String(row.last_heartbeat_at)).toISOString() : undefined
  }));
}

export async function registerBrowserExecutor(input: {
  executorType: ExecutorType;
  displayName: string;
  supportedChannels: string[];
  capacity: number;
  pairingCode?: string;
  registrationSecret?: string;
}) {
  const supportedChannels = Array.from(new Set(input.supportedChannels.filter((item) => ["zhihu", "csdn", "juejin"].includes(item))));
  if (!supportedChannels.length) throw new V5GovernanceRepositoryError("executor_channels_required", "执行节点至少支持一个发布渠道。", 422);
  const capacity = Math.max(1, Math.min(20, Math.floor(input.capacity || 1)));
  const nodeToken = token();
  const result = await withV5GovernanceTransaction(async (connection) => {
    let workspaceId: string | undefined;
    let ownerUserId: string | undefined;
    let displayName = input.displayName.trim().slice(0, 160) || "Browser Executor";
    if (input.executorType === "desktop_connector") {
      const [codes] = await connection.query<RowDataPacket[]>(
        `SELECT * FROM browser_executor_pairing_code
         WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
        [sha256(input.pairingCode || "")]
      );
      if (!codes[0]) throw new V5GovernanceRepositoryError("executor_pairing_invalid", "Connector 配对码无效、已使用或已过期。", 403);
      workspaceId = String(codes[0].workspace_id);
      ownerUserId = String(codes[0].user_id);
      displayName = String(codes[0].display_name);
      await connection.query("UPDATE browser_executor_pairing_code SET used_at = NOW() WHERE code_hash = ?", [sha256(input.pairingCode || "")]);
    } else {
      const configured = process.env.PUBLISH_EXECUTOR_REGISTRATION_SECRET?.trim() || "";
      if (!configured || !input.registrationSecret || !secureEqual(configured, input.registrationSecret)) {
        throw new V5GovernanceRepositoryError("executor_registration_denied", "云端执行节点注册凭据无效。", 401);
      }
    }
    const nodeId = `browser-executor-${randomUUID()}`;
    await connection.query(
      `INSERT INTO browser_executor_node
       (id, executor_type, workspace_id, owner_user_id, display_name, auth_token_hash,
        status, supported_channels_json, capacity, active_lease_count, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?, 0, NOW())`,
      [nodeId, input.executorType, workspaceId || null, ownerUserId || null, displayName,
        sha256(nodeToken), stringifyV5Json(supportedChannels), capacity]
    );
    return { nodeId, workspaceId, displayName };
  });
  return { ...result, nodeToken };
}

export interface BrowserExecutorIdentity {
  nodeId: string;
  executorType: ExecutorType;
  workspaceId?: string;
  supportedChannels: string[];
  capacity: number;
}

export async function requireBrowserExecutor(request: Request): Promise<BrowserExecutorIdentity> {
  const authorization = request.headers.get("authorization") || "";
  const rawToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!rawToken) throw new V5GovernanceRepositoryError("publish_executor_unauthorized", "执行节点身份缺失。", 401);
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM browser_executor_node
     WHERE auth_token_hash = ? AND revoked_at IS NULL LIMIT 1`,
    [sha256(rawToken)]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("publish_executor_unauthorized", "执行节点身份无效。", 401);
  return {
    nodeId: String(rows[0].id), executorType: String(rows[0].executor_type) as ExecutorType,
    workspaceId: rows[0].workspace_id ? String(rows[0].workspace_id) : undefined,
    supportedChannels: parseV5Json<string[]>(rows[0].supported_channels_json, []),
    capacity: Number(rows[0].capacity || 1)
  };
}

export async function heartbeatBrowserExecutor(identity: BrowserExecutorIdentity, input: {
  adapterVersion?: string;
  capacity?: number;
  supportedChannels?: string[];
}) {
  const capacity = Math.max(1, Math.min(20, Math.floor(input.capacity || identity.capacity)));
  const supportedChannels = Array.from(new Set((input.supportedChannels || identity.supportedChannels).filter((item) => ["zhihu", "csdn", "juejin"].includes(item))));
  await getV5GovernancePool().query(
    `UPDATE browser_executor_node SET status = 'online', last_heartbeat_at = ?, adapter_version = ?,
       capacity = ?, supported_channels_json = ? WHERE id = ?`,
    [new Date(), input.adapterVersion?.slice(0, 32) || null, capacity, stringifyV5Json(supportedChannels), identity.nodeId]
  );
  return { ok: true, nodeId: identity.nodeId, capacity, supportedChannels };
}

export async function claimBrowserExecutionJob(identity: BrowserExecutorIdentity) {
  const leaseToken = token();
  return withV5GovernanceTransaction(async (connection) => {
    const [expired] = await connection.query<RowDataPacket[]>(
      `SELECT id, executor_node_id FROM browser_execution_job
       WHERE status = 'leased' AND lease_expires_at < NOW() LIMIT 50 FOR UPDATE`
    );
    for (const job of expired) {
      await connection.query(
        `UPDATE browser_execution_job SET status = IF(attempt_count < 3, 'queued', 'failed'),
         executor_node_id = IF(attempt_count < 3, NULL, executor_node_id), lease_token_hash = NULL,
         lease_expires_at = NULL, failure_code = IF(attempt_count < 3, NULL, 'lease_attempts_exhausted'),
         failure_message = IF(attempt_count < 3, NULL, '执行节点连续三次未在租约内完成任务') WHERE id = ?`,
        [String(job.id)]
      );
      if (job.executor_node_id) {
        await connection.query(
          "UPDATE browser_executor_node SET active_lease_count = GREATEST(0, active_lease_count - 1) WHERE id = ?",
          [String(job.executor_node_id)]
        );
      }
    }
    const [nodes] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM browser_executor_node WHERE id = ? AND status = 'online' AND revoked_at IS NULL LIMIT 1 FOR UPDATE",
      [identity.nodeId]
    );
    const node = nodes[0];
    if (!node || Number(node.active_lease_count || 0) >= Number(node.capacity || 1)) return undefined;
    const workspaceCondition = identity.workspaceId ? "AND job.workspace_id = ?" : "";
    const placeholders = identity.supportedChannels.map(() => "?").join(",");
    const [jobs] = await connection.query<RowDataPacket[]>(
      `SELECT job.* FROM browser_execution_job job
       WHERE job.status = 'queued' AND (job.executor_node_id IS NULL OR job.executor_node_id = ?)
         AND job.channel IN (${placeholders}) ${workspaceCondition}
       ORDER BY job.created_at LIMIT 1 FOR UPDATE`,
      [identity.nodeId, ...identity.supportedChannels, ...(identity.workspaceId ? [identity.workspaceId] : [])]
    );
    const job = jobs[0];
    if (!job) return undefined;
    await connection.query(
      `UPDATE browser_execution_job SET status = 'leased', executor_node_id = ?, lease_token_hash = ?,
       lease_expires_at = DATE_ADD(NOW(), INTERVAL 20 MINUTE), attempt_count = attempt_count + 1 WHERE id = ?`,
      [identity.nodeId, sha256(leaseToken), String(job.id)]
    );
    await connection.query("UPDATE browser_executor_node SET active_lease_count = active_lease_count + 1 WHERE id = ?", [identity.nodeId]);
    return {
      jobId: String(job.id), leaseToken, operation: String(job.operation), channel: String(job.channel),
      command: parseV5Json<Record<string, unknown>>(job.command_json, {}),
      authorizationSessionId: job.authorization_session_id ? String(job.authorization_session_id) : undefined,
      accountConnectionId: job.account_connection_id ? String(job.account_connection_id) : undefined
    };
  });
}

export async function completeBrowserExecutionJob(identity: BrowserExecutorIdentity, input: {
  jobId: string;
  leaseToken: string;
  ok: boolean;
  result?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [jobs] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM browser_execution_job WHERE id = ? AND executor_node_id = ? LIMIT 1 FOR UPDATE",
      [input.jobId, identity.nodeId]
    );
    const job = jobs[0];
    if (!job || String(job.status) !== "leased" || String(job.lease_token_hash || "") !== sha256(input.leaseToken)) {
      throw new V5GovernanceRepositoryError("browser_execution_lease_invalid", "浏览器执行任务 Lease 无效或已结束。", 409);
    }
    await connection.query(
      `UPDATE browser_execution_job SET status = ?, result_json = ?, failure_code = ?, failure_message = ?,
       lease_token_hash = NULL, lease_expires_at = NULL WHERE id = ?`,
      [input.ok ? "completed" : "failed", stringifyV5Json(input.result || {}),
        input.ok ? null : String(input.failureCode || "executor_failed").slice(0, 96),
        input.ok ? null : String(input.failureMessage || "执行节点失败").slice(0, 500), input.jobId]
    );
    await connection.query(
      "UPDATE browser_executor_node SET active_lease_count = GREATEST(0, active_lease_count - 1), last_heartbeat_at = NOW() WHERE id = ?",
      [identity.nodeId]
    );
    return { jobId: input.jobId, status: input.ok ? "completed" : "failed" };
  });
}

export async function assertExecutorOwnsAuthorizationSession(identity: BrowserExecutorIdentity, sessionId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT job.id FROM browser_execution_job job
     WHERE job.authorization_session_id = ? AND job.executor_node_id = ?
       AND job.status IN ('leased','completed') LIMIT 1`,
    [sessionId, identity.nodeId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("publish_executor_session_denied", "执行节点不能更新该授权会话。", 403);
}

export async function executeGovernedBrowserOperation(input: {
  accountConnectionId: string;
  operation: "publish" | "verify";
  channel: string;
  idempotencyKey: string;
  command: Record<string, unknown>;
}) {
  const pool = getV5GovernancePool();
  const [connections] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM publish_account_connection
     WHERE id = ? AND channel = ? AND authorization_status = 'connected'
       AND capability_status = 'verified' AND revoked_at IS NULL LIMIT 1`,
    [input.accountConnectionId, input.channel]
  );
  const account = connections[0];
  if (!account) {
    throw new V5GovernanceRepositoryError("publish_account_connection_unavailable", "发布账号连接不存在、已失效或渠道不匹配。", 409);
  }
  const workspaceId = String(account.workspace_id);
  const executorType = String(account.executor_type) as ExecutorType;
  const [nodes] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM browser_executor_node
     WHERE executor_type = ? AND status = 'online' AND revoked_at IS NULL
       AND active_lease_count < capacity AND (workspace_id IS NULL OR workspace_id = ?)
       AND JSON_CONTAINS(supported_channels_json, JSON_QUOTE(?))
       AND last_heartbeat_at > DATE_SUB(NOW(), INTERVAL 90 SECOND)
     ORDER BY workspace_id IS NOT NULL DESC, active_lease_count / capacity, last_heartbeat_at DESC LIMIT 1`,
    [executorType, workspaceId, input.channel]
  );
  const nodeId = nodes[0]?.id ? String(nodes[0].id) : undefined;
  const jobId = `browser-job-${randomUUID()}`;
  await pool.query(
    `INSERT INTO browser_execution_job
     (id, workspace_id, account_connection_id, executor_node_id, operation, channel,
      status, command_json, attempt_count, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [jobId, workspaceId, input.accountConnectionId, nodeId || null, input.operation, input.channel,
      stringifyV5Json({ ...input.command, browserProfileRef: String(account.browser_profile_ref), accountFingerprint: String(account.account_fingerprint) }),
      `${input.operation}:${input.idempotencyKey}`.slice(0, 191)]
  );
  const timeoutMs = Math.max(10_000, Math.min(300_000, Number(process.env.PUBLISH_EXECUTOR_REQUEST_TIMEOUT_MS || 180_000)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [jobs] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM browser_execution_job WHERE workspace_id = ? AND idempotency_key = ? LIMIT 1`,
      [workspaceId, `${input.operation}:${input.idempotencyKey}`.slice(0, 191)]
    );
    const job = jobs[0];
    if (job && ["completed", "failed"].includes(String(job.status))) {
      const result = parseV5Json<Record<string, unknown>>(job.result_json, {});
      return { ok: String(job.status) === "completed", jobId: String(job.id), result,
        failureCode: job.failure_code ? String(job.failure_code) : undefined,
        failureMessage: job.failure_message ? String(job.failure_message) : undefined };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    ok: false,
    jobId,
    pending: true,
    failureCode: nodeId ? "executor_timeout" : "executor_unavailable",
    failureMessage: nodeId ? "浏览器执行任务仍在处理中。" : "当前没有可用的浏览器执行节点。"
  };
}
