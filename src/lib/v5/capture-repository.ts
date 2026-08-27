import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  AiFrontendConnection,
  AiFrontendConnectionStatus,
  AiFrontendExecutionScope,
  AiFrontendIsolationPolicy,
  AiFrontendPlatform,
  CaptureIsolationAttestation,
  CapturedAnswer,
  CapturedCitation,
  FrontendCaptureArtifact,
  FrontendCaptureCondition,
  FrontendCaptureTask,
  ObservationGap,
  ObservationGapCode,
  ObservationReview,
  ReviewObservationRequest
} from "./observation-contracts";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction
} from "./knowledge-governance-repository";

const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 10 * 60 * 1000;
const FORMAL_CAPTURE_PLATFORMS = new Set(["doubao", "deepseek", "qwen", "chatgpt"]);
const DEFAULT_CAPTURE_CONDITION: FrontendCaptureCondition = {
  locale: "zh-CN",
  region: "CN",
  conversationMode: "new_conversation",
  personalizationMode: "off",
  modelLabel: "platform-default"
};

export interface FormalCaptureEvidencePayload {
  contractVersion: "frontend-capture-evidence.v1";
  answerText: string;
  answerHtmlSanitized?: string;
  citations: Array<{
    label?: string;
    url: string;
    title?: string;
    visibleSnippet?: string;
    position?: number;
    capturedAt?: string;
    verificationStatus?: "verified" | "unverified";
    domainOwner?: string;
    sourceType?: "official" | "owned" | "third_party" | "unknown";
  }>;
  gaps: Array<{
    code: ObservationGapCode;
    title?: string;
    explanation: string;
    evidenceLocation?: string;
    confidence?: number;
    status?: "candidate" | "confirmed" | "rejected";
  }>;
  targetEntity?: string;
  targetEntityMentioned?: boolean;
  adapterVersion?: string;
  browserVersion?: string;
  isolationAttestation?: CaptureIsolationAttestation;
  manifest?: Record<string, unknown>;
}

function iso(value: unknown) {
  return value ? new Date(String(value)).toISOString() : undefined;
}

function mapDevice(row: RowDataPacket) {
  const revoked = Boolean(row.revoked_at);
  const lastHeartbeatAt = iso(row.last_heartbeat_at);
  const heartbeatFresh = lastHeartbeatAt
    ? Date.now() - new Date(lastHeartbeatAt).getTime() <= DEVICE_ONLINE_WINDOW_MS
    : false;
  return {
    deviceId: String(row.device_id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    executionScope: String(row.execution_scope || "user_private") as AiFrontendExecutionScope,
    status: revoked ? "revoked" : heartbeatFresh ? String(row.status || "online") : "offline",
    platforms: parseV5Json<string[]>(row.platforms, []),
    lastHeartbeatAt,
    adapterVersion: row.adapter_version ? String(row.adapter_version) : undefined,
    currentTaskId: row.current_task_id ? String(row.current_task_id) : undefined,
    lastSuccessfulCaptureAt: iso(row.last_successful_capture_at),
    pairedAt: iso(row.paired_at),
    revokedAt: iso(row.revoked_at)
  };
}

const DEFAULT_ISOLATION_POLICY_BY_PLATFORM: Record<AiFrontendPlatform, AiFrontendIsolationPolicy> = {
  chatgpt: { mode: "dedicated_account", benchmarkCohort: "neutral_benchmark", requiredChecks: ["new_conversation", "dedicated_account", "memory_off", "custom_instructions_off"] },
  doubao: { mode: "dedicated_account", benchmarkCohort: "neutral_benchmark", requiredChecks: ["new_conversation", "dedicated_account", "memory_off", "custom_instructions_off"] },
  deepseek: { mode: "dedicated_account", benchmarkCohort: "neutral_benchmark", requiredChecks: ["new_conversation", "dedicated_account", "memory_off", "custom_instructions_off"] },
  qwen: { mode: "dedicated_account", benchmarkCohort: "neutral_benchmark", requiredChecks: ["new_conversation", "dedicated_account", "memory_off", "custom_instructions_off"] }
};

function normalizeIsolationPolicy(platform: AiFrontendPlatform, value?: Partial<AiFrontendIsolationPolicy>): AiFrontendIsolationPolicy {
  const fallback = DEFAULT_ISOLATION_POLICY_BY_PLATFORM[platform];
  const requestedMode = ["dedicated_account", "dedicated_profile", "temporary_chat", "memory_off", "new_conversation_only"].includes(String(value?.mode))
    ? value!.mode as AiFrontendIsolationPolicy["mode"]
    : fallback.mode;
  const benchmarkCohort = value?.benchmarkCohort === "personalized_user_sample" ? "personalized_user_sample" : "neutral_benchmark";
  const legacyUnsafeProfile = benchmarkCohort === "neutral_benchmark" && requestedMode === "dedicated_profile";
  const mode = legacyUnsafeProfile ? "dedicated_account" : requestedMode;
  const allowedChecks = new Set(["new_conversation", "temporary_chat", "memory_off", "custom_instructions_off", "dedicated_account", "dedicated_profile"]);
  const requiredChecks = Array.from(new Set((legacyUnsafeProfile ? fallback.requiredChecks : value?.requiredChecks || fallback.requiredChecks).filter((item) => allowedChecks.has(item))));
  const accountHistoryAttestedAt = value?.accountHistoryAttestedAt && !Number.isNaN(Date.parse(value.accountHistoryAttestedAt))
    ? new Date(value.accountHistoryAttestedAt).toISOString()
    : undefined;
  const memorySettingsAttestedAt = value?.memorySettingsAttestedAt && !Number.isNaN(Date.parse(value.memorySettingsAttestedAt))
    ? new Date(value.memorySettingsAttestedAt).toISOString()
    : undefined;
  return { mode, benchmarkCohort, requiredChecks, accountHistoryAttestedAt, memorySettingsAttestedAt };
}

function mapAiFrontendConnection(row: RowDataPacket): AiFrontendConnection {
  const platform = String(row.platform) as AiFrontendPlatform;
  return {
    connectionId: String(row.connection_id), workspaceId: String(row.workspace_id), userId: String(row.user_id),
    executionScope: String(row.execution_scope || "user_private") as AiFrontendExecutionScope,
    deviceId: String(row.device_id), platform, accountAlias: String(row.account_alias),
    browserProfileSlot: String(row.browser_profile_slot || "default"),
    status: (row.revoked_at ? "revoked" : String(row.status || "offline")) as AiFrontendConnectionStatus,
    isolationPolicy: normalizeIsolationPolicy(platform, parseV5Json<Partial<AiFrontendIsolationPolicy>>(row.isolation_policy, {})),
    lastVerifiedAt: iso(row.last_verified_at), lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(), updatedAt: iso(row.updated_at) || new Date().toISOString(),
    revokedAt: iso(row.revoked_at)
  };
}

export async function listAiFrontendConnections(input: { deviceId?: string; workspaceId?: string; userId?: string; executionScope?: AiFrontendExecutionScope; platform?: AiFrontendPlatform; includeRevoked?: boolean } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (input.deviceId) { conditions.push("c.device_id = ?"); params.push(input.deviceId); }
  if (input.workspaceId) { conditions.push("c.workspace_id = ?"); params.push(input.workspaceId); }
  if (input.userId) { conditions.push("c.user_id = ?"); params.push(input.userId); }
  if (input.executionScope) { conditions.push("c.execution_scope = ?"); params.push(input.executionScope); }
  if (input.platform) { conditions.push("c.platform = ?"); params.push(input.platform); }
  if (!input.includeRevoked) conditions.push("c.revoked_at IS NULL");
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT c.* FROM ai_frontend_connections c ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY c.revoked_at IS NOT NULL, c.platform, c.account_alias`,
    params
  );
  return rows.map(mapAiFrontendConnection);
}

export async function registerAiFrontendConnection(input: {
  deviceId: string;
  platform: AiFrontendPlatform;
  accountAlias: string;
  browserProfileSlot?: string;
  isolationPolicy?: Partial<AiFrontendIsolationPolicy>;
}) {
  if (!FORMAL_CAPTURE_PLATFORMS.has(input.platform)) throw new V5GovernanceRepositoryError("capture_platform_unsupported", "不支持该 AI 前台平台。", 422);
  const alias = input.accountAlias.trim().slice(0, 120);
  const browserProfileSlot = (input.browserProfileSlot || "default").trim().slice(0, 120);
  if (!alias) throw new V5GovernanceRepositoryError("ai_frontend_connection_alias_required", "请为 AI 账号连接填写可识别的名称。", 422);
  return withV5GovernanceTransaction(async (connection) => {
    const [devices] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_devices WHERE device_id = ? FOR UPDATE", [input.deviceId]);
    const device = devices[0];
    if (!device || device.revoked_at) throw new V5GovernanceRepositoryError("capture_device_unavailable", "采集设备不存在或已撤销。", 403);
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM ai_frontend_connections WHERE device_id = ? AND platform = ? AND browser_profile_slot = ? FOR UPDATE",
      [input.deviceId, input.platform, browserProfileSlot]
    );
    const policy = normalizeIsolationPolicy(input.platform, input.isolationPolicy);
    if (policy.mode === "dedicated_account" && policy.benchmarkCohort === "neutral_benchmark") {
      policy.accountHistoryAttestedAt = new Date().toISOString();
      policy.memorySettingsAttestedAt = policy.accountHistoryAttestedAt;
    }
    const connectionId = existing[0]?.connection_id ? String(existing[0].connection_id) : `ai-connection-${randomUUID()}`;
    if (existing[0]) {
      await connection.query(
        "UPDATE ai_frontend_connections SET workspace_id = ?, user_id = ?, execution_scope = ?, account_alias = ?, status = 'isolation_unverified', isolation_policy = ?, last_error = NULL, revoked_at = NULL WHERE connection_id = ?",
        [String(device.workspace_id), String(device.user_id), String(device.execution_scope || "user_private"), alias, stringifyV5Json(policy), connectionId]
      );
    } else {
      await connection.query(
        `INSERT INTO ai_frontend_connections
         (connection_id, workspace_id, user_id, execution_scope, device_id, platform, account_alias, browser_profile_slot, status, isolation_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'isolation_unverified', ?)`,
        [connectionId, String(device.workspace_id), String(device.user_id), String(device.execution_scope || "user_private"), input.deviceId, input.platform, alias, browserProfileSlot, stringifyV5Json(policy)]
      );
    }
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM ai_frontend_connections WHERE connection_id = ?", [connectionId]);
    return mapAiFrontendConnection(saved[0]);
  });
}

export async function updateAiFrontendConnectionStatus(input: {
  connectionId: string;
  deviceId: string;
  status: Exclude<AiFrontendConnectionStatus, "revoked">;
  lastError?: string;
  verified?: boolean;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM ai_frontend_connections WHERE connection_id = ? FOR UPDATE", [input.connectionId]);
    if (!rows[0] || rows[0].revoked_at) throw new V5GovernanceRepositoryError("ai_frontend_connection_not_found", "AI 账号连接不存在或已撤销。", 404);
    if (String(rows[0].device_id) !== input.deviceId) throw new V5GovernanceRepositoryError("ai_frontend_connection_device_mismatch", "当前设备不能更新该 AI 账号连接。", 403);
    await connection.query(
      `UPDATE ai_frontend_connections SET status = ?, last_error = ?, last_verified_at = CASE WHEN ? THEN NOW() ELSE last_verified_at END
       WHERE connection_id = ?`,
      [input.status, input.lastError?.slice(0, 500) || null, input.verified === true, input.connectionId]
    );
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM ai_frontend_connections WHERE connection_id = ?", [input.connectionId]);
    return mapAiFrontendConnection(saved[0]);
  });
}

export async function revokeAiFrontendConnection(connectionId: string) {
  return withV5GovernanceTransaction(async (connection) => {
    const [result] = await connection.query(
      "UPDATE ai_frontend_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()) WHERE connection_id = ?",
      [connectionId]
    );
    if (!(result as { affectedRows?: number }).affectedRows) throw new V5GovernanceRepositoryError("ai_frontend_connection_not_found", "AI 账号连接不存在。", 404);
    await connection.query(
      "UPDATE capture_tasks SET status = 'cancelled', lease_expires_at = NULL WHERE connection_id = ? AND status IN ('pending', 'leased')",
      [connectionId]
    );
    return { connectionId, status: "revoked" as const, revokedAt: new Date().toISOString() };
  });
}

export async function listCaptureDevices(input: { workspaceId?: string; userId?: string; executionScope?: AiFrontendExecutionScope; includeRevoked?: boolean } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (input.workspaceId) { conditions.push("d.workspace_id = ?"); params.push(input.workspaceId); }
  if (input.userId) { conditions.push("d.user_id = ?"); params.push(input.userId); }
  if (input.executionScope) { conditions.push("d.execution_scope = ?"); params.push(input.executionScope); }
  if (!input.includeRevoked) conditions.push("d.revoked_at IS NULL");
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT d.*,
       (SELECT t.task_id FROM capture_tasks t WHERE t.device_id = d.device_id AND t.status = 'leased' ORDER BY t.created_at ASC LIMIT 1) AS current_task_id,
       (SELECT MAX(e.created_at) FROM capture_evidence e WHERE e.device_id = d.device_id) AS last_successful_capture_at
     FROM capture_devices d ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY d.revoked_at IS NOT NULL, d.paired_at DESC`,
    params
  );
  return rows.map(mapDevice);
}

export async function createCapturePairingCode(input: { workspaceId: string; userId: string; executionScope?: AiFrontendExecutionScope; ttlMinutes?: number }) {
  const pairingCode = randomBytes(6).toString("hex").toUpperCase();
  const codeHash = createHash("sha256").update(pairingCode).digest("hex");
  const ttlMinutes = Math.max(1, Math.min(30, input.ttlMinutes || 10));
  await getV5GovernancePool().query(
    "INSERT INTO capture_pairing_codes (code_hash, workspace_id, user_id, execution_scope, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
    [codeHash, input.workspaceId, input.userId, input.executionScope || "user_private", ttlMinutes]
  );
  return { pairingCode, expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString() };
}

export async function registerCaptureDevice(input: {
  deviceId: string;
  workspaceId?: string;
  userId?: string;
  pairingCode?: string;
  platforms: string[];
}) {
  const saved = await withV5GovernanceTransaction(async (connection) => {
    let workspaceId = input.workspaceId;
    let userId = input.userId;
    let executionScope: AiFrontendExecutionScope = "user_private";
    if (input.pairingCode) {
      const codeHash = createHash("sha256").update(input.pairingCode.trim().toUpperCase()).digest("hex");
      const [codes] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM capture_pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [codeHash]
      );
      if (!codes[0]) throw new V5GovernanceRepositoryError("capture_pairing_code_invalid", "配对码无效、已使用或已过期。", 403);
      workspaceId = String(codes[0].workspace_id);
      userId = String(codes[0].user_id);
      executionScope = String(codes[0].execution_scope || "user_private") as AiFrontendExecutionScope;
      await connection.query("UPDATE capture_pairing_codes SET used_at = NOW() WHERE code_hash = ?", [codeHash]);
    }
    if (!workspaceId || !userId) throw new V5GovernanceRepositoryError("capture_device_identity_required", "需要有效配对码或可信服务端设备身份。", 400);
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_devices WHERE device_id = ? FOR UPDATE",
      [input.deviceId]
    );
    const current = rows[0];
    if (current?.revoked_at) {
      throw new V5GovernanceRepositoryError("capture_device_revoked", "设备已被撤销，不能重新激活。", 409);
    }
    const deploymentRebind = current && executionScope === "deployment_shared";
    if (current && !deploymentRebind && (String(current.workspace_id) !== workspaceId || String(current.user_id) !== userId)) {
      throw new V5GovernanceRepositoryError("capture_device_identity_conflict", "设备已绑定到其他工作区或用户。", 409);
    }
    if (current) {
      await connection.query(
        "UPDATE capture_devices SET workspace_id = ?, user_id = ?, execution_scope = ?, platforms = ?, status = 'online', last_heartbeat_at = NOW() WHERE device_id = ?",
        [workspaceId, userId, executionScope, stringifyV5Json(input.platforms), input.deviceId]
      );
    } else {
      await connection.query(
        `INSERT INTO capture_devices
         (device_id, workspace_id, user_id, execution_scope, status, platforms, last_heartbeat_at, paired_at)
         VALUES (?, ?, ?, ?, 'online', ?, NOW(), NOW())`,
        [input.deviceId, workspaceId, userId, executionScope, stringifyV5Json(input.platforms)]
      );
    }
    const [saved] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_devices WHERE device_id = ? LIMIT 1",
      [input.deviceId]
    );
    return mapDevice(saved[0]);
  });
  return saved;
}

export async function heartbeatCaptureDevice(input: {
  deviceId: string;
  status: string;
  adapterVersion?: string;
}) {
  const saved = await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_devices WHERE device_id = ? FOR UPDATE",
      [input.deviceId]
    );
    if (!rows[0]) throw new V5GovernanceRepositoryError("capture_device_not_found", "采集设备不存在。", 404);
    if (rows[0].revoked_at) throw new V5GovernanceRepositoryError("capture_device_revoked", "设备已被撤销。", 403);
    await connection.query(
      "UPDATE capture_devices SET status = ?, adapter_version = ?, last_heartbeat_at = NOW() WHERE device_id = ?",
      [input.status, input.adapterVersion || null, input.deviceId]
    );
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_devices WHERE device_id = ?", [input.deviceId]);
    return mapDevice(saved[0]);
  });
  return saved;
}

export async function revokeCaptureDevice(deviceId: string) {
  return withV5GovernanceTransaction(async (connection) => {
    const [result] = await connection.query(
      "UPDATE capture_devices SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), lease_expires_at = NULL WHERE device_id = ?",
      [deviceId]
    );
    if (!(result as { affectedRows?: number }).affectedRows) {
      throw new V5GovernanceRepositoryError("capture_device_not_found", "采集设备不存在。", 404);
    }
    await connection.query(
      "UPDATE capture_tasks SET device_id = NULL, lease_expires_at = NULL, status = 'pending' WHERE device_id = ? AND status = 'leased'",
      [deviceId]
    );
    return { deviceId, status: "revoked", revokedAt: new Date().toISOString() };
  });
}

export async function createCaptureTask(input: {
  productId: string;
  requestedWorkspaceId?: string;
  requestedUserId?: string;
  targetEntityName?: string;
  question: string;
  questionVersionId?: string;
  monitoringQuestionId?: string;
  publishedContentId?: string;
  sourcePublishResultId?: string;
  triggerType?: "manual_once" | "published_content_retest" | "monitoring_question";
  captureCondition?: FrontendCaptureCondition;
  connectionId?: string;
  platform: string;
  idempotencyKey: string;
  priority: number;
  scheduledFor?: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    let resolvedConnectionId = input.connectionId;
    if (resolvedConnectionId) {
      const [connections] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM ai_frontend_connections WHERE connection_id = ? AND revoked_at IS NULL FOR UPDATE",
        [resolvedConnectionId]
      );
      if (!connections[0]) throw new V5GovernanceRepositoryError("ai_frontend_connection_not_found", "所选 AI 账号连接不存在或已撤销。", 404);
      if (String(connections[0].platform) !== input.platform) throw new V5GovernanceRepositoryError("ai_frontend_connection_platform_mismatch", "AI 账号连接与测试平台不一致。", 422);
    } else {
      const [connections] = await connection.query<RowDataPacket[]>(
        `SELECT connection_id FROM ai_frontend_connections
         WHERE platform = ? AND revoked_at IS NULL
         ORDER BY status = 'ready' DESC, last_verified_at DESC, created_at ASC LIMIT 1`,
        [input.platform]
      );
      resolvedConnectionId = connections[0]?.connection_id ? String(connections[0].connection_id) : undefined;
    }
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_tasks WHERE idempotency_key = ? FOR UPDATE",
      [input.idempotencyKey]
    );
    if (existing[0]) {
      const requesterMismatch = Boolean(input.requestedWorkspaceId || input.requestedUserId)
        && (String(existing[0].requested_workspace_id || "") !== String(input.requestedWorkspaceId || "")
          || String(existing[0].requested_user_id || "") !== String(input.requestedUserId || ""));
      if (requesterMismatch || String(existing[0].product_id) !== input.productId || String(existing[0].question) !== input.question || String(existing[0].platform) !== input.platform) {
        throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同采集任务。", 409);
      }
      return { taskId: String(existing[0].task_id), status: String(existing[0].status), replayed: true };
    }
    const taskId = `capture-task-${randomUUID()}`;
    await connection.query(
      `INSERT INTO capture_tasks
       (task_id, product_id, requested_workspace_id, requested_user_id, target_entity_name, question, question_version_id, monitoring_question_id, published_content_id, source_publish_result_id, connection_id,
        trigger_type, capture_condition, platform, status, attempt_count, idempotency_key, priority, scheduled_for, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, NOW())`,
      [taskId, input.productId, input.requestedWorkspaceId || null, input.requestedUserId || null, input.targetEntityName || null, input.question, input.questionVersionId || null, input.monitoringQuestionId || null, input.publishedContentId || null,
        input.sourcePublishResultId || null, resolvedConnectionId || null, input.triggerType || "manual_once",
        stringifyV5Json(input.captureCondition || DEFAULT_CAPTURE_CONDITION), input.platform, input.idempotencyKey, input.priority, input.scheduledFor ? new Date(input.scheduledFor) : null]
    );
    return { taskId, status: "pending", connectionId: resolvedConnectionId, replayed: false };
  });
}

export async function createManualFormalCaptureTasks(input: {
  questionVersionId: string;
  question: string;
  platforms: string[];
  captureCondition: FrontendCaptureCondition;
  idempotencyKey: string;
}) {
  if (!input.platforms.length || input.platforms.some((platform) => !FORMAL_CAPTURE_PLATFORMS.has(platform))) {
    throw new V5GovernanceRepositoryError("capture_platform_unsupported", "正式前台测试只支持豆包、DeepSeek、千问和 ChatGPT。", 422);
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT product_id FROM content_matrix_item WHERE question_version_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.questionVersionId]
  );
  if (!rows[0]?.product_id) {
    throw new V5GovernanceRepositoryError("capture_question_product_missing", "正式问题尚未绑定可追踪产品，不能创建前台测试。", 422);
  }
  return Promise.all(input.platforms.map((platform) => createCaptureTask({
    productId: String(rows[0].product_id), question: input.question, questionVersionId: input.questionVersionId,
    platform, priority: 50, triggerType: "manual_once", captureCondition: input.captureCondition,
    idempotencyKey: `${input.idempotencyKey}:${platform}`.slice(0, 128)
  })));
}

export async function listCaptureTasks(taskId?: string, input: { deviceId?: string; connectionId?: string } = {}) {
  const conditions = taskId ? ["t.task_id = ?"] : ["(t.scheduled_for IS NULL OR t.scheduled_for <= NOW())"];
  const params: string[] = taskId ? [taskId] : [];
  if (input.deviceId) {
    conditions.push("c.device_id = ? AND c.revoked_at IS NULL");
    params.push(input.deviceId);
  }
  if (input.connectionId) { conditions.push("t.connection_id = ?"); params.push(input.connectionId); }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT t.task_id, t.product_id, t.question, t.question_version_id, t.monitoring_question_id, t.published_content_id, t.source_publish_result_id,
            t.trigger_type, t.capture_condition, t.connection_id, t.platform, t.device_id, t.lease_expires_at, t.status,
            t.attempt_count, t.idempotency_key, t.priority, t.scheduled_for, t.created_at, t.completed_at, COALESCE(t.target_entity_name, p.display_name) AS target_entity,
            c.isolation_policy, c.status AS connection_status
     FROM capture_tasks t LEFT JOIN product_entity p ON p.id = t.product_id
     LEFT JOIN ai_frontend_connections c ON c.connection_id = t.connection_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY t.priority DESC, t.created_at ASC`,
    params
  );
  return rows.map((row) => ({
    taskId: String(row.task_id),
    productId: String(row.product_id),
    question: String(row.question),
    questionVersionId: row.question_version_id ? String(row.question_version_id) : undefined,
    monitoringQuestionId: row.monitoring_question_id ? String(row.monitoring_question_id) : undefined,
    publishedContentId: row.published_content_id ? String(row.published_content_id) : undefined,
    sourcePublishResultId: row.source_publish_result_id ? String(row.source_publish_result_id) : undefined,
    triggerType: String(row.trigger_type || "manual_once"),
    captureCondition: parseV5Json<FrontendCaptureCondition>(row.capture_condition, DEFAULT_CAPTURE_CONDITION),
    connectionId: row.connection_id ? String(row.connection_id) : undefined,
    isolationPolicy: row.connection_id
      ? normalizeIsolationPolicy(String(row.platform) as AiFrontendPlatform, parseV5Json<Partial<AiFrontendIsolationPolicy>>(row.isolation_policy, {}))
      : undefined,
    connectionStatus: row.connection_status ? String(row.connection_status) : undefined,
    platform: String(row.platform),
    targetEntity: row.target_entity ? String(row.target_entity) : undefined,
    deviceId: row.device_id ? String(row.device_id) : undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    status: String(row.status),
    attemptCount: Number(row.attempt_count),
    idempotencyKey: String(row.idempotency_key),
    priority: Number(row.priority),
    scheduledFor: iso(row.scheduled_for),
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at)
  }));
}

export async function leaseCaptureTask(input: { taskId: string; deviceId: string; durationMs: number }) {
  const durationMs = Math.min(Math.max(input.durationMs, 30_000), MAX_LEASE_MS);
  return withV5GovernanceTransaction(async (connection) => {
    const [devices] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_devices WHERE device_id = ? FOR UPDATE",
      [input.deviceId]
    );
    const device = devices[0];
    if (!device || device.revoked_at) throw new V5GovernanceRepositoryError("capture_device_unavailable", "设备不存在或已撤销。", 403);
    const heartbeatAt = device.last_heartbeat_at ? new Date(device.last_heartbeat_at).getTime() : 0;
    if (Date.now() - heartbeatAt > DEVICE_ONLINE_WINDOW_MS) {
      throw new V5GovernanceRepositoryError("capture_device_offline", "设备心跳已过期，请先恢复心跳。", 409);
    }
    const [tasks] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_tasks WHERE task_id = ? FOR UPDATE", [input.taskId]);
    const task = tasks[0];
    if (!task) throw new V5GovernanceRepositoryError("capture_task_not_found", "采集任务不存在。", 404);
    if (task.scheduled_for && new Date(task.scheduled_for).getTime() > Date.now()) throw new V5GovernanceRepositoryError("capture_task_not_due", "采集任务尚未到计划执行时间。", 409);
    if (String(task.status) === "completed") throw new V5GovernanceRepositoryError("capture_task_completed", "采集任务已完成。", 409);
    if (task.connection_id) {
      const [connections] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM ai_frontend_connections WHERE connection_id = ? FOR UPDATE",
        [task.connection_id]
      );
      const assignedConnection = connections[0];
      if (!assignedConnection || assignedConnection.revoked_at) throw new V5GovernanceRepositoryError("ai_frontend_connection_unavailable", "任务绑定的 AI 账号连接不可用。", 409);
      if (String(assignedConnection.device_id) !== input.deviceId) throw new V5GovernanceRepositoryError("capture_task_connection_device_mismatch", "任务只能由绑定该 AI 账号的设备执行。", 403);
      if (String(assignedConnection.platform) !== String(task.platform)) throw new V5GovernanceRepositoryError("capture_task_connection_platform_mismatch", "任务平台与账号连接不一致。", 409);
    }
    const leaseActive = task.lease_expires_at && new Date(task.lease_expires_at).getTime() > Date.now();
    if (leaseActive && task.device_id && String(task.device_id) !== input.deviceId) {
      throw new V5GovernanceRepositoryError("capture_task_lease_conflict", "任务已由其他设备领取。", 409);
    }
    const leaseExpiresAt = new Date(Date.now() + durationMs);
    await connection.query(
      `UPDATE capture_tasks SET device_id = ?, lease_expires_at = ?, status = 'leased',
       attempt_count = attempt_count + ? WHERE task_id = ?`,
      [input.deviceId, leaseExpiresAt, leaseActive ? 0 : 1, input.taskId]
    );
    return { taskId: input.taskId, deviceId: input.deviceId, status: "leased", leaseExpiresAt: leaseExpiresAt.toISOString() };
  });
}

const CAPTURE_TERMINAL_FAILURES = new Set([
  "needs_login", "isolation_unverified", "adapter_mismatch", "interrupted", "timed_out", "capture_failed", "cancelled"
]);

export async function recordCaptureTaskFailure(input: {
  taskId: string;
  deviceId: string;
  status: string;
  note?: string;
}) {
  if (!CAPTURE_TERMINAL_FAILURES.has(input.status)) {
    throw new V5GovernanceRepositoryError("capture_failure_status_invalid", "采集失败状态无效。", 422);
  }
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_tasks WHERE task_id = ? FOR UPDATE", [input.taskId]);
    const task = rows[0];
    if (!task) throw new V5GovernanceRepositoryError("capture_task_not_found", "采集任务不存在。", 404);
    if (!input.deviceId || String(task.device_id || "") !== input.deviceId) {
      throw new V5GovernanceRepositoryError("capture_task_device_mismatch", "当前设备不能更新该采集任务。", 403);
    }
    if (String(task.status) === "completed") {
      throw new V5GovernanceRepositoryError("capture_task_completed", "已完成任务不能改写为失败。", 409);
    }
    await connection.query("UPDATE capture_tasks SET status = ?, lease_expires_at = NULL WHERE task_id = ?", [input.status, input.taskId]);
    if (task.connection_id && input.status === "isolation_unverified") {
      await connection.query(
        "UPDATE ai_frontend_connections SET status = 'isolation_unverified', last_error = ? WHERE connection_id = ?",
        [(input.note || "账号记忆隔离未通过。").slice(0, 500), task.connection_id]
      );
    } else if (task.connection_id && input.status === "needs_login") {
      await connection.query(
        "UPDATE ai_frontend_connections SET status = 'needs_login', last_error = ? WHERE connection_id = ?",
        [(input.note || "AI 前台登录状态已失效。").slice(0, 500), task.connection_id]
      );
    }
    return { taskId: input.taskId, status: input.status, deviceId: input.deviceId };
  });
}

export async function uploadCaptureEvidence(input: {
  taskId: string;
  artifactHash: string;
  deviceId: string;
  collectedBy?: string;
  payload: Record<string, unknown>;
}) {
  const computedHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(input.artifactHash) || computedHash !== input.artifactHash.toLowerCase()) {
    throw new V5GovernanceRepositoryError("capture_evidence_hash_mismatch", "证据哈希与服务端复算结果不一致。", 422);
  }
  const payload = normalizeCaptureEvidencePayload(input.payload);
  const saved = await withV5GovernanceTransaction(async (connection) => {
    const [tasks] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_tasks WHERE task_id = ? FOR UPDATE", [input.taskId]);
    const task = tasks[0];
    if (!task) throw new V5GovernanceRepositoryError("capture_task_not_found", "采集任务不存在。", 404);
    if (!input.deviceId || String(task.device_id || "") !== input.deviceId || !task.lease_expires_at || new Date(task.lease_expires_at).getTime() <= Date.now()) {
      throw new V5GovernanceRepositoryError("capture_task_lease_required", "上传证据需要当前设备持有有效租约。", 409);
    }
    if (task.connection_id) {
      const [connections] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM ai_frontend_connections WHERE connection_id = ? FOR UPDATE",
        [task.connection_id]
      );
      const assignedConnection = connections[0];
      if (!assignedConnection || assignedConnection.revoked_at || String(assignedConnection.device_id) !== input.deviceId) {
        throw new V5GovernanceRepositoryError("capture_evidence_connection_mismatch", "采集证据与任务绑定的 AI 账号连接不一致。", 403);
      }
      const policy = normalizeIsolationPolicy(String(assignedConnection.platform) as AiFrontendPlatform, parseV5Json<Partial<AiFrontendIsolationPolicy>>(assignedConnection.isolation_policy, {}));
      const attestation = payload.isolationAttestation;
      const missingChecks = policy.requiredChecks.filter((check) => {
        const result = attestation?.checks[check];
        return result !== "verified" && !(["dedicated_account", "memory_off", "custom_instructions_off"].includes(check) && result === "user_attested");
      });
      if (policy.benchmarkCohort === "neutral_benchmark" && (!attestation || attestation.status !== "verified_clean" || missingChecks.length)) {
        await connection.query(
          "UPDATE ai_frontend_connections SET status = 'isolation_unverified', last_error = ? WHERE connection_id = ?",
          [`未通过中立基线隔离检查：${missingChecks.join("、") || "attestation_missing"}`.slice(0, 500), task.connection_id]
        );
        return { isolationRejected: true as const, missingChecks };
      }
      await connection.query(
        "UPDATE ai_frontend_connections SET status = 'ready', last_verified_at = NOW(), last_error = NULL WHERE connection_id = ?",
        [task.connection_id]
      );
    }
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_evidence WHERE task_id = ? AND artifact_hash = ? LIMIT 1 FOR UPDATE",
      [input.taskId, input.artifactHash]
    );
    if (existing[0]) return { id: String(existing[0].id), taskId: input.taskId, artifactHash: input.artifactHash, replayed: true, productId: String(task.product_id), triggerType: String(task.trigger_type || "manual_once") };
    const [versions] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM capture_evidence WHERE task_id = ?",
      [input.taskId]
    );
    const version = Number(versions[0]?.next_version || 1);
    const id = `capture-evidence-${randomUUID()}`;
    await connection.query(
      `INSERT INTO capture_evidence (id, task_id, artifact_hash, payload, collected_by, device_id, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.taskId, input.artifactHash, stringifyV5Json(payload), input.collectedBy || null, input.deviceId, version]
    );
    await connection.query(
      "UPDATE capture_tasks SET status = 'completed', completed_at = NOW(), lease_expires_at = NULL WHERE task_id = ?",
      [input.taskId]
    );
    await connection.query(
      `INSERT INTO attribution_chain
       (id, source_event_id, platform, change_type, evidence_ids, strategy_adjustment_id, article_ids, outcome, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, NOW())`,
      [`attribution-${randomUUID()}`, input.taskId, task.platform, "capture_evidence_recorded", stringifyV5Json([id]), null, "awaiting_batch_geo_diagnosis"]
    );
    return { id, taskId: input.taskId, artifactHash: input.artifactHash, version, replayed: false, productId: String(task.product_id), triggerType: String(task.trigger_type || "manual_once") };
  });
  if ("isolationRejected" in saved) {
    const failedChecks = Array.isArray(saved.missingChecks) ? saved.missingChecks : [];
    throw new V5GovernanceRepositoryError(
      "capture_isolation_unverified",
      `账号记忆隔离未通过，不能写入中立基线证据：${failedChecks.join("、") || "缺少隔离证明"}。`,
      422
    );
  }
  if (saved.triggerType === "published_content_retest") {
    const { reconcileProductGeoOptimizations } = await import("./product-geo-optimization-repository");
    await reconcileProductGeoOptimizations([saved.productId]);
  }
  return saved;
}

const OBSERVATION_GAP_CODES = new Set<ObservationGapCode>([
  "answer_coverage_gap", "citation_gap", "evidence_gap", "relationship_gap",
  "freshness_gap", "entity_gap", "observation_uncertain"
]);

function normalizeCaptureEvidencePayload(value: Record<string, unknown>): FormalCaptureEvidencePayload {
  const sensitive = sensitivePaths(value);
  if (sensitive.length) {
    throw new V5GovernanceRepositoryError("capture_sensitive_payload", `采集证据包含禁止字段：${sensitive.join("、")}`, 422);
  }
  const answerText = typeof value.answerText === "string" ? value.answerText.trim() : "";
  if (!answerText) throw new V5GovernanceRepositoryError("capture_answer_required", "采集证据必须包含可见回答正文。", 422);
  const citations = (Array.isArray(value.citations) ? value.citations : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .filter((item) => /^https?:\/\//i.test(String(item.url || "")))
    .map((item, index) => ({
      label: String(item.label || `引用 ${index + 1}`),
      url: String(item.url),
      title: String(item.title || ""),
      visibleSnippet: String(item.visibleSnippet || ""),
      position: Number.isInteger(Number(item.position)) ? Number(item.position) : index + 1,
      capturedAt: String(item.capturedAt || new Date().toISOString()),
      verificationStatus: item.verificationStatus === "verified" ? "verified" as const : "unverified" as const,
      domainOwner: item.domainOwner ? String(item.domainOwner) : undefined,
      sourceType: ["official", "owned", "third_party", "unknown"].includes(String(item.sourceType))
        ? item.sourceType as "official" | "owned" | "third_party" | "unknown"
        : "unknown" as const
    }));
  const gaps = (Array.isArray(value.gaps) ? value.gaps : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .filter((item) => OBSERVATION_GAP_CODES.has(String(item.code) as ObservationGapCode))
    .map((item) => ({
      code: String(item.code) as ObservationGapCode,
      title: item.title ? String(item.title) : undefined,
      explanation: String(item.explanation || "采集执行器识别到待复核缺口。"),
      evidenceLocation: item.evidenceLocation ? String(item.evidenceLocation) : undefined,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
      status: ["candidate", "confirmed", "rejected"].includes(String(item.status))
        ? item.status as "candidate" | "confirmed" | "rejected"
        : "candidate" as const
    }));
  if (!citations.length && !gaps.some((item) => item.code === "citation_gap")) {
    gaps.push({ code: "citation_gap", title: "回答未发现可见引用", explanation: "真实前台回答中没有采集到可访问引用。", evidenceLocation: "answer", confidence: 0.9, status: "candidate" });
  }
  const rawAttestation = value.isolationAttestation && typeof value.isolationAttestation === "object" && !Array.isArray(value.isolationAttestation)
    ? value.isolationAttestation as Record<string, unknown>
    : undefined;
  const rawPolicy = rawAttestation?.policy && typeof rawAttestation.policy === "object" && !Array.isArray(rawAttestation.policy)
    ? rawAttestation.policy as Partial<AiFrontendIsolationPolicy>
    : undefined;
  const attestationPlatform = FORMAL_CAPTURE_PLATFORMS.has(String(rawAttestation?.platform))
    ? String(rawAttestation?.platform) as AiFrontendPlatform
    : "chatgpt";
  const policy = rawPolicy ? normalizeIsolationPolicy(attestationPlatform, rawPolicy) : undefined;
  const rawChecks = rawAttestation?.checks && typeof rawAttestation.checks === "object" && !Array.isArray(rawAttestation.checks)
    ? rawAttestation.checks as Record<string, unknown>
    : {};
  const checkNames = ["new_conversation", "temporary_chat", "memory_off", "custom_instructions_off", "dedicated_account", "dedicated_profile"] as const;
  const isolationAttestation: CaptureIsolationAttestation | undefined = policy ? {
    policy,
    checks: Object.fromEntries(checkNames.map((name) => [name, ["verified", "user_attested", "not_supported", "failed", "not_required"].includes(String(rawChecks[name]))
      ? String(rawChecks[name])
      : "not_required"])) as CaptureIsolationAttestation["checks"],
    status: ["verified_clean", "unverified", "contaminated"].includes(String(rawAttestation?.status))
      ? rawAttestation!.status as CaptureIsolationAttestation["status"]
      : "unverified",
    checkedAt: String(rawAttestation?.checkedAt || new Date().toISOString()),
    adapterVersion: String(rawAttestation?.adapterVersion || value.adapterVersion || "unknown"),
    notes: Array.isArray(rawAttestation?.notes) ? rawAttestation.notes.map(String).slice(0, 20) : []
  } : undefined;
  return {
    contractVersion: "frontend-capture-evidence.v1",
    answerText,
    answerHtmlSanitized: typeof value.answerHtmlSanitized === "string" ? value.answerHtmlSanitized : undefined,
    citations,
    gaps,
    targetEntity: typeof value.targetEntity === "string" ? value.targetEntity : undefined,
    targetEntityMentioned: value.targetEntityMentioned === true,
    adapterVersion: typeof value.adapterVersion === "string" ? value.adapterVersion : undefined,
    browserVersion: typeof value.browserVersion === "string" ? value.browserVersion : undefined,
    isolationAttestation,
    manifest: value.manifest && typeof value.manifest === "object" && !Array.isArray(value.manifest) ? value.manifest as Record<string, unknown> : undefined
  };
}

export async function createConnectedManualCaptureTask(input: {
  productId: string;
  questionVersionId: string;
  question: string;
  connectionId: string;
  idempotencyKey: string;
}) {
  const connections = await listAiFrontendConnections({ includeRevoked: false });
  const selected = connections.find((item) => item.connectionId === input.connectionId);
  if (!selected) throw new V5GovernanceRepositoryError("ai_frontend_connection_not_found", "所选 AI 账号连接不存在或已撤销。", 404);
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT product_id FROM content_matrix_item
     WHERE product_id = ? AND question_version_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.productId, input.questionVersionId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("capture_question_product_mismatch", "该正式问题没有绑定当前产品，不能发起前台测试。", 422);
  return createCaptureTask({
    productId: input.productId,
    question: input.question,
    questionVersionId: input.questionVersionId,
    connectionId: input.connectionId,
    platform: selected.platform,
    priority: 100,
    triggerType: "manual_once",
    captureCondition: DEFAULT_CAPTURE_CONDITION,
    idempotencyKey: input.idempotencyKey.slice(0, 128)
  });
}

export async function createDeploymentSharedCaptureTask(input: {
  workspaceId: string;
  userId: string;
  productId: string;
  questionVersionId: string;
  question: string;
  platform: AiFrontendPlatform;
  idempotencyKey: string;
}) {
  const [connections] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT c.connection_id
     FROM ai_frontend_connections c
     JOIN capture_devices d ON d.device_id = c.device_id
     LEFT JOIN capture_tasks t ON t.connection_id = c.connection_id AND t.status IN ('pending', 'leased')
     WHERE c.execution_scope = 'deployment_shared' AND c.platform = ?
       AND c.revoked_at IS NULL AND d.revoked_at IS NULL
       AND c.status <> 'needs_login'
     GROUP BY c.connection_id, c.status, c.last_verified_at, d.status, d.last_heartbeat_at, c.created_at
     ORDER BY (d.last_heartbeat_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)) DESC,
       (c.status = 'ready') DESC, COUNT(t.task_id) ASC, c.last_verified_at DESC, c.created_at ASC
     LIMIT 1`,
    [input.platform]
  );
  const connectionId = connections[0]?.connection_id ? String(connections[0].connection_id) : undefined;
  if (!connectionId) {
    throw new V5GovernanceRepositoryError(
      "deployment_capture_platform_unavailable",
      "部署级 AI 前台采集账号尚未就绪。",
      503,
      `请联系部署人员检查 ${input.platform} 账号登录和 24 小时采集服务器。`
    );
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT product_id FROM content_matrix_item
     WHERE product_id = ? AND question_version_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.productId, input.questionVersionId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("capture_question_product_mismatch", "该正式问题没有绑定当前产品，不能发起前台测试。", 422);
  return createCaptureTask({
    productId: input.productId,
    requestedWorkspaceId: input.workspaceId,
    requestedUserId: input.userId,
    question: input.question,
    questionVersionId: input.questionVersionId,
    connectionId,
    platform: input.platform,
    priority: 100,
    triggerType: "manual_once",
    captureCondition: DEFAULT_CAPTURE_CONDITION,
    idempotencyKey: input.idempotencyKey.slice(0, 128)
  });
}

function sensitivePaths(value: unknown, trail: string[] = []): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => sensitivePaths(item, [...trail, String(index)]));
  const forbidden = /^(?:cookies?|cookieheaders?|passwords?|passwd|authorization|localstorage|sessionstorage|autofill|requestheaders?|(?:access|refresh|auth|oauth|api|bearer|id|csrf|private|secret|session)?tokens?)$/;
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => forbidden.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
    ? [[...trail, key].join(".")]
    : sensitivePaths(item, [...trail, key]));
}

export async function createPublishedContentRetestTasks(connection: PoolConnection, input: {
  productId: string;
  question: string;
  questionVersionId?: string;
  publishedContentId: string;
  sourcePublishResultId: string;
}) {
  const [productRows] = await connection.query<RowDataPacket[]>(
    "SELECT display_name, entity_relationship FROM product_entity WHERE id = ? LIMIT 1",
    [input.productId]
  );
  const relationship = productRows[0]?.entity_relationship ? String(productRows[0].entity_relationship) : "";
  const provider = relationship.split(/[；。]/).map((item) => item.trim()).flatMap((segment) => {
    if (!/(?:服务商|实施伙伴|合作伙伴|提供|支持|负责|实施|交付)/.test(segment)) return [];
    const match = segment.match(/^([A-Za-z][A-Za-z0-9._-]{1,40})\s*(?:是|作为|可|为|向|提供|支持|负责)/);
    return match?.[1] ? [match[1]] : [];
  })[0];
  const isCategoryEnumeration = /服务商.*(?:有哪些|哪家|推荐|名单|选择|选型)|(?:有哪些|哪家|推荐|名单).*服务商|实施伙伴.*(?:有哪些|哪家|推荐|选择)/.test(input.question);
  const targetEntityName = isCategoryEnumeration && provider ? provider : String(productRows[0]?.display_name || "") || undefined;
  const [packRows] = await connection.query<RowDataPacket[]>(
    `SELECT content_plan_json FROM product_strategy_packs
     WHERE product_id = ? AND status IN ('active', 'production_ready', 'pending_sample_review')
     ORDER BY compiled_at DESC LIMIT 1`,
    [input.productId]
  );
  const plan = parseV5Json<Record<string, unknown>>(packRows[0]?.content_plan_json, {});
  const baseline = plan.retestBaseline && typeof plan.retestBaseline === "object" && !Array.isArray(plan.retestBaseline)
    ? plan.retestBaseline as Record<string, unknown>
    : {};
  const configuredPlatforms = (Array.isArray(baseline.platforms) ? baseline.platforms : [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((item) => FORMAL_CAPTURE_PLATFORMS.has(item));
  const platforms = Array.from(new Set(configuredPlatforms.length ? configuredPlatforms : ["doubao", "deepseek", "qwen", "chatgpt"]));
  const condition = baseline.condition && typeof baseline.condition === "object" && !Array.isArray(baseline.condition)
    ? { ...DEFAULT_CAPTURE_CONDITION, ...(baseline.condition as Partial<FrontendCaptureCondition>) }
    : DEFAULT_CAPTURE_CONDITION;
  const created: string[] = [];
  for (const platform of platforms) {
    const idempotencyKey = `published-retest:${createHash("sha256").update(`${input.sourcePublishResultId}:${platform}`).digest("hex").slice(0, 48)}`;
    const [existing] = await connection.query<RowDataPacket[]>("SELECT task_id FROM capture_tasks WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
    if (existing[0]) { created.push(String(existing[0].task_id)); continue; }
    const taskId = `capture-task-${randomUUID()}`;
    await connection.query(
      `INSERT INTO capture_tasks
       (task_id, product_id, target_entity_name, question, question_version_id, published_content_id, source_publish_result_id,
        trigger_type, capture_condition, platform, status, attempt_count, idempotency_key, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published_content_retest', ?, ?, 'pending', 0, ?, 80, NOW())`,
      [taskId, input.productId, targetEntityName || null, input.question, input.questionVersionId || null, input.publishedContentId,
        input.sourcePublishResultId, stringifyV5Json(condition), platform, idempotencyKey]
    );
    created.push(taskId);
  }
  return created;
}

export async function listFormalCaptureObservations(input: { month?: string; answerId?: string } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (input.month) { conditions.push("DATE_FORMAT(t.created_at, '%Y-%m') = ?"); params.push(input.month); }
  if (input.answerId) { conditions.push("CONCAT('captured-answer-', e.id) = ?"); params.push(input.answerId); }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT t.*, e.id AS evidence_id, e.artifact_hash, e.payload, e.version AS evidence_version, e.created_at AS evidence_created_at
     FROM capture_tasks t
     LEFT JOIN capture_evidence e ON e.id = (
       SELECT e2.id FROM capture_evidence e2 WHERE e2.task_id = t.task_id ORDER BY e2.version DESC, e2.created_at DESC LIMIT 1
     )
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY t.created_at DESC`,
    params
  );
  const [reviewRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT r.* FROM capture_gap_reviews r
     JOIN (SELECT answer_id, MAX(version) AS version FROM capture_gap_reviews GROUP BY answer_id) latest
       ON latest.answer_id = r.answer_id AND latest.version = r.version`
  );
  const reviewByAnswer = new Map(reviewRows.map((row) => [String(row.answer_id), row]));
  return rows.map((row) => {
    const payload = row.evidence_id ? normalizeCaptureEvidencePayload(parseV5Json<Record<string, unknown>>(row.payload, {})) : undefined;
    const answerId = row.evidence_id ? `captured-answer-${String(row.evidence_id)}` : undefined;
    const citations: CapturedCitation[] = (payload?.citations || []).map((item, index) => ({
      id: `citation-${String(row.evidence_id)}-${index + 1}`,
      label: item.label || `引用 ${index + 1}`, url: item.url, title: item.title || "", visibleSnippet: item.visibleSnippet || "",
      position: item.position || index + 1, capturedAt: item.capturedAt || iso(row.evidence_created_at) || new Date().toISOString(),
      verificationStatus: item.verificationStatus || "unverified", domainOwner: item.domainOwner, sourceType: item.sourceType
    }));
    const reviewRow = answerId ? reviewByAnswer.get(answerId) : undefined;
    const selectedGapIds = new Set(parseV5Json<string[]>(reviewRow?.selected_gap_ids, []));
    const gaps: ObservationGap[] = (payload?.gaps || []).map((item, index) => ({
      id: `gap-${String(row.evidence_id)}-${index + 1}`, answerId: answerId!, code: item.code,
      title: item.title || item.code, explanation: item.explanation, evidenceLocation: item.evidenceLocation || "answer",
      confidence: item.confidence || 0.5, suggestedDestinations: item.code === "evidence_gap" ? ["knowledge_issue"] : item.code === "observation_uncertain" ? ["manual_review"] : ["blog_candidate"],
      rootCause: item.code === "evidence_gap" || item.code === "relationship_gap" || item.code === "freshness_gap" ? "evidence_missing"
        : item.code === "observation_uncertain" ? "sample_insufficient"
          : item.code === "citation_gap" ? "distribution_weak" : "content_coverage_missing",
      recommendedAction: item.code === "evidence_gap" || item.code === "relationship_gap" || item.code === "freshness_gap" ? "collect_evidence"
        : item.code === "observation_uncertain" ? "continue_monitoring"
          : item.code === "citation_gap" ? "refresh_existing_content" : "create_content_candidate",
      status: selectedGapIds.has(`gap-${String(row.evidence_id)}-${index + 1}`)
        ? (String(reviewRow?.decision) === "confirmed" ? "confirmed" : "rejected")
        : item.status || "candidate",
      analysisVersion: Number(row.evidence_version || 1), createdAt: iso(row.evidence_created_at) || new Date().toISOString()
    }));
    const answer: CapturedAnswer | undefined = payload && answerId ? {
      id: answerId, taskId: String(row.task_id), artifactId: `capture-artifact-${String(row.artifact_hash)}`,
      questionKey: row.question_version_id ? String(row.question_version_id) : String(row.question), questionText: String(row.question),
      platform: String(row.platform) as AiFrontendPlatform, answerText: payload.answerText, citations,
      targetEntity: payload.targetEntity, targetEntityMentioned: payload.targetEntityMentioned === true,
      parseVersions: [{ version: Number(row.evidence_version || 1), parserVersion: "formal-capture-evidence@1", statements: [], evidenceMatches: [], createdAt: iso(row.evidence_created_at) || new Date().toISOString() }],
      gapAnalysisVersions: [{ version: Number(row.evidence_version || 1), analyzerVersion: "capture-runner@1", gapIds: gaps.map((item) => item.id), createdAt: iso(row.evidence_created_at) || new Date().toISOString() }],
      reviewVersion: reviewRow ? Number(reviewRow.version) : 0, createdAt: iso(row.evidence_created_at) || new Date().toISOString()
    } : undefined;
    const task: FrontendCaptureTask = {
      id: String(row.task_id), captureSessionId: String(row.task_id), version: Number(row.attempt_count || 0),
      connectionId: row.connection_id ? String(row.connection_id) : undefined,
      questionKey: row.question_version_id ? String(row.question_version_id) : String(row.question),
      questionVersionId: row.question_version_id ? String(row.question_version_id) : undefined,
      sourcePublishedContentIds: row.published_content_id ? [String(row.published_content_id)] : [], questionText: String(row.question), temporaryQuestion: !row.question_version_id,
      platform: String(row.platform) as AiFrontendPlatform,
      condition: parseV5Json<FrontendCaptureCondition>(row.capture_condition, DEFAULT_CAPTURE_CONDITION),
      status: String(row.status) === "completed" ? "completed" : String(row.status) === "leased" ? "submitting_prompt" : "queued",
      statusHistory: [{ status: String(row.status) === "completed" ? "completed" : String(row.status) === "leased" ? "submitting_prompt" : "queued", at: iso(row.created_at) || new Date().toISOString(), note: String(row.trigger_type) === "published_content_retest" ? "正式发布后自动创建复测任务。" : "已创建单次测试任务。" }],
      manualIntervention: false, answerId, artifactId: row.evidence_id ? `capture-artifact-${String(row.artifact_hash)}` : undefined,
      createdAt: iso(row.created_at) || new Date().toISOString(), createdBy: String(row.trigger_type || "system"),
      updatedAt: iso(row.updated_at) || iso(row.created_at) || new Date().toISOString(), updatedBy: row.device_id ? String(row.device_id) : "system"
    };
    const artifact: FrontendCaptureArtifact | undefined = row.evidence_id ? {
      id: `capture-artifact-${String(row.artifact_hash)}`, taskId: task.id, captureSessionId: task.captureSessionId,
      sha256: String(row.artifact_hash), manifestSha256: String(row.artifact_hash), screenshotArtifactId: "stored-in-evidence-manifest",
      screenshotSha256: String(row.artifact_hash), screenshotByteLength: 0, adapterVersion: payload?.adapterVersion || "unknown",
      browserVersion: payload?.browserVersion || "unknown", storageClass: "controlled_local", immutable: true,
      createdAt: iso(row.evidence_created_at) || new Date().toISOString()
    } : undefined;
    const reviews: ObservationReview[] = reviewRow && answerId ? [{
      id: String(reviewRow.id), answerId, version: Number(reviewRow.version), selectedGapIds: [...selectedGapIds],
      decision: String(reviewRow.decision) === "confirmed" ? "confirmed" : "rejected",
      destinations: parseV5Json<ObservationReview["destinations"]>(reviewRow.destinations, []), note: String(reviewRow.note || ""),
      downstream: [], monthlyTaskCreated: false, createdAt: iso(reviewRow.created_at) || new Date().toISOString(), createdBy: String(reviewRow.created_by)
    }] : [];
    return { task, answer, artifact, gaps, reviews, triggerType: String(row.trigger_type || "manual_once"), publishedContentId: row.published_content_id ? String(row.published_content_id) : undefined };
  });
}

export async function reviewFormalCaptureGaps(answerId: string, input: ReviewObservationRequest) {
  if (!answerId.startsWith("captured-answer-capture-evidence-")) {
    throw new V5GovernanceRepositoryError("capture_answer_not_found", "正式采集回答不存在。", 404);
  }
  const evidenceId = answerId.replace(/^captured-answer-/, "");
  return withV5GovernanceTransaction(async (connection) => {
    const [evidence] = await connection.query<RowDataPacket[]>("SELECT id FROM capture_evidence WHERE id = ? FOR UPDATE", [evidenceId]);
    if (!evidence[0]) throw new V5GovernanceRepositoryError("capture_answer_not_found", "正式采集回答不存在。", 404);
    const [versions] = await connection.query<RowDataPacket[]>("SELECT COALESCE(MAX(version), 0) AS version FROM capture_gap_reviews WHERE answer_id = ? FOR UPDATE", [answerId]);
    const currentVersion = Number(versions[0]?.version || 0);
    if (input.expectedVersion !== currentVersion && input.expectedVersion !== currentVersion + 1) {
      throw new V5GovernanceRepositoryError("capture_review_version_conflict", `缺口复核当前 version 为 ${currentVersion}。`, 409);
    }
    const version = currentVersion + 1;
    const id = `capture-review-${randomUUID()}`;
    await connection.query(
      `INSERT INTO capture_gap_reviews
       (id, evidence_id, answer_id, version, selected_gap_ids, decision, destinations, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, evidenceId, answerId, version, stringifyV5Json(input.selectedGapIds), input.decision,
        stringifyV5Json(input.destinations), input.note, input.actor.actorId]
    );
    return { id, answerId, version, selectedGapIds: input.selectedGapIds, decision: input.decision, destinations: input.destinations, note: input.note, downstream: [], monthlyTaskCreated: false, createdAt: new Date().toISOString(), createdBy: input.actor.actorId };
  });
}

export async function recordAttributionEvent(input: {
  sourceEventId: string;
  platform: string;
  changeType: string;
  evidenceIds: string[];
  strategyAdjustmentId?: string;
  articleIds: string[];
  outcome?: string;
}) {
  const id = `attribution-${randomUUID()}`;
  await getV5GovernancePool().query(
    `INSERT INTO attribution_chain
     (id, source_event_id, platform, change_type, evidence_ids, strategy_adjustment_id, article_ids, outcome, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      input.sourceEventId,
      input.platform,
      input.changeType,
      stringifyV5Json(input.evidenceIds),
      input.strategyAdjustmentId || null,
      stringifyV5Json(input.articleIds),
      input.outcome || null
    ]
  );
  return { id, ...input, recordedAt: new Date().toISOString() };
}
