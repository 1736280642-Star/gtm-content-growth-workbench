import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PLATFORMS, checkAuthorization, collectPlatformMetrics } from "./lib/content-metrics-adapters.mjs";

if (typeof process.loadEnvFile === "function" && existsSync(join(process.cwd(), ".env.local"))) process.loadEnvFile(join(process.cwd(), ".env.local"));

const host = process.env.CONTENT_METRICS_RUNNER_HOST || "127.0.0.1";
const port = Math.max(1, Number(process.env.CONTENT_METRICS_RUNNER_PORT || 9531));
const token = process.env.CONTENT_METRICS_RUNNER_TOKEN?.trim() || "";
const maximumBodyBytes = 2 * 1024 * 1024;
const lastAuthorization = new Map();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function authorized(request) {
  if (!token) return false;
  const received = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(token);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBodyBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, configured: Boolean(token), service: "joto-content-metrics-runner", configuredPlatforms: PLATFORMS.filter((platform) => platform === "wechat" ? process.env.WECHAT_MP_APP_ID && process.env.WECHAT_MP_APP_SECRET : process.env[`${platform.toUpperCase()}_COOKIE`]), checkedAt: new Date().toISOString() });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { ok: false, message: "Unauthorized metrics runner request." });
    return;
  }
  if (request.method === "GET" && url.pathname === "/auth/status") {
    const platforms = await Promise.all(PLATFORMS.map(async (platform) => {
      const current = await checkAuthorization(platform);
      const previous = lastAuthorization.get(platform);
      return current.status === "unverified" && previous ? previous : current;
    }));
    sendJson(response, 200, { ok: true, service: "joto-content-metrics-runner", platforms, checkedAt: new Date().toISOString() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/metrics/pull") {
    const body = await readJsonBody(request);
    const requestedPlatforms = Array.isArray(body.platforms) ? body.platforms.filter((platform) => PLATFORMS.includes(platform)) : PLATFORMS;
    const targets = Array.isArray(body.targets) ? body.targets.filter((target) => target && requestedPlatforms.includes(target.platform) && target.publishResultId) : [];
    const results = [];
    for (const platform of requestedPlatforms) {
      const result = await collectPlatformMetrics(platform, targets.filter((target) => target.platform === platform));
      lastAuthorization.set(platform, result.authorization);
      results.push(result);
    }
    const capturedAt = new Date().toISOString();
    const items = results.flatMap((result) => result.items.map((item) => ({
      publishResultId: item.publishResultId,
      platform: item.platform,
      capturedAt,
      views: item.views,
      likes: item.likes,
      favorites: item.favorites,
      source: "platform_backend"
    })));
    const errors = results.flatMap((result) => result.errors.map((error) => ({ platform: result.platform, ...error })));
    const status = errors.length ? items.length ? "partial" : "failed" : "completed";
    sendJson(response, status === "failed" ? 502 : 200, {
      accepted: status !== "failed",
      status,
      syncedPlatforms: results.filter((result) => result.items.length || !result.errors.length).map((result) => result.platform),
      capturedItems: items.length,
      items,
      authorization: results.map((result) => result.authorization),
      errors,
      message: status === "completed" ? "四平台指标采集完成。" : status === "partial" ? `已采集 ${items.length} 条，${errors.length} 条失败。` : `指标采集失败，共 ${errors.length} 条错误。`
    });
    return;
  }
  sendJson(response, 404, { ok: false, message: "Not found." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => sendJson(response, error instanceof SyntaxError ? 400 : error?.message === "request_body_too_large" ? 413 : 500, { ok: false, message: error instanceof Error ? error.message : "Metrics runner error." }));
});

server.listen(port, host, () => {
  console.log(`Content metrics runner listening on http://${host}:${port}`);
});
