const PLATFORMS = ["wechat", "csdn", "juejin", "zhihu"];

const PLATFORM_LABELS = {
  wechat: "微信公众号",
  csdn: "CSDN",
  juejin: "掘金",
  zhihu: "知乎"
};

const REQUIRED_ENV = {
  wechat: ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"],
  csdn: ["CSDN_COOKIE"],
  juejin: ["JUEJIN_COOKIE"],
  zhihu: ["ZHIHU_COOKIE"]
};

function nowIso() {
  return new Date().toISOString();
}

function finiteMetric(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
  const text = String(value).replace(/,/g, "").trim();
  const matched = text.match(/(-?\d+(?:\.\d+)?)\s*([万亿]?)/);
  if (!matched) return undefined;
  const scale = matched[2] === "亿" ? 100_000_000 : matched[2] === "万" ? 10_000 : 1;
  const number = Number(matched[1]) * scale;
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : undefined;
}

function parseJsonEnv(name, fallback = {}) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    throw new Error(`${name} 必须是有效 JSON。`);
  }
}

function getByPath(value, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    return current[key];
  }, value);
}

function fillTemplate(value, target) {
  return String(value || "")
    .replaceAll("{{publishResultId}}", encodeURIComponent(target.publishResultId || ""))
    .replaceAll("{{externalContentId}}", encodeURIComponent(target.externalContentId || extractExternalId(target) || ""))
    .replaceAll("{{publicUrl}}", encodeURIComponent(target.publicUrl || ""))
    .replaceAll("{{publicUrlRaw}}", target.publicUrl || "");
}

function extractExternalId(target) {
  if (target.externalContentId !== undefined && target.externalContentId !== null && String(target.externalContentId).trim()) {
    return String(target.externalContentId).trim();
  }
  const value = String(target.publicUrl || "");
  const patterns = {
    wechat: [/[?&]mid=(\d+)/, /\/s\/([\w-]+)/],
    csdn: [/\/article\/details\/(\d+)/],
    juejin: [/\/post\/(\d+)/],
    zhihu: [/\/p\/(\d+)/, /\/api\/v4\/articles\/(\d+)/]
  };
  for (const pattern of patterns[target.platform] || []) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function metricPaths(platform) {
  const configured = parseJsonEnv(`${platform.toUpperCase()}_METRICS_PATHS_JSON`, {});
  const defaults = {
    csdn: { views: "data.viewCount", likes: "data.diggCount", favorites: "data.collectCount" },
    juejin: { views: "data.article_info.view_count", likes: "data.article_info.digg_count", favorites: "data.article_info.collect_count" },
    zhihu: { views: "visited_count", likes: "voteup_count", favorites: "favlists_count" }
  };
  return { ...(defaults[platform] || {}), ...configured };
}

function normalizeConfiguredMetrics(platform, payload) {
  const paths = metricPaths(platform);
  return {
    views: finiteMetric(getByPath(payload, paths.views)),
    likes: finiteMetric(getByPath(payload, paths.likes)),
    favorites: finiteMetric(getByPath(payload, paths.favorites))
  };
}

function containsMetric(metrics) {
  return Object.values(metrics).some((value) => value !== undefined);
}

async function fetchWithTimeout(fetchImpl, url, init = {}) {
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(process.env.CONTENT_METRICS_PLATFORM_TIMEOUT_MS || 20_000)));
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) return response.json().catch(() => ({}));
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

function platformHeaders(platform) {
  const prefix = platform.toUpperCase();
  const cookie = process.env[`${prefix}_COOKIE`]?.trim();
  return {
    Accept: "application/json, text/plain, */*",
    "User-Agent": process.env.CONTENT_METRICS_USER_AGENT || process.env.WECHATSYNC_USER_AGENT || "Mozilla/5.0",
    ...(cookie ? { Cookie: cookie } : {}),
    ...parseJsonEnv(`${prefix}_METRICS_HEADERS_JSON`, {}),
    ...parseJsonEnv(`${prefix}_HEADERS_JSON`, {})
  };
}

async function configuredMetrics(platform, target, fetchImpl) {
  const prefix = platform.toUpperCase();
  const template = process.env[`${prefix}_METRICS_URL_TEMPLATE`]?.trim();
  if (!template) return undefined;
  const method = String(process.env[`${prefix}_METRICS_METHOD`] || "GET").toUpperCase();
  const bodyTemplate = process.env[`${prefix}_METRICS_BODY_JSON`]?.trim();
  const response = await fetchWithTimeout(fetchImpl, fillTemplate(template, target), {
    method,
    headers: { ...platformHeaders(platform), ...(bodyTemplate ? { "Content-Type": "application/json" } : {}) },
    body: bodyTemplate ? fillTemplate(bodyTemplate, target) : undefined
  });
  const payload = await readResponse(response);
  if (!response.ok) throw new Error(`${PLATFORM_LABELS[platform]} 指标接口返回 HTTP ${response.status}。`);
  const metrics = normalizeConfiguredMetrics(platform, payload);
  if (!containsMetric(metrics)) throw new Error(`${PLATFORM_LABELS[platform]} 指标接口未返回已配置的指标字段。`);
  return metrics;
}

let wechatTokenCache;

async function getWechatAccessToken(fetchImpl) {
  if (wechatTokenCache?.expiresAt > Date.now() + 60_000) return wechatTokenCache.value;
  const url = new URL(`${String(process.env.WECHAT_MP_API_BASE_URL || "https://api.weixin.qq.com").replace(/\/$/, "")}/cgi-bin/token`);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", process.env.WECHAT_MP_APP_ID || "");
  url.searchParams.set("secret", process.env.WECHAT_MP_APP_SECRET || "");
  const response = await fetchWithTimeout(fetchImpl, url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`微信公众号授权失败：${payload.errmsg || `HTTP ${response.status}`}`);
  wechatTokenCache = { value: payload.access_token, expiresAt: Date.now() + Math.max(300, Number(payload.expires_in || 7200)) * 1000 };
  return wechatTokenCache.value;
}

function shanghaiDate(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function wechatMessageId(target) {
  if (target.externalContentId) return String(target.externalContentId);
  try {
    const url = new URL(target.publicUrl);
    const mid = url.searchParams.get("mid");
    const idx = url.searchParams.get("idx") || "1";
    return mid ? `${mid}_${idx}` : undefined;
  } catch {
    return undefined;
  }
}

async function collectWechat(targets, fetchImpl) {
  const token = await getWechatAccessToken(fetchImpl);
  const apiBase = String(process.env.WECHAT_MP_API_BASE_URL || "https://api.weixin.qq.com").replace(/\/$/, "");
  const byDate = new Map();
  for (const target of targets) {
    const date = shanghaiDate(target.publishedAt);
    if (!byDate.has(date)) {
      const response = await fetchWithTimeout(fetchImpl, `${apiBase}/datacube/getarticletotal?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ begin_date: date, end_date: date })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.errcode) throw new Error(`微信公众号图文数据接口失败：${payload.errmsg || `HTTP ${response.status}`}`);
      byDate.set(date, Array.isArray(payload.list) ? payload.list : []);
    }
  }
  return targets.flatMap((target) => {
    const records = byDate.get(shanghaiDate(target.publishedAt)) || [];
    const messageId = wechatMessageId(target);
    const record = records.find((item) => messageId && String(item.msgid) === messageId)
      || records.find((item) => target.title && String(item.title || "").trim() === String(target.title).trim());
    if (!record) return [];
    const detail = Array.isArray(record.details) && record.details.length ? record.details.at(-1) : record;
    const metrics = {
      views: finiteMetric(detail.int_page_read_count ?? detail.ori_page_read_count),
      likes: finiteMetric(detail.int_page_like_count ?? detail.like_count),
      favorites: finiteMetric(detail.add_to_fav_count ?? detail.add_to_fav_user)
    };
    return containsMetric(metrics) ? [{ target, metrics }] : [];
  });
}

function extractHtmlMetric(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`(?:["']${escaped}["']|\\b${escaped}\\b)\\s*(?::|=)\\s*["']?([\\d,.万亿]+)`, "i"),
      new RegExp(`(?:data-${escaped}|id=["']${escaped}["'])[^>]*>\\s*([\\d,.万亿]+)`, "i")
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const metric = finiteMetric(match?.[1]);
      if (metric !== undefined) return metric;
    }
  }
  return undefined;
}

async function collectCsdn(target, fetchImpl) {
  const configured = await configuredMetrics("csdn", target, fetchImpl);
  if (configured) return configured;
  if (!target.publicUrl) throw new Error("CSDN 内容缺少公开链接。");
  const response = await fetchWithTimeout(fetchImpl, target.publicUrl, { headers: platformHeaders("csdn") });
  const html = await response.text();
  if (!response.ok) throw new Error(`CSDN 内容页返回 HTTP ${response.status}。`);
  const metrics = {
    views: extractHtmlMetric(html, ["viewCount", "viewCountFormat", "readCount", "articleReadCount"]) ?? finiteMetric(html.match(/浏览阅读\s*([\d,.万亿]+)\s*次/)?.[1]),
    likes: extractHtmlMetric(html, ["diggCount", "likeCount"]) ?? finiteMetric(html.match(/点赞\s*([\d,.万亿]+)\s*次/)?.[1]),
    favorites: extractHtmlMetric(html, ["collectCount", "favoriteCount"]) ?? finiteMetric(html.match(/收藏\s*([\d,.万亿]+)\s*次/)?.[1])
  };
  if (!containsMetric(metrics)) throw new Error("CSDN 页面未找到可识别的指标字段，请配置 CSDN_METRICS_URL_TEMPLATE。 ");
  return metrics;
}

async function collectJuejin(target, fetchImpl) {
  const configured = await configuredMetrics("juejin", target, fetchImpl);
  if (configured) return configured;
  const articleId = extractExternalId({ ...target, platform: "juejin" });
  if (!articleId) throw new Error("掘金内容缺少 article_id。");
  const response = await fetchWithTimeout(fetchImpl, process.env.JUEJIN_METRICS_API_URL || "https://api.juejin.cn/content_api/v1/article/detail", {
    method: "POST",
    headers: { ...platformHeaders("juejin"), "Content-Type": "application/json", Origin: "https://juejin.cn", Referer: target.publicUrl || "https://juejin.cn/" },
    body: JSON.stringify({ article_id: articleId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.err_no !== undefined && Number(payload.err_no) !== 0)) throw new Error(`掘金指标接口失败：${payload.err_msg || `HTTP ${response.status}`}`);
  const metrics = normalizeConfiguredMetrics("juejin", payload);
  if (!containsMetric(metrics)) throw new Error("掘金指标接口未返回文章指标。");
  return metrics;
}

async function collectZhihu(target, fetchImpl) {
  const configured = await configuredMetrics("zhihu", target, fetchImpl);
  if (configured) return configured;
  const articleId = extractExternalId({ ...target, platform: "zhihu" });
  if (!articleId) throw new Error("知乎内容缺少文章 ID。");
  const response = await fetchWithTimeout(fetchImpl, `${String(process.env.ZHIHU_API_BASE_URL || "https://www.zhihu.com/api/v4").replace(/\/$/, "")}/articles/${encodeURIComponent(articleId)}`, {
    headers: { ...platformHeaders("zhihu"), Referer: target.publicUrl || "https://zhuanlan.zhihu.com/" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`知乎指标接口返回 HTTP ${response.status}。`);
  const metrics = normalizeConfiguredMetrics("zhihu", payload);
  if (!containsMetric(metrics)) throw new Error("知乎指标接口未返回文章指标，请配置 ZHIHU_METRICS_PATHS_JSON。 ");
  return metrics;
}

async function checkAuthorization(platform, fetchImpl = fetch) {
  const missingConfig = REQUIRED_ENV[platform].filter((name) => !process.env[name]?.trim());
  if (missingConfig.length) return { platform, status: "pending_config", authenticated: false, checkedAt: nowIso(), message: `缺少 ${missingConfig.join(", ")}。`, missingConfig };
  try {
    if (platform === "wechat") {
      await getWechatAccessToken(fetchImpl);
      return { platform, status: "ready", authenticated: true, checkedAt: nowIso(), message: "微信公众号 access_token 校验通过。", missingConfig: [] };
    }
    const prefix = platform.toUpperCase();
    const url = process.env[`${prefix}_METRICS_AUTH_CHECK_URL`]?.trim() || process.env[`${prefix}_AUTH_CHECK_URL`]?.trim();
    if (!url) return { platform, status: "unverified", authenticated: false, checkedAt: nowIso(), message: "登录信息已配置，但尚未配置授权检查地址。", missingConfig: [`${prefix}_METRICS_AUTH_CHECK_URL`] };
    const response = await fetchWithTimeout(fetchImpl, url, { headers: platformHeaders(platform) });
    const payload = await readResponse(response);
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    const loginRequired = /登录|login|unauthorized|未授权/i.test(text);
    if (!response.ok || loginRequired) throw new Error(`HTTP ${response.status}${loginRequired ? "，平台要求重新登录" : ""}`);
    return { platform, status: "ready", authenticated: true, checkedAt: nowIso(), message: `${PLATFORM_LABELS[platform]}登录状态校验通过。`, missingConfig: [] };
  } catch (error) {
    return { platform, status: "auth_required", authenticated: false, checkedAt: nowIso(), message: error instanceof Error ? error.message : "授权检查失败。", missingConfig: [] };
  }
}

async function collectPlatformMetrics(platform, targets, fetchImpl = fetch) {
  let authorization = await checkAuthorization(platform, fetchImpl);
  if (authorization.status === "pending_config" || authorization.status === "auth_required") {
    return { platform, authorization, items: [], errors: targets.map((target) => ({ publishResultId: target.publishResultId, message: authorization.message })) };
  }
  const items = [];
  const errors = [];
  if (platform === "wechat") {
    try {
      for (const result of await collectWechat(targets, fetchImpl)) items.push({ ...result.target, ...result.metrics });
    } catch (error) {
      for (const target of targets) errors.push({ publishResultId: target.publishResultId, message: error instanceof Error ? error.message : "采集失败。" });
    }
  } else {
    for (const target of targets) {
      try {
        const metrics = platform === "csdn" ? await collectCsdn(target, fetchImpl) : platform === "juejin" ? await collectJuejin(target, fetchImpl) : await collectZhihu(target, fetchImpl);
        items.push({ ...target, ...metrics });
      } catch (error) {
        errors.push({ publishResultId: target.publishResultId, message: error instanceof Error ? error.message : "采集失败。" });
      }
    }
  }
  if (authorization.status === "unverified" && items.length) {
    authorization = { ...authorization, status: "ready", authenticated: true, message: `${PLATFORM_LABELS[platform]}指标读取成功，当前授权有效。`, missingConfig: [] };
  } else if (authorization.status === "unverified" && errors.some((error) => /HTTP\s*(401|403)|登录|unauthorized/i.test(error.message))) {
    authorization = { ...authorization, status: "auth_required", authenticated: false, message: `${PLATFORM_LABELS[platform]}拒绝了指标读取请求，请更新登录授权。`, missingConfig: [] };
  }
  return { platform, authorization, items, errors };
}

export {
  PLATFORMS,
  PLATFORM_LABELS,
  checkAuthorization,
  collectPlatformMetrics,
  extractExternalId,
  finiteMetric,
  normalizeConfiguredMetrics
};
