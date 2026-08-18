const WORKBENCH_COVER_PREFIX = "workbench-cover:";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parseWorkbenchCoverReference(value) {
  const reference = String(value || "").trim();
  if (!reference.startsWith(WORKBENCH_COVER_PREFIX)) return undefined;
  const batchId = reference.slice(WORKBENCH_COVER_PREFIX.length).trim();
  return /^free-batch-[0-9a-f-]+$/i.test(batchId) ? batchId : null;
}

function trustedBaseUrl(value) {
  const url = new URL(String(value || "http://127.0.0.1:3027"));
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("WECHATSYNC_WORKBENCH_ASSET_BASE_URL must use loopback HTTP.");
  }
  return url;
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

export async function fetchWorkbenchCover(reference, options = {}) {
  const batchId = parseWorkbenchCoverReference(reference);
  if (batchId === undefined) return undefined;
  if (batchId === null) throw new Error("工作台封面引用格式无效。");

  const baseUrl = trustedBaseUrl(options.baseUrl);
  const url = new URL(`/api/v5/free-production/batches/${encodeURIComponent(batchId)}/cover`, baseUrl);
  url.searchParams.set("purpose", "publish");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Number(options.timeoutMs || 15_000)));
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      method: "GET",
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`工作台封面读取失败：HTTP ${response.status}`);

    const mimeType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error(`工作台封面类型不受支持：${mimeType || "unknown"}`);

    const declaredLength = Number(response.headers.get("content-length") || 0);
    const maximumBytes = Math.max(1, Number(options.maximumBytes || 5 * 1024 * 1024));
    if (declaredLength > maximumBytes) throw new Error("工作台封面超过 5 MB 限制。");

    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > maximumBytes) throw new Error("工作台封面为空或超过 5 MB 限制。");
    return { data, mimeType, fileName: `wechat-cover-${batchId}${extensionForMimeType(mimeType)}` };
  } finally {
    clearTimeout(timeout);
  }
}
