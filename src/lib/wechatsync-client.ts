import type { DistributionPlatformKey, DistributionTargetErrorCode } from "./types";

export interface WechatsyncRuntimeStatus {
  enabled: boolean;
  mode: "mock" | "real" | "disabled";
  bridgeUrl?: string;
  bridgeStatus: "ready" | "pending_config" | "unreachable" | "failed";
  extensionStatus: "connected" | "disconnected" | "unknown";
  supportedPlatforms: DistributionPlatformKey[];
  checkedAt: string;
  message: string;
  nextAction: string;
}

export interface WechatsyncAuthResult {
  authenticated: boolean;
  message: string;
  nextAction: string;
}

interface WechatsyncSendDraftBaseInput {
  platform: DistributionPlatformKey;
  title: string;
  coverUrl?: string;
}

export type WechatsyncSendDraftInput = WechatsyncSendDraftBaseInput & (
  | { contentFormat?: "markdown"; markdown: string; html?: never }
  | { contentFormat: "wechat_html"; html: string; markdown?: never }
);

export interface WechatsyncSendDraftResult {
  status: "draft_created" | "failed";
  mode: "mock" | "real";
  draftUrl?: string;
  editorUrl?: string;
  externalDraftId?: string;
  errorCode?: DistributionTargetErrorCode;
  message: string;
}

const supportedPlatforms: DistributionPlatformKey[] = ["juejin", "zhihu", "csdn", "weixin"];

function nowIso() {
  return new Date().toISOString();
}

function isLocalBridgeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getBridgeUrl() {
  return process.env.WECHATSYNC_BRIDGE_URL || "http://127.0.0.1:9528";
}

function getClientMode(): "mock" | "real" | "disabled" {
  if (process.env.WECHATSYNC_ENABLED === "true") {
    return "real";
  }

  if (process.env.WECHATSYNC_MOCK === "false") {
    return "disabled";
  }

  return "mock";
}

async function fetchBridge(path: string, init?: RequestInit) {
  const bridgeUrl = getBridgeUrl();

  if (!isLocalBridgeUrl(bridgeUrl)) {
    throw new Error("WECHATSYNC_BRIDGE_URL must point to localhost.");
  }

  const headers = new Headers(init?.headers);
  const token = process.env.WECHATSYNC_BRIDGE_TOKEN;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${bridgeUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers
  });
}

export async function getWechatsyncRuntimeStatus(): Promise<WechatsyncRuntimeStatus> {
  const mode = getClientMode();
  const bridgeUrl = getBridgeUrl();

  if (mode === "disabled") {
    return {
      enabled: false,
      mode,
      bridgeUrl: isLocalBridgeUrl(bridgeUrl) ? bridgeUrl : undefined,
      bridgeStatus: "pending_config",
      extensionStatus: "unknown",
      supportedPlatforms,
      checkedAt: nowIso(),
      message: "本机平台草稿分发未启用。",
      nextAction: "如需真实接入，请配置 WECHATSYNC_ENABLED=true 并启动 Wechatsync 本机桥接。"
    };
  }

  if (mode === "mock") {
    return {
      enabled: true,
      mode,
      bridgeUrl: "local-mock://wechatsync",
      bridgeStatus: "ready",
      extensionStatus: "connected",
      supportedPlatforms,
      checkedAt: nowIso(),
      message: "本地模拟分发已启用，用于开发和 smoke 验收，不代表真实平台草稿。",
      nextAction: "真实发布前切换到 WECHATSYNC_ENABLED=true，并确认 Chrome 扩展已连接。"
    };
  }

  if (!isLocalBridgeUrl(bridgeUrl)) {
    return {
      enabled: false,
      mode,
      bridgeStatus: "failed",
      extensionStatus: "unknown",
      supportedPlatforms: [],
      checkedAt: nowIso(),
      message: "本机分发地址必须指向 localhost。",
      nextAction: "请把 WECHATSYNC_BRIDGE_URL 设置为 http://127.0.0.1 的本机端口。"
    };
  }

  try {
    const response = await fetchBridge("/status", { method: "GET" });

    if (!response.ok) {
      return {
        enabled: true,
        mode,
        bridgeUrl,
        bridgeStatus: "unreachable",
        extensionStatus: "unknown",
        supportedPlatforms,
        checkedAt: nowIso(),
        message: `本机 Wechatsync bridge 返回 ${response.status}。`,
        nextAction: "请确认 Wechatsync bridge 已启动，且 Chrome 扩展处于连接状态。"
      };
    }

    const payload = (await response.json().catch(() => ({}))) as { supportedPlatforms?: DistributionPlatformKey[] };
    const bridgeSupportedPlatforms = Array.isArray(payload.supportedPlatforms) && payload.supportedPlatforms.length ? payload.supportedPlatforms : supportedPlatforms;

    return {
      enabled: true,
      mode,
      bridgeUrl,
      bridgeStatus: "ready",
      extensionStatus: "connected",
      supportedPlatforms: bridgeSupportedPlatforms,
      checkedAt: nowIso(),
      message: "本机 Wechatsync bridge 已连接。",
      nextAction: "可以检查平台登录态后发送平台草稿。"
    };
  } catch (error) {
    return {
      enabled: true,
      mode,
      bridgeUrl,
      bridgeStatus: "unreachable",
      extensionStatus: "unknown",
      supportedPlatforms,
      checkedAt: nowIso(),
      message: error instanceof Error ? error.message : "本机 Wechatsync bridge 不可达。",
      nextAction: "请先启动本机 bridge，或暂时使用人工发布路径。"
    };
  }
}

export async function checkWechatsyncAuth(platform: DistributionPlatformKey): Promise<WechatsyncAuthResult> {
  const runtime = await getWechatsyncRuntimeStatus();

  if (runtime.mode === "mock") {
    return {
      authenticated: true,
      message: "本地模拟登录态已通过。",
      nextAction: "可以发送模拟平台草稿；真实发布前需在浏览器中登录平台后台。"
    };
  }

  if (runtime.bridgeStatus !== "ready") {
    return {
      authenticated: false,
      message: runtime.message,
      nextAction: runtime.nextAction
    };
  }

  if (!runtime.supportedPlatforms.includes(platform)) {
    return {
      authenticated: false,
      message: `平台 ${platform} 尚未接入真实 bridge。`,
      nextAction: "先完成微信公众号真实草稿链路，再按平台补浏览器或官方 API 适配。"
    };
  }

  try {
    const response = await fetchBridge("/auth/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform })
    });

    if (!response.ok) {
      return {
        authenticated: false,
        message: "平台登录态检查失败。",
        nextAction: "请先在浏览器中打开并登录该平台后台，再回工作台重试。"
      };
    }

    const payload = (await response.json().catch(() => ({}))) as { authenticated?: boolean; message?: string; nextAction?: string };
    const authenticated = payload.authenticated !== false;

    return {
      authenticated,
      message: payload.message || (authenticated ? "平台已登录。" : "平台未登录。"),
      nextAction: payload.nextAction || (authenticated ? "可以发送平台草稿。" : "请先在浏览器中登录该平台后台。")
    };
  } catch {
    return {
      authenticated: false,
      message: "平台登录态检查失败。",
      nextAction: "请确认本机 bridge 和浏览器扩展连接正常。"
    };
  }
}

export async function sendWechatsyncDraft(input: WechatsyncSendDraftInput): Promise<WechatsyncSendDraftResult> {
  const runtime = await getWechatsyncRuntimeStatus();

  if (input.contentFormat === "wechat_html" && input.platform !== "weixin") {
    return {
      status: "failed",
      mode: runtime.mode === "real" ? "real" : "mock",
      errorCode: "platform_not_supported",
      message: "wechat_html 仅允许发送到微信公众号。"
    };
  }

  if (!supportedPlatforms.includes(input.platform)) {
    return {
      status: "failed",
      mode: runtime.mode === "real" ? "real" : "mock",
      errorCode: "platform_not_supported",
      message: "当前平台暂不支持平台草稿分发。"
    };
  }

  if (runtime.mode === "real" && !runtime.supportedPlatforms.includes(input.platform)) {
    return {
      status: "failed",
      mode: "real",
      errorCode: "platform_not_supported",
      message: `平台 ${input.platform} 尚未接入真实 bridge。`
    };
  }

  if (runtime.mode === "mock") {
    const externalDraftId = `mock-${input.platform}-${Date.now()}`;

    return {
      status: "draft_created",
      mode: "mock",
      draftUrl: `local-mock://wechatsync/${input.platform}/${externalDraftId}`,
      editorUrl: `local-mock://wechatsync/${input.platform}/${externalDraftId}/edit`,
      externalDraftId,
      message: "本地模拟平台草稿已创建；真实平台尚未写入。"
    };
  }

  if (runtime.bridgeStatus !== "ready") {
    return {
      status: "failed",
      mode: "real",
      errorCode: runtime.bridgeStatus === "pending_config" ? "bridge_not_configured" : "bridge_unreachable",
      message: runtime.message
    };
  }

  const auth = await checkWechatsyncAuth(input.platform);

  if (!auth.authenticated) {
    return {
      status: "failed",
      mode: "real",
      errorCode: "auth_required",
      message: auth.message
    };
  }

  try {
    const response = await fetchBridge("/sync_article", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platforms: [input.platform],
        title: input.title,
        contentFormat: input.contentFormat || "markdown",
        content: input.contentFormat === "wechat_html" ? input.html : input.markdown,
        coverUrl: input.coverUrl
      })
    });

    if (!response.ok) {
      return {
        status: "failed",
        mode: "real",
        errorCode: response.status === 408 ? "timeout" : "sync_failed",
        message: `平台草稿创建失败：${response.status}`
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      draftUrl?: string;
      editorUrl?: string;
      externalDraftId?: string;
      message?: string;
    };

    return {
      status: "draft_created",
      mode: "real",
      draftUrl: payload.draftUrl,
      editorUrl: payload.editorUrl,
      externalDraftId: payload.externalDraftId,
      message: payload.message || "平台草稿已创建。"
    };
  } catch (error) {
    return {
      status: "failed",
      mode: "real",
      errorCode: error instanceof Error && /timeout/i.test(error.message) ? "timeout" : "sync_failed",
      message: error instanceof Error ? error.message : "平台草稿创建失败。"
    };
  }
}
