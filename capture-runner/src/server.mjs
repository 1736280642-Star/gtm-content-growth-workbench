import http from "node:http";
import { createHash } from "node:crypto";
import { loadProjectEnv } from "../../scripts/load-project-env.mjs";

loadProjectEnv();

const HOST = "127.0.0.1";
const PORT = Number(process.env.V5_CAPTURE_RUNNER_PORT || 17321);
const WORKBENCH_URL = (process.env.V5_WORKBENCH_BASE_URL || "http://127.0.0.1:3027").replace(/\/$/, "");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ACTIVE_TASK_TIMEOUT_MS = 6 * 60 * 1000;
const CAPTURE_PLATFORM_ORDER = ["doubao", "deepseek", "qwen", "chatgpt"];
const activeTasks = new Map();
const DEVICE_ID = process.env.V5_CAPTURE_DEVICE_ID || "local-chrome-companion";
const EXTENSION_ID = String(process.env.V5_CAPTURE_EXTENSION_ID || "").trim();
let extensionHeartbeat;
let lastTaskFailure;
let lastNextTaskPoll;
let lastLeasedPlatform;

function releaseStaleActiveTasks(now = Date.now()) {
  for (const [taskId, startedAt] of activeTasks) {
    if (now - startedAt > ACTIVE_TASK_TIMEOUT_MS) activeTasks.delete(taskId);
  }
}

function send(response, status, body, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin?.startsWith("chrome-extension://") ? { "access-control-allow-origin": origin } : {})
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function assertExtensionOrigin(request) {
  const origin = request.headers.origin || "";
  const expectedOrigin = EXTENSION_ID ? `chrome-extension://${EXTENSION_ID}` : undefined;
  if (expectedOrigin ? origin !== expectedOrigin : !origin.startsWith("chrome-extension://")) {
    throw Object.assign(new Error("Only the paired Chrome companion may call this endpoint."), { status: 403 });
  }
  if (!expectedOrigin && process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("V5_CAPTURE_EXTENSION_ID is required in production."), { status: 503 });
  }
  return origin;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the 25 MB local capture limit."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

function sensitivePaths(value, trail = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => sensitivePaths(item, [...trail, String(index)]));
  const forbidden = /^(?:cookies?|cookieheaders?|passwords?|passwd|authorization|localstorage|sessionstorage|autofill|requestheaders?|(?:access|refresh|auth|oauth|api|bearer|id|csrf|private|secret|session)?tokens?)$/;
  return Object.entries(value).flatMap(([key, item]) =>
    forbidden.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
      ? [[...trail, key].join(".")]
      : sensitivePaths(item, [...trail, key])
  );
}

async function workbench(path, options = {}) {
  const response = await fetch(`${WORKBENCH_URL}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    const message = body?.error?.message || `Workbench request failed: ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body.data;
}

function runnerContext(task, reason, scope) {
  return {
    actor: { actorId: "local-capture-runner", actorRole: "capture_runner", actorType: "runner" },
    reason,
    idempotencyKey: `${scope}-${task.id}-${task.version}`,
    expectedVersion: task.version
  };
}

async function nextTask() {
  const supported = new Set((extensionHeartbeat?.adapters || []).filter((item) => item.status === "ready").map((item) => item.platform));
  if (!supported.size) return undefined;
  const now = Date.now();
  releaseStaleActiveTasks(now);
  if (activeTasks.size) return undefined;
  const response = await workbench(`/api/v5/capture-tasks?deviceId=${encodeURIComponent(DEVICE_ID)}`);
  const candidates = response.tasks.filter((item) => {
    const expiredOwnLease = item.status === "leased"
      && item.deviceId === DEVICE_ID
      && item.leaseExpiresAt
      && Date.parse(item.leaseExpiresAt) <= now;
    return (item.status === "pending" || expiredOwnLease)
      && !activeTasks.has(item.taskId)
      && supported.has(item.platform);
  });
  const lastPlatformIndex = CAPTURE_PLATFORM_ORDER.indexOf(lastLeasedPlatform);
  const platformOrder = [
    ...CAPTURE_PLATFORM_ORDER.slice(lastPlatformIndex + 1),
    ...CAPTURE_PLATFORM_ORDER.slice(0, lastPlatformIndex + 1)
  ];
  const task = platformOrder
    .filter((platform) => supported.has(platform))
    .map((platform) => candidates.find((item) => item.platform === platform))
    .find(Boolean) || candidates[0];
  if (!task) return undefined;
  await workbench(`/api/v5/capture-tasks/${encodeURIComponent(task.taskId)}/lease`, {
    method: "POST", body: JSON.stringify({ deviceId: DEVICE_ID, durationMs: 10 * 60 * 1000 })
  });
  activeTasks.set(task.taskId, now);
  lastLeasedPlatform = task.platform;
  return { ...task, id: task.taskId, questionText: task.question, version: task.attemptCount + 1, condition: task.captureCondition };
}

async function forwardStatus(taskId, payload) {
  if (!payload.task || payload.task.id !== taskId) throw Object.assign(new Error("Task identity mismatch."), { status: 422 });
  const data = { taskId, status: payload.status, note: payload.note || "Runner 更新采集任务状态" };
  if (["waiting_for_browser", "needs_login", "isolation_unverified", "adapter_mismatch", "interrupted", "timed_out", "capture_failed", "cancelled"].includes(payload.status)) {
    activeTasks.delete(taskId);
    lastTaskFailure = {
      taskId,
      platform: payload.task.platform,
      status: payload.status,
      note: payload.note,
      failure: payload.failure,
      receivedAt: new Date().toISOString()
    };
    if (payload.status !== "waiting_for_browser") {
      await workbench(`/api/v5/capture-tasks/${encodeURIComponent(taskId)}/status`, {
        method: "POST",
        body: JSON.stringify({ deviceId: DEVICE_ID, status: payload.status, note: payload.note })
      });
    }
  }
  return data;
}

async function forwardResult(taskId, payload) {
  if (!payload.task || payload.task.id !== taskId || payload.manifest?.taskId !== taskId) throw Object.assign(new Error("Capture result identity mismatch."), { status: 422 });
  const forbidden = sensitivePaths(payload.manifest);
  if (forbidden.length) throw Object.assign(new Error(`Capture result contains forbidden sensitive fields: ${forbidden.join(", ")}`), { status: 422 });
  const manifest = payload.manifest;
  const evidence = {
    contractVersion: "frontend-capture-evidence.v1",
    answerText: String(manifest.answerText || ""),
    answerHtmlSanitized: manifest.answerHtmlSanitized,
    citations: Array.isArray(manifest.citations) ? manifest.citations : [],
    gaps: Array.isArray(manifest.gaps) ? manifest.gaps : [],
    targetEntity: manifest.targetEntity,
    targetEntityMentioned: manifest.targetEntityMentioned,
    adapterVersion: manifest.adapterVersion,
    browserVersion: manifest.browserVersion,
    isolationAttestation: manifest.isolationAttestation,
    manifest: {
      captureSessionId: manifest.captureSessionId,
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
      completionSignals: manifest.completionSignals,
      captureWarnings: manifest.captureWarnings,
      screenshot: manifest.screenshot ? {
        mimeType: manifest.screenshot.mimeType,
        redactionsApplied: manifest.screenshot.redactionsApplied,
        viewport: manifest.screenshot.viewport,
        sha256: createHash("sha256").update(String(manifest.screenshot.dataBase64 || ""), "base64").digest("hex")
      } : undefined
    }
  };
  const artifactHash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  try {
    return await workbench("/api/v5/capture-evidence", {
      method: "POST",
      body: JSON.stringify({ taskId, artifactHash, deviceId: DEVICE_ID, collectedBy: "local-chrome-companion", payload: evidence })
    });
  } finally {
    activeTasks.delete(taskId);
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    try {
      const allowedOrigin = assertExtensionOrigin(request);
      response.writeHead(204, { "access-control-allow-origin": allowedOrigin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" });
      response.end();
    } catch (error) { send(response, error.status || 500, { ok: false, error: error.message }, origin); }
    return;
  }

  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/status") {
      const heartbeatAge = extensionHeartbeat ? Date.now() - Date.parse(extensionHeartbeat.receivedAt) : Infinity;
      const connected = heartbeatAge < 90000;
      send(response, 200, {
        checkedAt: new Date().toISOString(),
        source: "local_runner",
        extension: { status: connected ? "connected" : "disconnected", version: extensionHeartbeat?.extensionVersion, lastHeartbeatAt: extensionHeartbeat?.receivedAt, privacy: { cookieUpload: false, passwordUpload: false, tokenUpload: false, taskPageOnly: true } },
        runner: { status: "ready", endpoint: `http://${HOST}:${PORT}`, queueDepth: activeTasks.size, recoveryAction: "无需处理", lastTaskFailure, lastNextTaskPoll },
        adapters: connected ? extensionHeartbeat.adapters : [
          { platform: "doubao", status: "pending_config", message: "等待豆包适配器心跳。", recoveryAction: "加载扩展并打开豆包页面。" },
          { platform: "deepseek", status: "pending_config", message: "等待 DeepSeek 适配器心跳。", recoveryAction: "加载扩展并打开 DeepSeek 页面。" },
          { platform: "chatgpt", status: "pending_config", message: "等待 ChatGPT 适配器心跳。", recoveryAction: "加载扩展并打开 ChatGPT 页面。" },
          { platform: "qwen", status: "pending_config", message: "等待千问适配器心跳。", recoveryAction: "加载扩展并打开千问页面。" }
        ]
      });
      return;
    }

    assertExtensionOrigin(request);
    if (request.method === "POST" && url.pathname === "/extension/heartbeat") {
      const payload = await readJson(request);
      const forbidden = sensitivePaths(payload);
      if (forbidden.length) throw Object.assign(new Error(`Heartbeat contains forbidden fields: ${forbidden.join(", ")}`), { status: 422 });
      extensionHeartbeat = { extensionVersion: String(payload.extensionVersion || "unknown"), adapters: Array.isArray(payload.adapters) ? payload.adapters : [], receivedAt: new Date().toISOString() };
      try {
        await workbench(`/api/v5/capture-devices/${encodeURIComponent(DEVICE_ID)}/heartbeat`, {
          method: "PUT", body: JSON.stringify({ status: "online", adapterVersion: extensionHeartbeat.extensionVersion })
        });
      } catch (error) {
        if (error.status === 404 || error.status === 403) {
          send(response, 200, { ok: true, paired: false, nextAction: "Enter a one-time pairing code in the extension popup." }, origin);
          return;
        }
        throw error;
      }
      send(response, 200, { ok: true, paired: true }, origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/extension/pair") {
      const payload = await readJson(request);
      const pairingCode = String(payload.pairingCode || "").trim();
      if (!pairingCode) throw Object.assign(new Error("Pairing code is required."), { status: 400 });
      const device = await workbench("/api/v5/capture-devices", {
        method: "POST",
        body: JSON.stringify({ deviceId: DEVICE_ID, pairingCode, platforms: CAPTURE_PLATFORM_ORDER })
      });
      send(response, 201, { ok: true, device: { deviceId: device.deviceId, status: device.status, platforms: device.platforms } }, origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/extension/connections") {
      const payload = await readJson(request);
      const connection = await workbench("/api/v5/ai-frontend-connections", {
        method: "POST",
        body: JSON.stringify({
          deviceId: DEVICE_ID,
          platform: payload.platform,
          accountAlias: payload.accountAlias,
          browserProfileSlot: payload.browserProfileSlot || "default",
          isolationPolicy: payload.isolationPolicy
        })
      });
      send(response, 201, { ok: true, connection }, origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/tasks/next") {
      const task = await nextTask();
      lastNextTaskPoll = { receivedAt: new Date().toISOString(), taskId: task?.id || null, platform: task?.platform || null };
      send(response, 200, { ok: true, task: task || null }, origin);
      return;
    }
    const statusMatch = url.pathname.match(/^\/tasks\/([^/]+)\/status$/);
    if (request.method === "POST" && statusMatch) {
      send(response, 200, { ok: true, data: await forwardStatus(decodeURIComponent(statusMatch[1]), await readJson(request)) }, origin);
      return;
    }
    const resultMatch = url.pathname.match(/^\/tasks\/([^/]+)\/result$/);
    if (request.method === "POST" && resultMatch) {
      send(response, 201, { ok: true, data: await forwardResult(decodeURIComponent(resultMatch[1]), await readJson(request)) }, origin);
      return;
    }
    send(response, 404, { ok: false, error: "Local Runner endpoint not found." }, origin);
  } catch (error) {
    send(response, error.status || 500, { ok: false, error: error.message || "Local Runner failed." }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`V5 capture Runner listening on http://${HOST}:${PORT}`);
  console.log(`Workbench API: ${WORKBENCH_URL}`);
});
