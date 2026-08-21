import { createHash } from "node:crypto";

export type WechatVisualImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface WechatVisualImageResult {
  ok: boolean;
  status: "success" | "pending_config" | "failed";
  provider: string;
  model?: string;
  data?: Buffer;
  mimeType?: WechatVisualImageMimeType;
  requestId?: string;
  missingConfig?: string[];
  errorMessage?: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function configuredValue(name: string) {
  return process.env[name]?.trim() || "";
}

function safeProviderMessage(value: unknown, fallback: string) {
  let message = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const credential = configuredValue("WECHAT_VISUAL_IMAGE_API_KEY");
  if (credential) message = message.replaceAll(credential, "[REDACTED]");
  return message.slice(0, 500);
}

export function getWechatVisualImageProviderStatus() {
  const missingConfig = ["WECHAT_VISUAL_IMAGE_BASE_URL", "WECHAT_VISUAL_IMAGE_API_KEY", "WECHAT_VISUAL_IMAGE_MODEL"]
    .filter((name) => !configuredValue(name));
  return {
    status: missingConfig.length ? "pending_config" as const : "ready" as const,
    label: configuredValue("WECHAT_VISUAL_IMAGE_PROVIDER_LABEL") || "OpenAI-compatible Images API",
    missingConfig
  };
}

function detectImage(data: Buffer): WechatVisualImageMimeType | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

function providerEndpoint(baseUrl: string) {
  const parsed = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("图片 Provider 地址只允许 HTTP 或 HTTPS。");
  const endpoint = configuredValue("WECHAT_VISUAL_IMAGE_ENDPOINT") || "images/generations";
  return new URL(endpoint.replace(/^\/+/, ""), parsed);
}

async function readProviderImage(value: Record<string, unknown>, fetchImpl: typeof fetch) {
  const base64 = typeof value.b64_json === "string" ? value.b64_json : "";
  if (base64) return Buffer.from(base64, "base64");
  const remoteUrl = typeof value.url === "string" ? value.url.trim() : "";
  if (!remoteUrl) throw new Error("图片 Provider 未返回 b64_json 或 url。");
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "https:") throw new Error("图片 Provider 返回的图片 URL 必须使用 HTTPS。");
  const response = await fetchImpl(parsed, { method: "GET", redirect: "error" });
  if (!response.ok) throw new Error(`候选图片下载失败：HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error("候选图片超过 5 MB 限制。");
  return Buffer.from(await response.arrayBuffer());
}

export async function generateWechatVisualImage(input: {
  prompt: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<WechatVisualImageResult> {
  const provider = getWechatVisualImageProviderStatus();
  const providerName = provider.label;
  if (provider.status === "pending_config") {
    return { ok: false, status: "pending_config", provider: providerName, missingConfig: provider.missingConfig };
  }

  const fetchImpl = input.fetchImpl || fetch;
  const controller = new AbortController();
  const timeoutMs = Math.max(10_000, Math.min(300_000, Number(configuredValue("WECHAT_VISUAL_IMAGE_TIMEOUT_MS") || 180_000)));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const model = configuredValue("WECHAT_VISUAL_IMAGE_MODEL");
  try {
    const response = await fetchImpl(providerEndpoint(configuredValue("WECHAT_VISUAL_IMAGE_BASE_URL")), {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${configuredValue("WECHAT_VISUAL_IMAGE_API_KEY")}`,
        "content-type": "application/json",
        "x-idempotency-key": input.idempotencyKey
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: 1,
        size: configuredValue("WECHAT_VISUAL_IMAGE_SIZE") || "1792x768",
        response_format: "b64_json"
      })
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : undefined;
      return { ok: false, status: "failed", provider: providerName, model, requestId: response.headers.get("x-request-id") || undefined, errorMessage: safeProviderMessage(error?.message, `图片 Provider 请求失败：HTTP ${response.status}`) };
    }
    const images = Array.isArray(payload.data) ? payload.data : [];
    const first = images[0] && typeof images[0] === "object" ? images[0] as Record<string, unknown> : undefined;
    if (!first) return { ok: false, status: "failed", provider: providerName, model, errorMessage: "图片 Provider 返回空结果。" };
    const data = await readProviderImage(first, fetchImpl);
    if (!data.length || data.length > MAX_IMAGE_BYTES) return { ok: false, status: "failed", provider: providerName, model, errorMessage: "候选图片为空或超过 5 MB 限制。" };
    const mimeType = detectImage(data);
    if (!mimeType) return { ok: false, status: "failed", provider: providerName, model, errorMessage: "图片 Provider 返回了不支持的图片格式。" };
    return {
      ok: true,
      status: "success",
      provider: providerName,
      model,
      data,
      mimeType,
      requestId: response.headers.get("x-request-id") || createHash("sha256").update(data).digest("hex").slice(0, 20)
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `图片生成超时，超过 ${timeoutMs}ms 未返回。`
      : error instanceof Error ? error.message : "图片生成失败。";
    return { ok: false, status: "failed", provider: providerName, model, errorMessage: safeProviderMessage(message, "图片生成失败。") };
  } finally {
    clearTimeout(timeout);
  }
}
