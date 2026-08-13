import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWeixinArticleContent } from "./lib/wechatsync-content.mjs";
import { createPublishIdempotencyLedger } from "./lib/publish-idempotency.mjs";
import { createBrowserPublishJobStore } from "./lib/browser-publish-job-store.mjs";
import { createCsdnGatewayHeaders } from "./lib/csdn-api-gateway.mjs";
import { enforceCsdnContentFields, prepareCsdnArticleContent } from "./lib/csdn-content-format.mjs";
import { submitAndPollWechatPublish, verifyWechatPublish } from "./lib/wechat-formal-publish.mjs";
import { rewriteWorkbenchMediaSources } from "./lib/workbench-media-rewrite.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(join(projectRoot, ".env.local"));

const port = Number(process.env.WECHATSYNC_BRIDGE_PORT || 9528);
const bindHost = process.env.WECHATSYNC_BRIDGE_HOST || "127.0.0.1";
const bridgeToken = process.env.WECHATSYNC_BRIDGE_TOKEN || "";
const wechatApiBase = (process.env.WECHAT_MP_API_BASE_URL || "https://api.weixin.qq.com").replace(/\/$/, "");
const mediaLibraryStatePath = isAbsolute(process.env.V5_MEDIA_LIBRARY_STATE_PATH || "")
  ? process.env.V5_MEDIA_LIBRARY_STATE_PATH
  : resolve(projectRoot, process.env.V5_MEDIA_LIBRARY_STATE_PATH || "data/v5-media-library.json");
const mediaLibraryStoragePath = isAbsolute(process.env.V5_MEDIA_LIBRARY_STORAGE_PATH || "")
  ? process.env.V5_MEDIA_LIBRARY_STORAGE_PATH
  : resolve(projectRoot, process.env.V5_MEDIA_LIBRARY_STORAGE_PATH || "data/v5-media-library-assets");
const externalPlatformTimeoutMs = Number(process.env.WECHATSYNC_PLATFORM_TIMEOUT_MS || 30_000);
const implementedPlatforms = ["weixin", "csdn", "juejin", "zhihu"];
const arcsRunnerUrl = process.env.ARCS_RUNNER_URL || "http://127.0.0.1:9530";
const publishLedgerPath =
  process.env.JOTO_PUBLISH_BRIDGE_LEDGER_PATH ||
  join(process.env.LOCALAPPDATA || join(homedir(), ".joto"), "JotoPublishRunner", "bridge-ledger.json");
const publishLedger = createPublishIdempotencyLedger(publishLedgerPath);
const browserPublishJobStorePath =
  process.env.JOTO_BROWSER_PUBLISH_JOB_STORE_PATH ||
  join(process.env.LOCALAPPDATA || join(homedir(), ".joto"), "JotoPublishRunner", "browser-publish-jobs.json");
const browserPublishJobStore = createBrowserPublishJobStore(browserPublishJobStorePath, {
  leaseMs: Number(process.env.JOTO_BROWSER_PUBLISH_JOB_LEASE_MS || 120_000)
});
const browserExtensionPlatforms = new Set(
  String(process.env.PUBLISH_BROWSER_EXTENSION_PLATFORMS || (process.env.PUBLISH_BROWSER_EXTENSION_ENABLED === "true" ? "juejin" : ""))
    .split(",")
    .map((item) => item.trim())
    .filter((item) => ["juejin", "csdn", "zhihu"].includes(item))
);
const juejinPageContextPublishEnabled = process.env.JUEJIN_PAGE_CONTEXT_PUBLISH_ENABLED !== "false";
const publishExtensionId = String(process.env.JOTO_PUBLISH_EXTENSION_ID || "amejiagagacknhmkjgnefkhpbikkbedo").trim();
const extensionHeartbeats = new Map();
let cachedAccessToken;

function isLoopbackUrl(value) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(bindHost)) {
  throw new Error("WECHATSYNC_BRIDGE_HOST must be a loopback host.");
}

if (!bridgeToken) {
  throw new Error("WECHATSYNC_BRIDGE_TOKEN is required.");
}

if (!isLoopbackUrl(arcsRunnerUrl)) {
  throw new Error("ARCS_RUNNER_URL must point to localhost.");
}

const ledgerRelativePath = relative(projectRoot, resolve(publishLedgerPath));
if (!ledgerRelativePath.startsWith("..") && !isAbsolute(ledgerRelativePath)) {
  throw new Error("JOTO_PUBLISH_BRIDGE_LEDGER_PATH must be outside the repository.");
}
const browserJobStoreRelativePath = relative(projectRoot, resolve(browserPublishJobStorePath));
if (!browserJobStoreRelativePath.startsWith("..") && !isAbsolute(browserJobStoreRelativePath)) {
  throw new Error("JOTO_BROWSER_PUBLISH_JOB_STORE_PATH must be outside the repository.");
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();

      if (!text) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function verifyBridgeToken(request) {
  return Boolean(bridgeToken) && request.headers.authorization === `Bearer ${bridgeToken}`;
}

function verifyPublishExtensionOrigin(request) {
  return request.headers.origin === `chrome-extension://${publishExtensionId}`;
}

function expectedIdempotencyKey(input) {
  return createHash("sha256")
    .update(`${input.scheduleId}:${input.platform === "weixin" ? "wechat" : input.platform}:${input.contentHash}`, "utf8")
    .digest("hex");
}

function validateFormalPublishInput(input) {
  const required = ["scheduleId", "platform", "contentHash", "idempotencyKey", "title", "markdown"];
  const missing = required.filter((name) => !String(input[name] || "").trim());
  if (missing.length) {
    return { ok: false, statusCode: 400, payload: { ok: false, status: "precheck_failed", failureCode: "payload_invalid", failureReason: `缺少正式发布字段：${missing.join(", ")}`, nextAction: "请从 V5 发布排程重新发起，不要直接调用 bridge。" } };
  }
  if (input.idempotencyKey !== expectedIdempotencyKey(input)) {
    return { ok: false, statusCode: 400, payload: { ok: false, status: "precheck_failed", failureCode: "payload_invalid", failureReason: "idempotencyKey 与 scheduleId、platform、contentHash 不匹配。", nextAction: "请重新创建发布排程。" } };
  }
  return { ok: true };
}

async function proxyArcs(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, Number(process.env.ARCS_RUNNER_TIMEOUT_MS || 120_000)));
  try {
    const response = await fetch(`${arcsRunnerUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return { response, payload: await response.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

function getWeixinMissingConfig(coverImageRef, options = {}) {
  const missingConfig = ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"].filter((name) => !process.env[name]?.trim());

  if (!options.skipCover && !coverImageRef && !process.env.WECHAT_MP_THUMB_MEDIA_ID?.trim() && !process.env.WECHAT_MP_THUMB_IMAGE_PATH?.trim()) {
    missingConfig.push("WECHAT_MP_THUMB_MEDIA_ID 或 WECHAT_MP_THUMB_IMAGE_PATH");
  }

  return missingConfig;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToWechatHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = Math.min(3, heading[1].length + 1);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    blocks.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return blocks.join("\n");
}

function createDigest(markdown) {
  const text = String(markdown || "")
    .replace(/[#>*_`[\]()]|https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 120);
}

function splitEnvList(value) {
  return String(value || "")
    .split(/\r?\n|[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCookieValue(cookieHeader, name) {
  const cookie = String(cookieHeader || "");
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function parseJsonEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getExtraHeaders(name) {
  const value = parseJsonEnv(name);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function applyTemplate(value, replacements) {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*(title|markdown|html|summary|tagsCsv)\s*\}\}/g, (_, key) => replacements[key] || "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyTemplate(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyTemplate(item, replacements)]));
  }

  return value;
}

function markdownToSimpleHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = Math.min(4, heading[1].length);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      listItems.push(unordered[1]);
      continue;
    }

    flushList();
    blocks.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return blocks.join("\n");
}

function getPlatformInput(input) {
  const title = String(input.title || "").trim();
  const markdown = String(input.markdown || input.content || "").trim();
  const html = markdownToSimpleHtml(markdown);
  const summary = String(input.summary || "").trim() || createDigest(markdown);

  return {
    title,
    markdown,
    html,
    summary
  };
}

function assertArticleInput(input) {
  if (!input.title || !input.markdown) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "invalid_input",
        message: "标题和正文不能为空。"
      }
    };
  }

  return { ok: true };
}

async function fetchJson(url, init = {}, timeoutMs = externalPlatformTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { rawText: text.slice(0, 500) };
    }

    return { response, payload, text };
  } finally {
    clearTimeout(timer);
  }
}

function getPayloadMessage(payload, fallback) {
  return (
    payload?.message ||
    payload?.msg ||
    payload?.errmsg ||
    payload?.error_msg ||
    payload?.error?.message ||
    payload?.rawText ||
    fallback
  );
}

function isBusinessSuccess(response, payload) {
  if (!response.ok) return false;
  if (typeof payload?.code === "number" && payload.code !== 0 && payload.code !== 200) return false;
  if (typeof payload?.err_no === "number" && payload.err_no !== 0) return false;
  if (typeof payload?.error_code === "number" && payload.error_code !== 0) return false;
  if (payload?.success === false) return false;
  return true;
}

function platformFetchFailure(platformLabel, response, payload) {
  const statusCode = response.status === 401 || response.status === 403 ? 401 : response.status >= 500 ? 502 : 400;
  const errorCode = response.status === 401 || response.status === 403 ? "auth_required" : "sync_failed";

  return {
    ok: false,
    statusCode,
    payload: {
      errorCode,
      message: `${platformLabel} 草稿创建失败：${getPayloadMessage(payload, `HTTP ${response.status}`)}`,
      externalErrorCode: payload?.code || payload?.err_no || payload?.error_code
    }
  };
}

function createMissingConfigResult(platformLabel, missingConfig) {
  return {
    authenticated: false,
    message: `${platformLabel} 草稿缺少配置：${missingConfig.join(", ")}`,
    nextAction: "请补齐对应平台 Cookie / 标签 / API 覆盖配置；只需要填配置项，不要把密钥或 Cookie 发到聊天里。"
  };
}

function getCsdnMissingConfig() {
  const missingConfig = ["CSDN_COOKIE", "CSDN_API_GATEWAY_KEY", "CSDN_API_GATEWAY_SIGNING_KEY"].filter((name) => !process.env[name]?.trim());
  if (!splitEnvList(process.env.CSDN_TAGS).length) missingConfig.push("CSDN_TAGS");
  return missingConfig;
}

function getJuejinMissingConfig() {
  const missingConfig = ["JUEJIN_COOKIE", "JUEJIN_CATEGORY_LABEL", "JUEJIN_TAG_LABELS"].filter((name) => !process.env[name]?.trim());

  if (!splitEnvList(process.env.JUEJIN_TAG_IDS).length) {
    missingConfig.push("JUEJIN_TAG_IDS");
  }

  return missingConfig;
}

function getZhihuMissingConfig() {
  return ["ZHIHU_COOKIE"].filter((name) => !process.env[name]?.trim());
}

async function checkCookiePlatformAuth(platform, platformLabel, cookieEnvName, extraHeadersEnvName) {
  const cookie = process.env[cookieEnvName]?.trim();
  const authCheckUrl = process.env[`${platform.toUpperCase()}_AUTH_CHECK_URL`]?.trim();

  if (!cookie) {
    return createMissingConfigResult(platformLabel, [cookieEnvName]);
  }

  if (!authCheckUrl) {
    return {
      authenticated: true,
      message: `${platformLabel} adapter 配置已具备；发送草稿时会由平台接口校验登录态。`,
      nextAction: "可以发送草稿；如返回需登录，请更新该平台 Cookie 或补 AUTH_CHECK_URL 做登录态诊断。"
    };
  }

  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: cookie,
    "User-Agent": process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0",
    ...getExtraHeaders(extraHeadersEnvName)
  };
  const { response, payload } = await fetchJson(authCheckUrl, { method: "GET", headers });

  if (isBusinessSuccess(response, payload)) {
    return {
      authenticated: true,
      message: `${platformLabel} 登录态检查通过。`,
      nextAction: "可以发送平台草稿。"
    };
  }

  return {
    authenticated: false,
    message: `${platformLabel} 登录态检查失败：${getPayloadMessage(payload, `HTTP ${response.status}`)}`,
    nextAction: `请在浏览器中重新登录 ${platformLabel}，更新 ${cookieEnvName}，或补充平台要求的 headers。`
  };
}

async function getWeixinAccessToken() {
  const missingConfig = ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"].filter((name) => !process.env[name]?.trim());

  if (missingConfig.length) {
    return { ok: false, missingConfig, message: `缺少配置：${missingConfig.join(", ")}` };
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, accessToken: cachedAccessToken.value };
  }

  const url = new URL(`${wechatApiBase}/cgi-bin/token`);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", process.env.WECHAT_MP_APP_ID);
  url.searchParams.set("secret", process.env.WECHAT_MP_APP_SECRET);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    const errcode = payload.errcode;
    const errmsg = payload.errmsg || `HTTP ${response.status}`;
    return {
      ok: false,
      errcode,
      message: `微信 access_token 获取失败：${errmsg}`,
      nextAction:
        errcode === 40164 || errcode === 89503
          ? "请在微信公众平台后台确认服务器 IP 白名单或管理员风险确认。"
          : "请检查公众号 AppID/AppSecret 是否有效。"
    };
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in || 7200) - 300) * 1000
  };

  return { ok: true, accessToken: cachedAccessToken.value };
}

function getImageMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".jpeg" || ext === ".jpg") return "image/jpeg";

  return "application/octet-stream";
}

function resolveProjectPath(filePath) {
  return isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
}

async function getWeixinThumbMediaId(accessToken, coverImageRef) {
  const requestedRef = String(coverImageRef || "").trim();
  if (requestedRef.startsWith("media_id:")) {
    const mediaId = requestedRef.slice("media_id:".length).trim();
    return mediaId ? { ok: true, mediaId } : { ok: false, message: "封面 media_id 不能为空。" };
  }
  if (/^https?:\/\//i.test(requestedRef)) {
    return { ok: false, message: "远程封面 URL 不会由 bridge 直接下载；请传 media_id:<id> 或工作台本地图片路径。" };
  }
  const thumbImagePath = requestedRef || process.env.WECHAT_MP_THUMB_IMAGE_PATH?.trim();

  if (!thumbImagePath) {
    const thumbMediaId = process.env.WECHAT_MP_THUMB_MEDIA_ID?.trim();

    if (!thumbMediaId) {
      return {
        ok: false,
        message: "缺少微信公众号封面配置：WECHAT_MP_THUMB_MEDIA_ID 或 WECHAT_MP_THUMB_IMAGE_PATH"
      };
    }

    return { ok: true, mediaId: thumbMediaId };
  }

  const resolvedPath = resolveProjectPath(thumbImagePath);

  if (!existsSync(resolvedPath)) {
    return {
      ok: false,
      message: `微信公众号封面图片不存在：${resolvedPath}`
    };
  }

  const url = new URL(`${wechatApiBase}/cgi-bin/material/add_material`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", "image");

  const form = new FormData();
  const imageBlob = new Blob([readFileSync(resolvedPath)], { type: getImageMimeType(resolvedPath) });
  form.append("media", imageBlob, basename(resolvedPath));

  const response = await fetch(url, {
    method: "POST",
    body: form
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.media_id) {
    return {
      ok: false,
      errcode: payload.errcode,
      message: `微信公众号封面永久素材上传失败：${payload.errmsg || `HTTP ${response.status}`}`
    };
  }

  process.env.WECHAT_MP_THUMB_MEDIA_ID = payload.media_id;

  return {
    ok: true,
    mediaId: payload.media_id
  };
}

async function checkAuth(platform) {
  if (platform !== "weixin") {
    if (platform === "csdn") {
      const missingConfig = getCsdnMissingConfig();
      return missingConfig.length
        ? createMissingConfigResult("CSDN", missingConfig)
        : checkCookiePlatformAuth("csdn", "CSDN", "CSDN_COOKIE", "CSDN_HEADERS_JSON");
    }

    if (platform === "juejin") {
      const missingConfig = getJuejinMissingConfig();
      return missingConfig.length
        ? createMissingConfigResult("掘金", missingConfig)
        : checkCookiePlatformAuth("juejin", "掘金", "JUEJIN_COOKIE", "JUEJIN_HEADERS_JSON");
    }

    if (platform === "zhihu") {
      const missingConfig = getZhihuMissingConfig();
      return missingConfig.length
        ? createMissingConfigResult("知乎", missingConfig)
        : checkCookiePlatformAuth("zhihu", "知乎", "ZHIHU_COOKIE", "ZHIHU_HEADERS_JSON");
    }

    return {
      authenticated: false,
      message: `平台 ${platform} 尚未接入真实 bridge。`,
      nextAction: "请先补该平台 adapter，再发送平台草稿。"
    };
  }

  const missingConfig = getWeixinMissingConfig(undefined, { skipCover: true });
  if (missingConfig.length) {
    return {
      authenticated: false,
      message: `微信公众号草稿缺少配置：${missingConfig.join(", ")}`,
      nextAction: "请配置公众号 AppID、AppSecret 和永久封面素材 media_id。"
    };
  }

  const token = await getWeixinAccessToken();
  if (!token.ok) {
    return {
      authenticated: false,
      message: token.message,
      nextAction: token.nextAction || "请检查公众号开发配置。"
    };
  }

  return {
    authenticated: true,
    message: "微信公众号 API 配置可用。",
    nextAction: "可以发送草稿；发送后仍需到公众号后台人工预览和发布。"
  };
}

async function checkFormalPublishAuth(platform) {
  console.log(`Formal auth probe: platform=${platform}, extension=${browserExtensionPlatforms.has(platform)}, pageContext=${platform === "juejin" && juejinPageContextPublishEnabled}`);
  if (platform === "weixin") {
    const result = await checkAuth(platform);
    return {
      ...result,
      status: result.authenticated ? "ready" : result.message?.includes("缺少配置") ? "pending_config" : "auth_required"
    };
  }

  if (browserExtensionPlatforms.has(platform)) {
    const timeBucket = Math.floor(Date.now() / 60_000);
    const queued = browserPublishJobStore.enqueue({
      platform,
      idempotencyKey: `auth-probe:${platform}:${timeBucket}`,
      payload: { operation: "auth_probe", platform }
    });
    for (let index = 0; index < 70; index += 1) {
      const job = browserPublishJobStore.getById(queued.job.id);
      if (job && browserPublishJobStore.isTerminal(job.status)) {
        return {
          authenticated: job.result?.authenticated === true,
          status: job.result?.status || (job.result?.authenticated ? "ready" : "auth_required"),
          message: job.result?.authenticated
            ? `${platform} browser session is authenticated.`
            : job.result?.failureReason || `${platform} browser session is not authenticated.`,
          nextAction: job.result?.authenticated
            ? "The browser executor can accept publish jobs."
            : "Keep publishing blocked until a machine-managed authenticated session is available.",
          failureCode: job.result?.failureCode
        };
      }
      await sleep(500);
    }
    return {
      authenticated: false,
      status: "failed",
      message: `${platform} browser executor did not answer the auth probe.`,
      nextAction: "Restart the machine-managed extension browser and retry the auth probe."
    };
  }

  if (platform === "csdn" || (platform === "juejin" && !juejinPageContextPublishEnabled)) {
    const draftApiAuth = await checkAuth(platform);
    if (!draftApiAuth.authenticated) {
      return {
        ...draftApiAuth,
        status: draftApiAuth.message?.includes("缺少配置") ? "pending_config" : "auth_required"
      };
    }
  }

  try {
    const { response, payload } = await proxyArcs("/auth/check", { platform });
    console.log(
      `Formal auth result: platform=${platform}, http=${response.status}, status=${String(payload.status || "")}, authenticated=${payload.authenticated === true}, failureCode=${String(payload.failureCode || "")}, message=${String(payload.message || payload.failureReason || "").slice(0, 240)}`
    );
    return {
      authenticated: response.ok && payload.authenticated === true,
      status: payload.status || (response.ok ? "ready" : "auth_required"),
      message: payload.message || payload.failureReason || `${platform} Arcs runner 登录态检查失败。`,
      nextAction: payload.nextAction || "请启动专用浏览器 profile 并完成平台登录。",
      failureCode: payload.failureCode,
      missingConfig: payload.missingConfig
    };
  } catch (error) {
    return {
      authenticated: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Arcs runner 不可达。",
      nextAction: "请启动本机 Arcs runner 后重试预检查。"
    };
  }
}

async function syncCsdnArticle(input) {
  const missingConfig = getCsdnMissingConfig();
  if (missingConfig.length) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "missing_config",
        message: `CSDN 草稿缺少配置：${missingConfig.join(", ")}`
      }
    };
  }

  const baseArticle = getPlatformInput(input);
  const csdnContent = prepareCsdnArticleContent(baseArticle);
  const requestedArticleId = String(input.externalDraftId || input.platformArticleId || "").trim();
  const article = { ...baseArticle, ...csdnContent, articleId: requestedArticleId };
  const inputCheck = assertArticleInput(article);
  if (!inputCheck.ok) return inputCheck;

  const tags = splitEnvList(process.env.CSDN_TAGS || "AI,企业AI,Dify");
  const replacements = {
    title: article.title,
    markdown: article.markdown,
    html: article.html,
    summary: article.summary,
    tagsCsv: tags.join(",")
  };
  const customPayload = parseJsonEnv("CSDN_DRAFT_PAYLOAD_JSON");
  const draftPayload =
    customPayload ||
    {
      title: article.title.slice(0, 100),
      markdowncontent: article.markdown,
      content: article.html,
      readType: "public",
      level: 0,
      tags: tags.join(","),
      status: 2,
      categories: process.env.CSDN_CATEGORIES || "",
      type: "original",
      original_link: "",
      authorized_status: false,
      Description: article.summary,
      resource_url: "",
      not_auto_saved: "1",
      source: "pc_mdeditor",
      cover_images: [],
      cover_type: 1,
      is_new: 1
    };
  const configuredUrl = process.env.CSDN_DRAFT_API_URL?.trim();
  const url = !configuredUrl || configuredUrl.includes("/v1/postedit/saveArticle")
    ? "https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle"
    : configuredUrl;
  const baseHeaders = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    Cookie: process.env.CSDN_COOKIE,
    Origin: process.env.CSDN_ORIGIN || "https://editor.csdn.net",
    Referer: process.env.CSDN_REFERER || "https://editor.csdn.net/",
    "User-Agent": process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0"
  };
  const headers = {
    ...baseHeaders,
    ...createCsdnGatewayHeaders({
      method: "POST",
      url,
      appKey: process.env.CSDN_API_GATEWAY_KEY,
      signingKey: process.env.CSDN_API_GATEWAY_SIGNING_KEY,
      accept: baseHeaders.Accept,
      contentType: baseHeaders["Content-Type"]
    }),
    ...getExtraHeaders("CSDN_HEADERS_JSON")
  };
  const resolvedDraftPayload = enforceCsdnContentFields(applyTemplate(draftPayload, replacements), article);
  const { response, payload } = await fetchJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify(resolvedDraftPayload)
  });

  if (!isBusinessSuccess(response, payload)) {
    return platformFetchFailure("CSDN", response, payload);
  }

  const externalDraftId =
    payload?.data?.article_id ||
    payload?.data?.articleId ||
    payload?.data?.id ||
    payload?.article_id ||
    payload?.articleId ||
    payload?.id ||
    requestedArticleId;
  const editorUrl = externalDraftId ? `https://editor.csdn.net/md?articleId=${externalDraftId}` : "https://editor.csdn.net/";

  return {
    ok: true,
    statusCode: 200,
    payload: {
      draftUrl: editorUrl,
      editorUrl,
      externalDraftId: externalDraftId ? String(externalDraftId) : undefined,
      message: "CSDN 草稿已创建，请到 CSDN 创作中心预览后人工发布。"
    }
  };
}

async function syncJuejinArticle(input) {
  const missingConfig = getJuejinMissingConfig();
  if (missingConfig.length) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "missing_config",
        message: `掘金草稿缺少配置：${missingConfig.join(", ")}`
      }
    };
  }

  const article = getPlatformInput(input);
  const inputCheck = assertArticleInput(article);
  if (!inputCheck.ok) return inputCheck;

  const tagIds = splitEnvList(process.env.JUEJIN_TAG_IDS);
  const categoryId = process.env.JUEJIN_CATEGORY_ID || "6809637771511070734";
  const customPayload = parseJsonEnv("JUEJIN_DRAFT_PAYLOAD_JSON");
  const replacements = {
    title: article.title,
    markdown: article.markdown,
    html: article.html,
    summary: article.summary,
    tagsCsv: tagIds.join(",")
  };
  const draftPayload =
    customPayload ||
    {
      category_id: categoryId,
      tag_ids: tagIds,
      link_url: "",
      cover_image: process.env.JUEJIN_COVER_IMAGE || "",
      title: article.title.slice(0, 100),
      brief_content: article.summary,
      edit_type: 10,
      html_content: "deprecated",
      mark_content: article.markdown
    };
  const csrfToken = process.env.JUEJIN_CSRF_TOKEN || getCookieValue(process.env.JUEJIN_COOKIE, "passport_csrf_token");
  const query = process.env.JUEJIN_DRAFT_API_QUERY || `aid=2608&uuid=${encodeURIComponent(process.env.JUEJIN_UUID || "")}&spider=0`;
  const url = process.env.JUEJIN_DRAFT_API_URL || `https://api.juejin.cn/content_api/v1/article_draft/create?${query}`;
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Cookie: process.env.JUEJIN_COOKIE,
    Origin: process.env.JUEJIN_ORIGIN || "https://juejin.cn",
    Referer: process.env.JUEJIN_REFERER || "https://juejin.cn/editor/drafts/new",
    "User-Agent": process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0",
    ...(csrfToken ? { "x-secsdk-csrf-token": csrfToken } : {}),
    ...getExtraHeaders("JUEJIN_HEADERS_JSON")
  };
  const { response, payload } = await fetchJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify(applyTemplate(draftPayload, replacements))
  });

  if (!isBusinessSuccess(response, payload)) {
    return platformFetchFailure("掘金", response, payload);
  }

  const externalDraftId = payload?.data?.id || payload?.data?.draft_id || payload?.data?.article_id || payload?.id;
  const editorUrl = externalDraftId ? `https://juejin.cn/editor/drafts/${externalDraftId}` : "https://juejin.cn/editor/drafts/new";

  return {
    ok: true,
    statusCode: 200,
    payload: {
      draftUrl: editorUrl,
      editorUrl,
      externalDraftId: externalDraftId ? String(externalDraftId) : undefined,
      message: "掘金草稿已创建，请到掘金创作中心预览后人工发布。"
    }
  };
}

function buildZhihuHeaders() {
  const xsrfToken = process.env.ZHIHU_XSRF_TOKEN || getCookieValue(process.env.ZHIHU_COOKIE, "_xsrf");

  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Cookie: process.env.ZHIHU_COOKIE,
    Origin: process.env.ZHIHU_ORIGIN || "https://zhuanlan.zhihu.com",
    Referer: process.env.ZHIHU_REFERER || "https://zhuanlan.zhihu.com/write",
    "User-Agent": process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0",
    ...(xsrfToken ? { "x-xsrftoken": xsrfToken } : {}),
    ...getExtraHeaders("ZHIHU_HEADERS_JSON")
  };
}

async function syncZhihuArticle(input) {
  const missingConfig = getZhihuMissingConfig();
  if (missingConfig.length) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "missing_config",
        message: `知乎草稿缺少配置：${missingConfig.join(", ")}`
      }
    };
  }

  const article = getPlatformInput(input);
  const inputCheck = assertArticleInput(article);
  if (!inputCheck.ok) return inputCheck;

  const replacements = {
    title: article.title,
    markdown: article.markdown,
    html: article.html,
    summary: article.summary,
    tagsCsv: ""
  };
  const createPayload =
    parseJsonEnv("ZHIHU_DRAFT_PAYLOAD_JSON") ||
    {
      title: article.title.slice(0, 100),
      content: article.html,
      delta_time: 0
    };
  const createUrl = process.env.ZHIHU_DRAFT_API_URL || "https://zhuanlan.zhihu.com/api/articles/drafts";
  const createResult = await fetchJson(createUrl, {
    method: "POST",
    headers: buildZhihuHeaders(),
    body: JSON.stringify(applyTemplate(createPayload, replacements))
  });

  if (!isBusinessSuccess(createResult.response, createResult.payload)) {
    return platformFetchFailure("知乎", createResult.response, createResult.payload);
  }

  const externalDraftId =
    createResult.payload?.id ||
    createResult.payload?.data?.id ||
    createResult.payload?.draft_id ||
    createResult.payload?.data?.draft_id;

  if (externalDraftId) {
    const updateUrlTemplate = process.env.ZHIHU_DRAFT_UPDATE_URL_TEMPLATE || "https://zhuanlan.zhihu.com/api/articles/{{draftId}}/draft";
    const updateUrl = updateUrlTemplate.replace(/\{\{\s*draftId\s*\}\}/g, encodeURIComponent(String(externalDraftId)));
    const updatePayload =
      parseJsonEnv("ZHIHU_DRAFT_UPDATE_PAYLOAD_JSON") ||
      {
        title: article.title.slice(0, 100),
        content: article.html,
        delta_time: 0
      };
    const updateResult = await fetchJson(updateUrl, {
      method: process.env.ZHIHU_DRAFT_UPDATE_METHOD || "PATCH",
      headers: buildZhihuHeaders(),
      body: JSON.stringify(applyTemplate(updatePayload, replacements))
    });

    if (!isBusinessSuccess(updateResult.response, updateResult.payload)) {
      return platformFetchFailure("知乎", updateResult.response, updateResult.payload);
    }
  }

  return {
    ok: true,
    statusCode: 200,
    payload: {
      draftUrl: "https://zhuanlan.zhihu.com/write",
      editorUrl: externalDraftId ? `https://zhuanlan.zhihu.com/write?draft=${externalDraftId}` : "https://zhuanlan.zhihu.com/write",
      externalDraftId: externalDraftId ? String(externalDraftId) : undefined,
      message: "知乎草稿已创建，请到知乎写作后台预览后人工发布。"
    }
  };
}

async function syncWeixinArticle(input) {
  const coverImageRef = String(input.coverUrl || "").trim();
  const missingConfig = getWeixinMissingConfig(coverImageRef);
  if (missingConfig.length) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "missing_config",
        message: `微信公众号草稿缺少配置：${missingConfig.join(", ")}`
      }
    };
  }

  const title = String(input.title || "").trim();
  const contentFormat = input.contentFormat === "wechat_html" ? "wechat_html" : "markdown";
  const sourceContent = String(input.content || "").trim();

  if (!title || !sourceContent) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "invalid_input",
        message: "标题和正文不能为空。"
      }
    };
  }

  const token = await getWeixinAccessToken();
  if (!token.ok) {
    return {
      ok: false,
      statusCode: 502,
      payload: {
        errorCode: "auth_failed",
        message: token.message,
        nextAction: token.nextAction
      }
    };
  }

  const thumb = await getWeixinThumbMediaId(token.accessToken, coverImageRef);
  if (!thumb.ok) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        errorCode: "invalid_thumb_media",
        message: thumb.message,
        externalErrorCode: thumb.errcode
      }
    };
  }

  const url = new URL(`${wechatApiBase}/cgi-bin/draft/add`);
  url.searchParams.set("access_token", token.accessToken);

  let content = resolveWeixinArticleContent({ contentFormat, content: sourceContent }, markdownToWechatHtml);
  try {
    content = await rewriteWorkbenchMediaSources(content, async (mediaAssetId) => {
      const state = JSON.parse(readFileSync(mediaLibraryStatePath, "utf8"));
      const asset = state?.assets?.[mediaAssetId];
      if (!asset || asset.status !== "active" || asset.storageKey !== mediaAssetId) throw new Error(`素材 ${mediaAssetId} 不存在、已移出图库或存储引用无效。`);
      const assetPath = resolve(mediaLibraryStoragePath, asset.storageKey);
      const relativeAssetPath = relative(resolve(mediaLibraryStoragePath), assetPath);
      if (!relativeAssetPath || relativeAssetPath.startsWith("..") || isAbsolute(relativeAssetPath)) throw new Error(`素材 ${mediaAssetId} 的存储路径无效。`);
      const data = readFileSync(assetPath);
      const digest = createHash("sha256").update(data).digest("hex");
      if (digest !== asset.contentHash) throw new Error(`素材 ${mediaAssetId} 完整性校验失败。`);
      const uploadUrl = new URL(`${wechatApiBase}/cgi-bin/media/uploadimg`);
      uploadUrl.searchParams.set("access_token", token.accessToken);
      const form = new FormData();
      form.append("media", new Blob([data], { type: asset.mimeType }), asset.originalFileName || `${mediaAssetId}.${asset.mimeType === "image/gif" ? "gif" : "png"}`);
      const uploadResponse = await fetch(uploadUrl, { method: "POST", body: form });
      const uploadPayload = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok || !uploadPayload.url) throw new Error(`素材 ${mediaAssetId} 上传微信正文失败：${uploadPayload.errmsg || `HTTP ${uploadResponse.status}`}`);
      return uploadPayload.url;
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      payload: {
        errorCode: "article_image_upload_failed",
        message: error instanceof Error ? error.message : "公众号正文图片上传失败。",
        nextAction: "检查素材格式、公众号接口权限和网络后重试；草稿尚未创建。"
      }
    };
  }
  const draftPayload = {
    articles: [
      {
        title: title.slice(0, 64),
        author: process.env.WECHAT_MP_AUTHOR || "",
        digest: (process.env.WECHAT_MP_DIGEST || createDigest(sourceContent)).slice(0, 120),
        content,
        content_source_url: process.env.WECHAT_MP_CONTENT_SOURCE_URL || "",
        thumb_media_id: thumb.mediaId,
        need_open_comment: Number(process.env.WECHAT_MP_NEED_OPEN_COMMENT || 0),
        only_fans_can_comment: Number(process.env.WECHAT_MP_ONLY_FANS_CAN_COMMENT || 0)
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draftPayload)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.media_id) {
    return {
      ok: false,
      statusCode: 502,
      payload: {
        errorCode: "sync_failed",
        message: `微信公众号草稿创建失败：${payload.errmsg || `HTTP ${response.status}`}`,
        externalErrorCode: payload.errcode
      }
    };
  }

  return {
    ok: true,
    statusCode: 200,
    payload: {
      draftUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg",
      editorUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg",
      externalDraftId: payload.media_id,
      message: "微信公众号草稿已创建，请到公众号后台草稿箱预览后人工发布。"
    }
  };
}

async function publishWeixinArticle(input) {
  const validation = validateFormalPublishInput(input);
  if (!validation.ok) return validation;

  const existing = publishLedger.get(input.idempotencyKey);
  if (existing?.result) {
    return { statusCode: 200, payload: { ...existing.result, duplicateProtected: true } };
  }
  if (existing) {
    return {
      statusCode: 409,
      payload: {
        ok: false,
        status: "pending_verify",
        publishStatus: "submitted",
        failureCode: "duplicate_protected",
        failureReason: "同一微信公众号发布任务已开始，重复提交已阻止。",
        nextAction: "请先查询公众号发布任务状态，不要再次提交。",
        duplicateProtected: true
      }
    };
  }

  publishLedger.begin(input.idempotencyKey, {
    scheduleId: input.scheduleId,
    platform: input.platform,
    contentHash: input.contentHash
  });

  const draft = await syncWeixinArticle({
    title: input.title,
    content: input.markdown,
    contentFormat: input.contentFormat || "markdown",
    coverUrl: input.coverMediaId ? `media_id:${input.coverMediaId}` : input.coverUrl
  });
  if (!draft.ok) {
    const result = {
      ok: false,
      status: draft.payload.errorCode === "missing_config" ? "pending_config" : "failed",
      publishStatus: "failed",
      failureCode: draft.payload.errorCode === "missing_config" ? "pending_config" : "adapter_failed",
      failureReason: draft.payload.message,
      nextAction: draft.payload.nextAction || "请修复公众号草稿配置；确认后台没有新增文章后再创建新排程。"
    };
    publishLedger.complete(input.idempotencyKey, result);
    return { statusCode: draft.statusCode, payload: result };
  }

  const token = await getWeixinAccessToken();
  if (!token.ok) {
    const result = { ok: false, status: "pending_config", publishStatus: "failed", failureCode: "pending_config", failureReason: token.message, nextAction: token.nextAction };
    publishLedger.complete(input.idempotencyKey, result);
    return { statusCode: 502, payload: result };
  }

  const result = await submitAndPollWechatPublish({
    apiBase: wechatApiBase,
    accessToken: token.accessToken,
    mediaId: draft.payload.externalDraftId,
    fetchJson,
    pollAttempts: Math.max(1, Number(process.env.WECHAT_PUBLISH_POLL_ATTEMPTS || 10)),
    pollIntervalMs: Math.max(250, Number(process.env.WECHAT_PUBLISH_POLL_INTERVAL_MS || 3_000))
  });
  publishLedger.complete(input.idempotencyKey, result);
  return { statusCode: result.ok ? 200 : result.status === "pending_config" ? 400 : 502, payload: result };
}

async function publishFormalArticle(input) {
  if (input.platform === "weixin") return publishWeixinArticle(input);
  const validation = validateFormalPublishInput(input);
  if (!validation.ok) return validation;

  if (browserExtensionPlatforms.has(input.platform)) {
    const existing = publishLedger.get(input.idempotencyKey);
    if (existing?.result) {
      return { statusCode: 200, payload: { ...existing.result, duplicateProtected: true } };
    }
    if (!existing) {
      publishLedger.begin(input.idempotencyKey, {
        scheduleId: input.scheduleId,
        platform: input.platform,
        contentHash: input.contentHash,
        title: input.title
      });
    }
    const queued = browserPublishJobStore.enqueue({
      platform: input.platform,
      idempotencyKey: input.idempotencyKey,
      payload: {
        scheduleId: input.scheduleId,
        platform: input.platform,
        contentHash: input.contentHash,
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        markdown: input.markdown,
        summary: input.summary,
        categoryId: input.categoryId,
        tagIds: input.tagIds,
        externalDraftId: input.externalDraftId,
        editorUrl: input.editorUrl
      }
    });
    const result = {
      ok: true,
      status: "pending_verify",
      publishStatus: "pending_verify",
      externalTaskId: queued.job.id,
      failureCode: "platform_review_pending",
      nextAction: "The authenticated browser executor has accepted this job; only reconcile its result."
    };
    publishLedger.complete(input.idempotencyKey, result);
    return { statusCode: 202, payload: result };
  }

  if (input.platform === "csdn" || input.platform === "juejin") {
    const existing = publishLedger.get(input.idempotencyKey);
    if (existing?.result) {
      const canResumeExistingDraft =
        (existing.result.failureCode === "payload_invalid" ||
          (existing.result.failureCode === "adapter_failed" &&
            (String(existing.result.failureReason || "").includes("编辑器结构已变化，未找到标题或正文输入区") ||
              String(existing.result.failureReason || "") === "BrowserConnectError")) ||
          (input.platform === "csdn" &&
            existing.result.failureCode === "publish_action_unconfirmed" &&
            String(existing.result.failureReason || "") === "csdn 第一层发布已点击，但最终确认弹窗或确认按钮未出现。")) &&
        existing.result.externalDraftId &&
        existing.result.editorUrl;
      const canRetryRejectedCsdnDraft =
        input.platform === "csdn" &&
        existing.result.failureCode === "adapter_failed" &&
        String(existing.result.failureReason || "").includes("X-Ca-Key is not exist") &&
        !existing.result.externalDraftId;
      const canRetryJuejinPageContextBeforePublish =
        input.platform === "juejin" &&
        juejinPageContextPublishEnabled &&
        existing.result.failureCode === "adapter_failed" &&
        String(existing.result.failureReason || "").startsWith("BrowserConnectError") &&
        !existing.result.externalDraftId &&
        !existing.result.platformArticleId;
      if (canResumeExistingDraft) {
        input = {
          ...input,
          externalDraftId: String(existing.result.externalDraftId),
          editorUrl: String(existing.result.editorUrl)
        };
      } else if (!canRetryRejectedCsdnDraft && !canRetryJuejinPageContextBeforePublish) {
        return { statusCode: 200, payload: { ...existing.result, duplicateProtected: true } };
      }
    }
    if (existing && !existing.result) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          status: "pending_verify",
          publishStatus: "failed",
          failureCode: "publish_action_unconfirmed",
          failureReason: "同一发布任务已开始，但尚未形成可确认结果。",
          nextAction: "只检查平台创作后台和 runner 账本，不要再次创建草稿或点击发布。",
          duplicateProtected: true
        }
      };
    }

    if (!existing) {
      publishLedger.begin(input.idempotencyKey, {
        scheduleId: input.scheduleId,
        platform: input.platform,
        contentHash: input.contentHash,
        title: input.title
      });
    }

    const needsHybridDraft = input.platform === "csdn" || (input.platform === "juejin" && !juejinPageContextPublishEnabled);
    if (needsHybridDraft && (!input.externalDraftId || !input.editorUrl)) {
      let draft;
      try {
        draft = input.platform === "csdn" ? await syncCsdnArticle(input) : await syncJuejinArticle(input);
      } catch (error) {
        const result = {
          ok: false,
          status: "failed",
          publishStatus: "failed",
          failureCode: "adapter_failed",
          failureReason: error instanceof Error ? error.message : "平台草稿创建失败。",
          nextAction: "修复草稿 API 配置，并先确认平台后台没有新增草稿。"
        };
        publishLedger.complete(input.idempotencyKey, result);
        return { statusCode: 502, payload: result };
      }

      if (!draft.ok || !draft.payload.externalDraftId || !draft.payload.editorUrl) {
        const result = {
          ok: false,
          status: draft.payload.errorCode === "missing_config" ? "pending_config" : "failed",
          publishStatus: "failed",
          failureCode: draft.payload.errorCode === "missing_config" ? "pending_config" : "adapter_failed",
          failureReason: draft.payload.message || `${input.platform} 草稿接口未返回草稿 ID。`,
          nextAction: "修复草稿 API 配置；拿不到平台草稿 ID 时禁止进入浏览器发布。"
        };
        publishLedger.complete(input.idempotencyKey, result);
        return { statusCode: draft.statusCode || 502, payload: result };
      }

      input = {
        ...input,
        externalDraftId: String(draft.payload.externalDraftId),
        editorUrl: String(draft.payload.editorUrl)
      };
    }
  }

  try {
    const { response, payload } = await proxyArcs("/publish", input);
    const result = input.platform === "csdn" || input.platform === "juejin"
      ? { ...payload, externalDraftId: input.externalDraftId, editorUrl: input.editorUrl }
      : payload;
    if (input.platform === "csdn" || input.platform === "juejin") {
      publishLedger.complete(input.idempotencyKey, result);
    }
    return { statusCode: response.status, payload: result };
  } catch (error) {
    const result = {
      ok: false,
      status: input.externalDraftId ? "pending_verify" : "failed",
      publishStatus: "failed",
      failureCode: input.externalDraftId ? "publish_action_unconfirmed" : "adapter_failed",
      failureReason: error instanceof Error ? error.message : "Arcs runner 调用失败。",
      nextAction: input.externalDraftId
        ? "平台草稿已创建但发布动作未确认；只检查该草稿和创作后台，不要重复创建或发布。"
        : "不要盲目重试；先检查平台后台是否已生成文章。",
      externalDraftId: input.externalDraftId,
      editorUrl: input.editorUrl
    };
    if (input.platform === "csdn" || input.platform === "juejin") publishLedger.complete(input.idempotencyKey, result);
    return { statusCode: 502, payload: result };
  }
}

async function verifyFormalArticle(input) {
  if (input.platform !== "weixin") {
    const directPublicObservation = await verifyKnownPublicArticle(input);
    if (directPublicObservation) return directPublicObservation;

    const browserJob =
      (input.externalTaskId && browserPublishJobStore.getById(String(input.externalTaskId))) ||
      (input.idempotencyKey && browserPublishJobStore.getByIdempotencyKey(String(input.idempotencyKey)));
    if (browserJob) {
      if (!browserPublishJobStore.isTerminal(browserJob.status)) {
        return {
          statusCode: 202,
          payload: {
            ok: true,
            status: "pending_verify",
            publishStatus: "pending_verify",
            externalTaskId: browserJob.id,
            failureCode: "platform_review_pending",
            nextAction: "Wait for the browser executor result; do not submit a second publish action."
          }
        };
      }
      if (!browserJob.result?.ok) {
        return { statusCode: browserJob.status === "risk_blocked" ? 409 : 502, payload: browserJob.result };
      }
      input = {
        ...input,
        ...browserJob.result,
        externalTaskId: browserJob.id
      };
    }
    try {
      const { response, payload } = await proxyArcs("/verify", input);
      return { statusCode: response.status, payload };
    } catch (error) {
      return { statusCode: 502, payload: { ok: false, status: "pending_verify", publishStatus: "failed", failureCode: "publish_action_unconfirmed", failureReason: error instanceof Error ? error.message : "Arcs runner 验证失败。", nextAction: "不要重复发布；恢复 runner 后只执行后台验证。" } };
    }
  }

  const publishId = String(input.externalTaskId || "").trim();
  if (!publishId) {
    return { statusCode: 400, payload: { ok: false, status: "pending_verify", failureCode: "verification_failed", failureReason: "缺少微信公众号 publish_id。", nextAction: "请检查 bridge 本机幂等账本或公众号后台。" } };
  }
  const token = await getWeixinAccessToken();
  if (!token.ok) return { statusCode: 502, payload: { ok: false, status: "pending_verify", failureCode: "verification_failed", failureReason: token.message, nextAction: token.nextAction } };
  const result = await verifyWechatPublish({ apiBase: wechatApiBase, accessToken: token.accessToken, publishId, fetchJson });
  publishLedger.complete(input.idempotencyKey, result);
  return { statusCode: result.ok ? 200 : 502, payload: result };
}

async function verifyKnownPublicArticle(input) {
  const platform = String(input.platform || "").trim();
  const platformArticleId = String(input.platformArticleId || "").trim();
  const configuredUrl = String(input.publicUrl || "").trim();
  const platformRules = {
    csdn: {
      hosts: new Set(["blog.csdn.net"]),
      buildUrl: (articleId) => articleId ? `https://blog.csdn.net/Kari11/article/details/${encodeURIComponent(articleId)}` : ""
    },
    juejin: {
      hosts: new Set(["juejin.cn"]),
      buildUrl: (articleId) => articleId ? `https://juejin.cn/post/${encodeURIComponent(articleId)}` : ""
    },
    zhihu: {
      hosts: new Set(["zhuanlan.zhihu.com"]),
      buildUrl: (articleId) => articleId ? `https://zhuanlan.zhihu.com/p/${encodeURIComponent(articleId)}` : ""
    }
  };
  const rule = platformRules[platform];
  if (!rule || (!configuredUrl && !platformArticleId)) return null;

  let publicUrl = configuredUrl || rule.buildUrl(platformArticleId);
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "https:" || !rule.hosts.has(parsed.hostname)) return null;
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0" },
      signal: AbortSignal.timeout(externalPlatformTimeoutMs)
    });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url || parsed.href);
    if (!rule.hosts.has(finalUrl.hostname)) return null;
    publicUrl = finalUrl.href;
    return {
      statusCode: 200,
      payload: {
        ok: true,
        status: "public_observed",
        publishStatus: "confirmed",
        platformArticleId: platformArticleId || undefined,
        externalTaskId: input.externalTaskId,
        publicUrl,
        pendingCsvReturn: false,
        nextAction: "Public URL verified from the platform article ID; title matching was not required."
      }
    };
  } catch {
    return null;
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${bindHost}:${port}`}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "joto-wechatsync-bridge",
      browserExtensionPlatforms: [...browserExtensionPlatforms],
      juejinPageContextPublishEnabled
    });
    return;
  }
  const isExtensionRoute = url.pathname.startsWith("/extension/publish/");
  if (isExtensionRoute && request.method === "OPTIONS") {
    if (!verifyPublishExtensionOrigin(request)) {
      sendJson(response, 401, { message: "Unauthorized extension origin." });
      return;
    }
    response.writeHead(204, {
      "Access-Control-Allow-Origin": request.headers.origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600"
    });
    response.end();
    return;
  }
  if ((isExtensionRoute && !verifyPublishExtensionOrigin(request)) || (!isExtensionRoute && !verifyBridgeToken(request))) {
    if (isExtensionRoute) console.warn(`Rejected publish extension origin: ${String(request.headers.origin || "missing")}`);
    sendJson(response, 401, { message: "Unauthorized bridge request." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/status") {
    sendJson(response, 200, {
      ok: true,
      mode: "real",
      service: "joto-wechatsync-bridge",
      supportedPlatforms: implementedPlatforms,
      browserExtensionPlatforms: [...browserExtensionPlatforms],
      juejinPageContextPublishEnabled,
      checkedAt: nowIso()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/extension/publish/tasks/next") {
    const workerId = String(url.searchParams.get("workerId") || "").trim();
    if (!workerId) {
      sendJson(response, 400, { message: "workerId is required." }, { "Access-Control-Allow-Origin": request.headers.origin });
      return;
    }
    sendJson(
      response,
      200,
      browserPublishJobStore.claim(workerId, [...browserExtensionPlatforms]) || {},
      { "Access-Control-Allow-Origin": request.headers.origin }
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/extension/publish/heartbeat") {
    const body = await readJsonBody(request);
    const workerId = String(body.workerId || "").trim();
    if (!workerId) {
      sendJson(response, 400, { message: "workerId is required." }, { "Access-Control-Allow-Origin": request.headers.origin });
      return;
    }
    extensionHeartbeats.set(workerId, { checkedAt: nowIso(), platforms: Array.isArray(body.platforms) ? body.platforms : [] });
    sendJson(response, 200, { ok: true }, { "Access-Control-Allow-Origin": request.headers.origin });
    return;
  }

  const extensionResultMatch = url.pathname.match(/^\/extension\/publish\/tasks\/([^/]+)\/result$/);
  if (request.method === "POST" && extensionResultMatch) {
    const body = await readJsonBody(request);
    const completed = browserPublishJobStore.complete(
      decodeURIComponent(extensionResultMatch[1]),
      String(body.workerId || ""),
      body.result && typeof body.result === "object" ? body.result : {}
    );
    if (!completed) {
      sendJson(
        response,
        409,
        { message: "Job lease is missing, expired, or owned by another executor." },
        { "Access-Control-Allow-Origin": request.headers.origin }
      );
      return;
    }
    publishLedger.complete(completed.idempotencyKey, {
      ...completed.result,
      externalTaskId: completed.id
    });
    sendJson(response, 200, completed, { "Access-Control-Allow-Origin": request.headers.origin });
    return;
  }

  if (request.method === "POST" && url.pathname === "/auth/check") {
    const body = await readJsonBody(request);
    sendJson(response, 200, body.purpose === "formal_publish" ? await checkFormalPublishAuth(body.platform) : await checkAuth(body.platform));
    return;
  }

  if (request.method === "POST" && url.pathname === "/publish") {
    const result = await publishFormalArticle(await readJsonBody(request));
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  if (request.method === "POST" && url.pathname === "/publish/verify") {
    const result = await verifyFormalArticle(await readJsonBody(request));
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  if (request.method === "POST" && url.pathname === "/sync_article") {
    const body = await readJsonBody(request);
    const platforms = Array.isArray(body.platforms) ? body.platforms : [];
    const platform = platforms[0];

    if (!implementedPlatforms.includes(platform)) {
      sendJson(response, 501, {
        errorCode: "platform_not_supported",
        message: `平台 ${platform || "unknown"} 尚未接入真实 bridge。`
      });
      return;
    }

    const result =
      platform === "weixin"
        ? await syncWeixinArticle(body)
        : platform === "csdn"
          ? await syncCsdnArticle(body)
          : platform === "juejin"
            ? await syncJuejinArticle(body)
            : await syncZhihuArticle(body);
    sendJson(response, result.statusCode, result.payload);
    return;
  }

  sendJson(response, 404, { message: "Not found." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      errorCode: "bridge_error",
      message: error instanceof Error ? error.message : "Unknown bridge error"
    });
  });
});

server.listen(port, bindHost, () => {
  console.log(`Wechatsync bridge listening on http://${bindHost}:${port}`);
  console.log(`Supported real platforms: ${implementedPlatforms.join(", ")}`);
  console.log(`Browser extension platforms: ${[...browserExtensionPlatforms].join(", ") || "disabled"}`);
});
