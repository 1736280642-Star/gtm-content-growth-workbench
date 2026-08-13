import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  AiFrontendPlatform,
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

export async function listCaptureDevices() {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT d.*,
       (SELECT t.task_id FROM capture_tasks t WHERE t.device_id = d.device_id AND t.status = 'leased' ORDER BY t.created_at ASC LIMIT 1) AS current_task_id,
       (SELECT MAX(e.created_at) FROM capture_evidence e WHERE e.device_id = d.device_id) AS last_successful_capture_at
     FROM capture_devices d ORDER BY d.revoked_at IS NOT NULL, d.paired_at DESC`
  );
  return rows.map(mapDevice);
}

export async function createCapturePairingCode(input: { workspaceId: string; userId: string; ttlMinutes?: number }) {
  const pairingCode = randomBytes(6).toString("hex").toUpperCase();
  const codeHash = createHash("sha256").update(pairingCode).digest("hex");
  const ttlMinutes = Math.max(1, Math.min(30, input.ttlMinutes || 10));
  await getV5GovernancePool().query(
    "INSERT INTO capture_pairing_codes (code_hash, workspace_id, user_id, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
    [codeHash, input.workspaceId, input.userId, ttlMinutes]
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
  return withV5GovernanceTransaction(async (connection) => {
    let workspaceId = input.workspaceId;
    let userId = input.userId;
    if (input.pairingCode) {
      const codeHash = createHash("sha256").update(input.pairingCode.trim().toUpperCase()).digest("hex");
      const [codes] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM capture_pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [codeHash]
      );
      if (!codes[0]) throw new V5GovernanceRepositoryError("capture_pairing_code_invalid", "配对码无效、已使用或已过期。", 403);
      workspaceId = String(codes[0].workspace_id);
      userId = String(codes[0].user_id);
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
    if (current && (String(current.workspace_id) !== workspaceId || String(current.user_id) !== userId)) {
      throw new V5GovernanceRepositoryError("capture_device_identity_conflict", "设备已绑定到其他工作区或用户。", 409);
    }
    if (current) {
      await connection.query(
        "UPDATE capture_devices SET platforms = ?, status = 'online', last_heartbeat_at = NOW() WHERE device_id = ?",
        [stringifyV5Json(input.platforms), input.deviceId]
      );
    } else {
      await connection.query(
        `INSERT INTO capture_devices
         (device_id, workspace_id, user_id, status, platforms, last_heartbeat_at, paired_at)
         VALUES (?, ?, ?, 'online', ?, NOW(), NOW())`,
        [input.deviceId, workspaceId, userId, stringifyV5Json(input.platforms)]
      );
    }
    const [saved] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_devices WHERE device_id = ? LIMIT 1",
      [input.deviceId]
    );
    return mapDevice(saved[0]);
  });
}

export async function heartbeatCaptureDevice(input: {
  deviceId: string;
  status: string;
  adapterVersion?: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
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
  question: string;
  questionVersionId?: string;
  publishedContentId?: string;
  sourcePublishResultId?: string;
  triggerType?: "manual_once" | "published_content_retest";
  captureCondition?: FrontendCaptureCondition;
  platform: string;
  idempotencyKey: string;
  priority: number;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_tasks WHERE idempotency_key = ? FOR UPDATE",
      [input.idempotencyKey]
    );
    if (existing[0]) {
      if (String(existing[0].product_id) !== input.productId || String(existing[0].question) !== input.question || String(existing[0].platform) !== input.platform) {
        throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同采集任务。", 409);
      }
      return { taskId: String(existing[0].task_id), status: String(existing[0].status), replayed: true };
    }
    const taskId = `capture-task-${randomUUID()}`;
    await connection.query(
      `INSERT INTO capture_tasks
       (task_id, product_id, question, question_version_id, published_content_id, source_publish_result_id,
        trigger_type, capture_condition, platform, status, attempt_count, idempotency_key, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NOW())`,
      [taskId, input.productId, input.question, input.questionVersionId || null, input.publishedContentId || null,
        input.sourcePublishResultId || null, input.triggerType || "manual_once",
        stringifyV5Json(input.captureCondition || DEFAULT_CAPTURE_CONDITION), input.platform, input.idempotencyKey, input.priority]
    );
    return { taskId, status: "pending", replayed: false };
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

export async function listCaptureTasks(taskId?: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT t.task_id, t.product_id, t.question, t.question_version_id, t.published_content_id, t.source_publish_result_id,
            t.trigger_type, t.capture_condition, t.platform, t.device_id, t.lease_expires_at, t.status,
            t.attempt_count, t.idempotency_key, t.priority, t.created_at, t.completed_at, p.display_name AS target_entity
     FROM capture_tasks t LEFT JOIN product_entity p ON p.id = t.product_id ${taskId ? "WHERE t.task_id = ?" : ""}
     ORDER BY t.priority DESC, t.created_at ASC`,
    taskId ? [taskId] : []
  );
  return rows.map((row) => ({
    taskId: String(row.task_id),
    productId: String(row.product_id),
    question: String(row.question),
    questionVersionId: row.question_version_id ? String(row.question_version_id) : undefined,
    publishedContentId: row.published_content_id ? String(row.published_content_id) : undefined,
    sourcePublishResultId: row.source_publish_result_id ? String(row.source_publish_result_id) : undefined,
    triggerType: String(row.trigger_type || "manual_once"),
    captureCondition: parseV5Json<FrontendCaptureCondition>(row.capture_condition, DEFAULT_CAPTURE_CONDITION),
    platform: String(row.platform),
    targetEntity: row.target_entity ? String(row.target_entity) : undefined,
    deviceId: row.device_id ? String(row.device_id) : undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    status: String(row.status),
    attemptCount: Number(row.attempt_count),
    idempotencyKey: String(row.idempotency_key),
    priority: Number(row.priority),
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
    if (String(task.status) === "completed") throw new V5GovernanceRepositoryError("capture_task_completed", "采集任务已完成。", 409);
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
  return withV5GovernanceTransaction(async (connection) => {
    const [tasks] = await connection.query<RowDataPacket[]>("SELECT * FROM capture_tasks WHERE task_id = ? FOR UPDATE", [input.taskId]);
    const task = tasks[0];
    if (!task) throw new V5GovernanceRepositoryError("capture_task_not_found", "采集任务不存在。", 404);
    if (!input.deviceId || String(task.device_id || "") !== input.deviceId || !task.lease_expires_at || new Date(task.lease_expires_at).getTime() <= Date.now()) {
      throw new V5GovernanceRepositoryError("capture_task_lease_required", "上传证据需要当前设备持有有效租约。", 409);
    }
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM capture_evidence WHERE task_id = ? AND artifact_hash = ? LIMIT 1 FOR UPDATE",
      [input.taskId, input.artifactHash]
    );
    if (existing[0]) return { id: String(existing[0].id), taskId: input.taskId, artifactHash: input.artifactHash, replayed: true };
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
    const gaps = payload.gaps.map((item) => ({
      type: item.code === "citation_gap" ? "citation_gap" : "question_gap",
      question: String(task.question || "").slice(0, 500),
      priority: Math.max(1, Math.min(100, Math.round((item.confidence || 0.5) * 100)))
    }));
    let strategyAdjustmentId: string | undefined;
    if (gaps.length) {
      const [packs] = await connection.query<RowDataPacket[]>(
        `SELECT pack.*
         FROM product_strategy_packs pack
         JOIN product_entity product ON product.strategy_pack_id = pack.id
         WHERE pack.product_id = ? AND pack.status IN ('active', 'production_ready')
         ORDER BY pack.compiled_at DESC LIMIT 1 FOR UPDATE`,
        [task.product_id]
      );
      if (packs[0]) {
        strategyAdjustmentId = `strategy-adjustment-${randomUUID()}`;
        const contentPlan = parseV5Json<Record<string, unknown>>(packs[0].content_plan_json, {});
        const existingAdjustments = Array.isArray(contentPlan.executionAdjustments) ? contentPlan.executionAdjustments : [];
        const adjustment = {
          id: strategyAdjustmentId,
          sourceEvidenceId: id,
          observedAt: new Date().toISOString(),
          gaps,
          recommendedAdditionalArticles: Math.min(3, gaps.length),
          approvalBoundary: "execution_priority_only"
        };
        await connection.query(
          "UPDATE product_strategy_packs SET content_plan_json = ? WHERE id = ?",
          [stringifyV5Json({ ...contentPlan, executionAdjustments: [...existingAdjustments, adjustment] }), packs[0].id]
        );
      }
    }
    await connection.query(
      `INSERT INTO attribution_chain
       (id, source_event_id, platform, change_type, evidence_ids, strategy_adjustment_id, article_ids, outcome, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, NOW())`,
      [`attribution-${randomUUID()}`, input.taskId, task.platform, gaps[0]?.type || "capture_evidence_recorded", stringifyV5Json([id]), strategyAdjustmentId || null, strategyAdjustmentId ? "execution_strategy_adjusted" : "evidence_recorded"]
    );
    return { id, taskId: input.taskId, artifactHash: input.artifactHash, version, replayed: false };
  });
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
    manifest: value.manifest && typeof value.manifest === "object" && !Array.isArray(value.manifest) ? value.manifest as Record<string, unknown> : undefined
  };
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
       (task_id, product_id, question, question_version_id, published_content_id, source_publish_result_id,
        trigger_type, capture_condition, platform, status, attempt_count, idempotency_key, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published_content_retest', ?, ?, 'pending', 0, ?, 80, NOW())`,
      [taskId, input.productId, input.question, input.questionVersionId || null, input.publishedContentId,
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
