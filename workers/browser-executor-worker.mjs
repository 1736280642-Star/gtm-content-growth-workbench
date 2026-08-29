import { setTimeout as delay } from "node:timers/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const apiBaseUrl = String(process.env.PUBLISH_EXECUTOR_API_BASE_URL || "http://workbench-web:3027").replace(/\/$/, "");
const runnerUrl = String(process.env.JOTO_PUBLISH_RUNNER_URL || "http://127.0.0.1:9530").replace(/\/$/, "");
const runnerToken = String(process.env.JOTO_PUBLISH_RUNNER_TOKEN || process.env.WECHATSYNC_BRIDGE_TOKEN || "").trim();
const executorType = process.env.PUBLISH_EXECUTOR_TYPE === "desktop_connector" ? "desktop_connector" : "cloud_browser";
const supportedChannels = ["zhihu", "csdn", "juejin"];
const adapterVersion = "2026-08-29-v2";
let nodeToken = String(process.env.PUBLISH_EXECUTOR_NODE_TOKEN || "").trim();
let nodeId = "";
const statePath = String(process.env.PUBLISH_EXECUTOR_STATE_PATH || "/app/runtime/browser-executor-node.json").trim();

async function loadNodeState() {
  if (nodeToken || !statePath) return;
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.executorType === executorType && state.apiBaseUrl === apiBaseUrl) {
      nodeToken = String(state.nodeToken || "").trim();
      nodeId = String(state.nodeId || "").trim();
    }
  } catch { /* First start has no durable node identity yet. */ }
}

async function saveNodeState() {
  if (!statePath || !nodeToken || !nodeId) return;
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, JSON.stringify({ nodeId, nodeToken, executorType, apiBaseUrl }), { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, statePath);
}

function assertRunnerUrl() {
  const parsed = new URL(runnerUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "host.docker.internal"].includes(parsed.hostname)) {
    throw new Error("JOTO_PUBLISH_RUNNER_URL must point to a private loopback or Docker host runner");
  }
  if (!runnerToken) throw new Error("JOTO_PUBLISH_RUNNER_TOKEN is required");
}

async function api(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(nodeToken ? { authorization: `Bearer ${nodeToken}` } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000)
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 204) throw new Error(String(payload.message || `executor API failed (${response.status})`));
  return payload;
}

async function runner(path, body) {
  const timeoutMs = path === "/publish" || path === "/publish/verify" ? 240_000 : 60_000;
  const response = await fetch(`${runnerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runnerToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function ensureRegistered() {
  await loadNodeState();
  if (nodeToken) return;
  const registrationSecret = String(process.env.PUBLISH_EXECUTOR_REGISTRATION_SECRET || "").trim();
  const pairingCode = String(process.env.PUBLISH_EXECUTOR_PAIRING_CODE || "").trim();
  if (executorType === "cloud_browser" && !registrationSecret) throw new Error("PUBLISH_EXECUTOR_REGISTRATION_SECRET is required");
  if (executorType === "desktop_connector" && !pairingCode) throw new Error("PUBLISH_EXECUTOR_PAIRING_CODE is required");
  const payload = await api("/api/v5/publish-executors/register", {
    method: "POST",
    body: JSON.stringify({ executorType, displayName: process.env.PUBLISH_EXECUTOR_DISPLAY_NAME || (executorType === "cloud_browser" ? "Cloud Browser Node" : "Desktop Connector"), supportedChannels, capacity: Number(process.env.PUBLISH_EXECUTOR_CAPACITY || 1), ...(registrationSecret ? { registrationSecret } : {}), ...(pairingCode ? { pairingCode } : {}) })
  });
  nodeToken = String(payload.nodeToken || "");
  nodeId = String(payload.nodeId || "");
  if (!nodeToken || !nodeId) throw new Error("executor registration did not return a node identity");
  await saveNodeState();
}

async function emit(authorizationSessionId, eventType, payload = {}) {
  await api("/api/v5/publish-executors/authorization-events", { method: "POST", body: JSON.stringify({ authorizationSessionId, eventType, payload }) });
}

async function complete(job, ok, result = {}, failureCode, failureMessage) {
  await api(`/api/v5/publish-executors/jobs/${encodeURIComponent(job.jobId)}/complete`, { method: "POST", body: JSON.stringify({ leaseToken: job.leaseToken, ok, result, failureCode, failureMessage }) });
}

async function authorize(job) {
  const authorizationSessionId = String(job.authorizationSessionId || job.command?.authorizationSessionId || "");
  const platform = String(job.channel || "");
  const profileRef = String(job.command?.browserProfileRef || "");
  try {
    const opened = await runner("/auth/connect", { platform, profileRef });
    if (!opened.response.ok || opened.payload.ok !== true) {
      await emit(authorizationSessionId, "failed", { failureCode: "browser_open_failed", message: String(opened.payload.message || "安全浏览器启动失败") });
      await complete(job, false, {}, "browser_open_failed", String(opened.payload.message || "安全浏览器启动失败"));
      return;
    }
    const interactiveUrl = (() => {
      try {
        const value = new URL(String(opened.payload.interactiveUrl || ""));
        return value.protocol === "https:" ? value.toString() : undefined;
      } catch { return undefined; }
    })();
    await emit(
      authorizationSessionId,
      opened.payload.status === "manual_takeover_required" ? "manual_takeover_required" : "window_opened",
      { message: String(opened.payload.message || "安全浏览器已打开"), ...(interactiveUrl ? { interactiveUrl } : {}) }
    );
    const deadline = Date.now() + 14 * 60_000;
    let lastReportedStatus = "";
    while (Date.now() < deadline) {
      await api("/api/v5/publish-executors/heartbeat", { method: "POST", body: JSON.stringify({ adapterVersion, supportedChannels }) });
      const identified = await runner("/auth/identify", { platform, profileRef });
      if (identified.response.ok && identified.payload.identified === true && identified.payload.account) {
        await emit(authorizationSessionId, "account_detected", { account: identified.payload.account });
        await complete(job, true, { status: "account_detected" });
        return;
      }
      const status = String(identified.payload.status || "");
      if (status === "failed") {
        await emit(authorizationSessionId, "failed", { failureCode: String(identified.payload.failureCode || "account_check_failed"), message: String(identified.payload.message || "账号检查页面不可用") });
        await complete(job, false, {}, String(identified.payload.failureCode || "account_check_failed"), String(identified.payload.message || "账号检查页面不可用"));
        return;
      }
      if (status !== lastReportedStatus) {
        if (status === "manual_takeover_required") {
          await emit(authorizationSessionId, "manual_takeover_required", { message: String(identified.payload.message || "需要人工安全验证") });
        } else {
          await emit(authorizationSessionId, "waiting_for_login", { message: String(identified.payload.message || "等待用户登录并识别公开账号") });
        }
        lastReportedStatus = status;
      }
      await delay(3000);
    }
    await emit(authorizationSessionId, "failed", { failureCode: "authorization_timed_out", message: "账号登录等待超时" });
    await complete(job, false, {}, "authorization_timed_out", "账号登录等待超时");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "浏览器执行失败";
    await emit(authorizationSessionId, "failed", { failureCode: "executor_failed", message }).catch(() => undefined);
    await complete(job, false, {}, "executor_failed", message).catch(() => undefined);
  }
}

async function executeRunnerJob(job) {
  try {
    const path = job.operation === "publish" ? "/publish" : "/publish/verify";
    const execution = await runner(path, { platform: String(job.channel || ""), ...(job.command || {}) });
    const ok = execution.response.ok && execution.payload.ok !== false;
    await complete(
      job,
      ok,
      execution.payload,
      ok ? undefined : String(execution.payload.failureCode || "executor_failed"),
      ok ? undefined : String(execution.payload.failureReason || execution.payload.message || "浏览器执行失败")
    );
  } catch (error) {
    const publishActionUnconfirmed = job.operation === "publish";
    await complete(
      job,
      false,
      {},
      publishActionUnconfirmed ? "publish_action_unconfirmed" : "executor_failed",
      publishActionUnconfirmed
        ? "发布执行超时或中断，平台动作可能已经发生；只允许继续执行只读验证。"
        : error instanceof Error ? error.message.slice(0, 500) : "浏览器执行失败"
    ).catch(() => undefined);
  }
}

async function run() {
  await loadNodeState();
  const registrationConfigured = executorType === "cloud_browser"
    ? Boolean(String(process.env.PUBLISH_EXECUTOR_REGISTRATION_SECRET || "").trim())
    : Boolean(String(process.env.PUBLISH_EXECUTOR_PAIRING_CODE || "").trim());
  if (!runnerToken || !nodeToken && !registrationConfigured) {
    console.error("[browser-executor] pending_config: runner token and executor registration are required; no jobs will be claimed");
    while (true) await delay(30_000);
  }
  assertRunnerUrl();
  await ensureRegistered();
  console.log(`[browser-executor] node ready type=${executorType} channels=${supportedChannels.join(",")}`);
  while (true) {
    await api("/api/v5/publish-executors/heartbeat", { method: "POST", body: JSON.stringify({ adapterVersion, supportedChannels, capacity: Number(process.env.PUBLISH_EXECUTOR_CAPACITY || 1) }) });
    const claimed = await api("/api/v5/publish-executors/jobs/claim", { method: "POST", body: "{}" });
    if (claimed.job?.operation === "authorize") await authorize(claimed.job);
    else if (["publish", "verify"].includes(String(claimed.job?.operation || ""))) await executeRunnerJob(claimed.job);
    else if (claimed.job) await complete(claimed.job, false, {}, "operation_unsupported", `unsupported operation: ${String(claimed.job.operation)}`);
    await delay(Number(process.env.PUBLISH_EXECUTOR_POLL_INTERVAL_MS || 2000));
  }
}

run().catch((error) => {
  console.error(`[browser-executor] stopped: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
