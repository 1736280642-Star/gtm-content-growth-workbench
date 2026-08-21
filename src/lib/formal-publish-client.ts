import type { DirectPublishPlatformKey, PlatformPublishPayload, PublishAttemptStatus, PublishFailureCode } from "./types";
import type { AuthStatus, PublishResult, VerifyResult } from "./publish-adapters/types";
import { executeGovernedBrowserOperation } from "./v5/browser-executor-pool";

type BridgePlatform = "weixin" | "csdn" | "juejin" | "zhihu";

interface BridgePublishResponse {
  ok?: boolean;
  status?: PublishAttemptStatus;
  publishStatus?: PublishResult["publishStatus"];
  platformArticleId?: string;
  externalTaskId?: string;
  externalDraftId?: string;
  editorUrl?: string;
  publicUrl?: string;
  pendingCsvReturn?: boolean;
  failureCode?: PublishFailureCode;
  failureReason?: string;
  message?: string;
  nextAction?: string;
  diagnosticSummary?: string;
  duplicateProtected?: boolean;
}

const allowedStatuses: PublishAttemptStatus[] = [
  "precheck_failed",
  "publishing",
  "published_verified",
  "published_pending_url",
  "pending_verify",
  "public_observed",
  "stable_published",
  "platform_rejected",
  "removed_after_publish",
  "risk_blocked",
  "verification_timeout",
  "auth_expired",
  "failed",
  "manual_takeover_required",
  "pending_config"
];

function bridgePlatform(platform: DirectPublishPlatformKey): BridgePlatform {
  return platform === "wechat" ? "weixin" : platform;
}

function getBridgeUrl() {
  return process.env.WECHATSYNC_BRIDGE_URL || "http://127.0.0.1:9528";
}

function isLocalBridgeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getBridgeConfigError(): AuthStatus | undefined {
  const bridgeUrl = getBridgeUrl();
  const token = process.env.WECHATSYNC_BRIDGE_TOKEN?.trim();

  if (!isLocalBridgeUrl(bridgeUrl)) {
    return {
      ok: false,
      status: "pending_config",
      message: "正式发布 bridge 必须监听本机地址。",
      nextAction: "请把 WECHATSYNC_BRIDGE_URL 配置为 127.0.0.1、localhost 或 ::1。",
      missingConfig: ["WECHATSYNC_BRIDGE_URL"]
    };
  }

  if (!token) {
    return {
      ok: false,
      status: "pending_config",
      message: "正式发布 bridge 尚未配置访问令牌。",
      nextAction: "请在本机 .env.local 配置 WECHATSYNC_BRIDGE_TOKEN，且不要把令牌写入文档或聊天。",
      missingConfig: ["WECHATSYNC_BRIDGE_TOKEN"]
    };
  }
}

async function fetchBridge(path: string, body: Record<string, unknown>) {
  const configError = getBridgeConfigError();
  if (configError) throw new Error(configError.message);

  const controller = new AbortController();
  const timeoutMs = Math.max(5_000, Number(process.env.DIRECT_PUBLISH_TIMEOUT_MS || 120_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${getBridgeUrl().replace(/\/$/, "")}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.WECHATSYNC_BRIDGE_TOKEN?.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatus(value: unknown, fallback: PublishAttemptStatus): PublishAttemptStatus {
  return allowedStatuses.includes(value as PublishAttemptStatus) ? (value as PublishAttemptStatus) : fallback;
}

function failureCodeForResponse(response: Response): PublishFailureCode {
  if (response.status === 401 || response.status === 403) return "auth_required";
  if (response.status === 409) return "duplicate_protected";
  return "adapter_failed";
}

export async function checkFormalPublishAuth(platform: DirectPublishPlatformKey, browserProfileRef?: string): Promise<AuthStatus> {
  const configError = getBridgeConfigError();
  if (configError) return configError;

  try {
    const response = await fetchBridge("/auth/check", {
      platform: bridgePlatform(platform),
      purpose: "formal_publish",
      ...(browserProfileRef ? { profileRef: browserProfileRef } : {})
    });
    const payload = (await response.json().catch(() => ({}))) as {
      authenticated?: boolean;
      status?: AuthStatus["status"];
      message?: string;
      nextAction?: string;
      missingConfig?: string[];
    };

    return {
      ok: response.ok && payload.authenticated === true,
      status: payload.status || (response.status === 401 ? "auth_required" : response.ok ? "ready" : "failed"),
      message: payload.message || (response.ok ? `${platform} 正式发布登录态可用。` : `${platform} 正式发布登录态不可用。`),
      nextAction: payload.nextAction || (response.ok ? "可以执行正式发布。" : "请检查本机 runner、平台登录态和发布权限。"),
      missingConfig: payload.missingConfig
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "本机正式发布 bridge 不可达。",
      nextAction: "请启动本机 bridge 和 Arcs runner 后重试预检查。"
    };
  }
}

export interface FormalPublishAuthorizationResult {
  ok: boolean;
  status: "waiting_for_user" | "manual_takeover_required" | "failed" | "unsupported";
  message: string;
  nextAction: string;
}

export async function openFormalPublishAuthorization(platform: DirectPublishPlatformKey): Promise<FormalPublishAuthorizationResult> {
  if (!(["csdn", "juejin", "zhihu"] as DirectPublishPlatformKey[]).includes(platform)) {
    return {
      ok: false,
      status: "unsupported",
      message: "该渠道不使用专用浏览器授权。",
      nextAction: "返回托管设置选择知乎、CSDN 或掘金。"
    };
  }
  const configError = getBridgeConfigError();
  if (configError) {
    return {
      ok: false,
      status: "failed",
      message: configError.message,
      nextAction: configError.nextAction || "请先完成本机发布 Bridge 配置。"
    };
  }
  try {
    const response = await fetchBridge("/auth/connect", { platform: bridgePlatform(platform), purpose: "formal_publish" });
    const payload = (await response.json().catch(() => ({}))) as Partial<FormalPublishAuthorizationResult>;
    return {
      ok: response.ok && payload.ok === true,
      status: payload.status || (response.ok ? "waiting_for_user" : "failed"),
      message: payload.message || (response.ok ? "专用登录窗口已打开。" : "专用登录窗口启动失败。"),
      nextAction: payload.nextAction || "完成登录后回到工作台重新检查。"
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "本机发布 Bridge 不可达。",
      nextAction: "启动本机发布 Bridge 与 Arcs Runner 后重试。"
    };
  }
}

export async function submitFormalPublish(platform: DirectPublishPlatformKey, payload: PlatformPublishPayload): Promise<PublishResult> {
  try {
    let responseOk: boolean;
    let responseStatus: number;
    let result: BridgePublishResponse;
    if (payload.accountConnectionId) {
      const execution = await executeGovernedBrowserOperation({
        accountConnectionId: payload.accountConnectionId,
        operation: "publish",
        channel: platform,
        idempotencyKey: payload.idempotencyKey,
        command: { ...payload, platform: bridgePlatform(platform) }
      });
      result = execution.result as BridgePublishResponse;
      if (!execution.ok && !Object.keys(result).length) {
        const executorUnavailable = execution.failureCode === "executor_unavailable";
        const actionUnconfirmed = execution.failureCode === "executor_timeout" || execution.failureCode === "publish_action_unconfirmed";
        result = {
          ok: false,
          status: executorUnavailable ? "pending_config" : actionUnconfirmed ? "pending_verify" : "failed",
          failureCode: executorUnavailable ? "pending_config" : actionUnconfirmed ? "publish_action_unconfirmed" : "adapter_failed",
          failureReason: execution.failureMessage,
          nextAction: executorUnavailable
            ? "等待浏览器执行节点上线；当前排程会保留，不要重复创建。"
            : actionUnconfirmed
              ? "平台动作可能已经发生；不要重复发布，只执行只读验证。"
              : "检查浏览器执行节点和平台后台后再决定是否重试。"
        };
      }
      responseOk = execution.ok;
      responseStatus = execution.ok ? 200 : 503;
    } else {
      const response = await fetchBridge("/publish", { platform: bridgePlatform(platform), ...payload });
      responseOk = response.ok;
      responseStatus = response.status;
      result = (await response.json().catch(() => ({}))) as BridgePublishResponse;
    }
    const status = normalizeStatus(result.status, responseOk ? "pending_verify" : "failed");

    return {
      ok: responseOk && result.ok !== false,
      status,
      mode: "real",
      publishStatus: result.publishStatus,
      platformArticleId: result.platformArticleId,
      externalTaskId: result.externalTaskId,
      externalDraftId: result.externalDraftId,
      editorUrl: result.editorUrl,
      publicUrl: result.publicUrl,
      idempotencyKey: payload.idempotencyKey,
      pendingCsvReturn: result.pendingCsvReturn,
      failureCode: result.failureCode || (!responseOk ? responseStatus === 401 || responseStatus === 403 ? "auth_required" : "adapter_failed" : undefined),
      failureReason: result.failureReason || (!responseOk ? result.message || `publish executor HTTP ${responseStatus}` : undefined),
      nextAction: result.nextAction || (responseOk ? "等待发布验证。" : "请检查发布尝试详情后处理。"),
      diagnosticSummary: result.duplicateProtected ? "duplicate_protected_by_bridge" : result.diagnosticSummary
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      mode: "real",
      publishStatus: "failed",
      idempotencyKey: payload.idempotencyKey,
      failureCode: "adapter_failed",
      failureReason: error instanceof Error ? error.message : "本机正式发布 bridge 调用失败。",
      nextAction: "不要盲目重试；先检查平台后台是否已生成文章，再创建新的发布排程。"
    };
  }
}

export async function verifyFormalPublish(platform: DirectPublishPlatformKey, result: PublishResult, publishPayload?: PlatformPublishPayload): Promise<VerifyResult> {
  if (!result.idempotencyKey) {
    return {
      ok: false,
      status: "pending_verify",
      verifyStatus: "pending",
      platformArticleId: result.platformArticleId,
      externalTaskId: result.externalTaskId,
      publicUrl: result.publicUrl,
      pendingCsvReturn: true,
      failureCode: "verification_failed",
      failureReason: "发布结果缺少 idempotencyKey，不能安全执行远端验证。",
      nextAction: "请先检查平台后台，再由人工回填发布结果。"
    };
  }

  try {
    const verifyPayload = {
      platform: bridgePlatform(platform),
      idempotencyKey: result.idempotencyKey,
      platformArticleId: result.platformArticleId,
      externalTaskId: result.externalTaskId,
      publicUrl: result.publicUrl
    };
    let responseOk: boolean;
    let payload: BridgePublishResponse;
    if (publishPayload?.accountConnectionId) {
      const execution = await executeGovernedBrowserOperation({
        accountConnectionId: publishPayload.accountConnectionId,
        operation: "verify",
        channel: platform,
        idempotencyKey: result.idempotencyKey,
        command: verifyPayload
      });
      responseOk = execution.ok;
      payload = execution.result as BridgePublishResponse;
    } else {
      const response = await fetchBridge("/publish/verify", verifyPayload);
      responseOk = response.ok;
      payload = (await response.json().catch(() => ({}))) as BridgePublishResponse;
    }
    const status = normalizeStatus(payload.status, responseOk ? "pending_verify" : "failed");

    return {
      ok: responseOk && payload.ok !== false,
      status,
      publishStatus: payload.publishStatus,
      verifyStatus:
        ["published_verified", "public_observed", "stable_published"].includes(status)
          ? "verified"
          : ["published_pending_url", "pending_verify"].includes(status)
            ? "pending"
            : "failed",
      platformArticleId: payload.platformArticleId || result.platformArticleId,
      externalTaskId: payload.externalTaskId || result.externalTaskId,
      publicUrl: payload.publicUrl || result.publicUrl,
      pendingCsvReturn: payload.pendingCsvReturn ?? !payload.publicUrl,
      failureCode: payload.failureCode,
      failureReason: payload.failureReason || (!responseOk ? payload.message : undefined),
      nextAction: payload.nextAction || (status === "pending_verify" ? "平台仍在处理，稍后只执行验证，不要重复发布。" : "发布验证已完成。")
    };
  } catch (error) {
    return {
      ok: false,
      status: "pending_verify",
      verifyStatus: "pending",
      platformArticleId: result.platformArticleId,
      externalTaskId: result.externalTaskId,
      publicUrl: result.publicUrl,
      pendingCsvReturn: true,
      failureCode: platform === "wechat" ? "verification_failed" : "publish_action_unconfirmed",
      failureReason: error instanceof Error ? error.message : "正式发布验证调用失败。",
      nextAction: "不要重复发布；恢复本机 bridge 后只执行验证。"
    };
  }
}
