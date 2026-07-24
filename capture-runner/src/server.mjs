import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.V5_CAPTURE_RUNNER_PORT || 17321);
const WORKBENCH_URL = (process.env.V5_WORKBENCH_BASE_URL || "http://127.0.0.1:3047").replace(/\/$/, "");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const activeTaskIds = new Set();
let extensionHeartbeat;

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
  if (!origin.startsWith("chrome-extension://")) throw Object.assign(new Error("Only the Chrome companion may call this endpoint."), { status: 403 });
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
  const workspace = await workbench("/api/v5/frontend-capture/tasks");
  const task = workspace.tasks.find((item) => ["queued", "waiting_for_browser", "environment_checking"].includes(item.status) && !activeTaskIds.has(item.id));
  if (task) activeTaskIds.add(task.id);
  return task;
}

async function forwardStatus(taskId, payload) {
  if (!payload.task || payload.task.id !== taskId) throw Object.assign(new Error("Task identity mismatch."), { status: 422 });
  const data = await workbench(`/api/v5/frontend-capture/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "POST",
    body: JSON.stringify({
      ...runnerContext(payload.task, payload.note || "Runner 更新采集任务状态", "runner-status"),
      status: payload.status,
      note: payload.note || "Runner 更新采集任务状态",
      failure: payload.failure,
      adapterVersion: payload.adapterVersion,
      browserVersion: payload.browserVersion,
      manualIntervention: payload.manualIntervention === true
    })
  });
  if (["waiting_for_browser", "needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed", "cancelled"].includes(payload.status)) activeTaskIds.delete(taskId);
  return data;
}

async function forwardResult(taskId, payload) {
  if (!payload.task || payload.task.id !== taskId || payload.manifest?.taskId !== taskId) throw Object.assign(new Error("Capture result identity mismatch."), { status: 422 });
  const forbidden = sensitivePaths(payload.manifest);
  if (forbidden.length) throw Object.assign(new Error(`Capture result contains forbidden sensitive fields: ${forbidden.join(", ")}`), { status: 422 });
  try {
    return await workbench(`/api/v5/frontend-capture/tasks/${encodeURIComponent(taskId)}/artifact`, {
      method: "POST",
      body: JSON.stringify({ manifest: payload.manifest, context: runnerContext(payload.task, "Runner 上传经过筛选的不可变采集包", "runner-artifact") })
    });
  } finally {
    activeTaskIds.delete(taskId);
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
        runner: { status: "ready", endpoint: `http://${HOST}:${PORT}`, queueDepth: activeTaskIds.size, recoveryAction: "无需处理" },
        adapters: connected ? extensionHeartbeat.adapters : [{ platform: "chatgpt", status: "pending_config", message: "等待 Chrome 浏览器伴侣心跳。", recoveryAction: "加载扩展并打开 ChatGPT 页面。" }]
      });
      return;
    }

    assertExtensionOrigin(request);
    if (request.method === "POST" && url.pathname === "/extension/heartbeat") {
      const payload = await readJson(request);
      const forbidden = sensitivePaths(payload);
      if (forbidden.length) throw Object.assign(new Error(`Heartbeat contains forbidden fields: ${forbidden.join(", ")}`), { status: 422 });
      extensionHeartbeat = { extensionVersion: String(payload.extensionVersion || "unknown"), adapters: Array.isArray(payload.adapters) ? payload.adapters : [], receivedAt: new Date().toISOString() };
      send(response, 200, { ok: true }, origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/tasks/next") {
      send(response, 200, { ok: true, task: await nextTask() || null }, origin);
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
