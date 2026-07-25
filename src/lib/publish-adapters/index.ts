import { checkFormalPublishAuth, submitFormalPublish, verifyFormalPublish } from "../formal-publish-client";
import type { DirectPublishPlatformKey, PlatformPublishPayload } from "../types";
import type { AuthStatus, PublishAdapter, PublishResult, ValidationResult, VerifyResult } from "./types";

const directPublishPlatforms: DirectPublishPlatformKey[] = ["wechat", "juejin", "csdn", "zhihu"];

function getMode(): "mock" | "real" | "disabled" {
  if (process.env.DIRECT_PUBLISH_ENABLED === "true") return "real";
  if (process.env.DIRECT_PUBLISH_MOCK === "false") return "disabled";
  return "mock";
}

function validateBasePayload(payload: PlatformPublishPayload): ValidationResult {
  if (!payload.scheduleId || !payload.contentHash || !payload.idempotencyKey) {
    return { ok: false, message: "正式发布载荷缺少幂等字段。", nextAction: "请重新创建发布排程，不要直接调用平台执行器。", failureCode: "payload_invalid" };
  }
  if (!payload.title.trim()) {
    return { ok: false, message: "标题不能为空。", nextAction: "请先回到终稿或矩阵项补齐标题。", failureCode: "payload_invalid" };
  }
  if (!payload.markdown.trim() || payload.markdown.trim().length < 80) {
    return { ok: false, message: "正文过短，不能进入正式发布。", nextAction: "请先生成或补齐终稿正文，再重新创建发布排程。", failureCode: "payload_invalid" };
  }
  if (Number.isNaN(new Date(payload.scheduledAt).getTime())) {
    return { ok: false, message: "定时发布时间不是有效时间。", nextAction: "请重新选择 scheduledAt。", failureCode: "payload_invalid" };
  }
  return { ok: true, message: "发布载荷校验通过。", nextAction: "可以进入正式发布预检查。" };
}

function mockPublish(platform: DirectPublishPlatformKey, payload: PlatformPublishPayload): PublishResult {
  return {
    ok: true,
    status: "published_pending_url",
    mode: "mock",
    publishStatus: "confirmed",
    idempotencyKey: payload.idempotencyKey,
    pendingCsvReturn: true,
    nextAction: "mock 已确认正式发布状态机；真实平台 URL 需通过后续 CSV 或人工回填。",
    diagnosticSummary: `${platform} mock direct publish completed without external platform write.`
  };
}

function disabledPublish(platform: DirectPublishPlatformKey, payload: PlatformPublishPayload): PublishResult {
  return {
    ok: false,
    status: "pending_config",
    mode: "dry_run",
    publishStatus: "failed",
    idempotencyKey: payload.idempotencyKey,
    pendingCsvReturn: true,
    failureCode: "pending_config",
    failureReason: `${platform} direct publish is disabled.`,
    nextAction: "配置 DIRECT_PUBLISH_ENABLED=true 接入真实发布，或保持 mock 用于本地验收。"
  };
}

function verifyLocalResult(result: PublishResult): VerifyResult {
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      verifyStatus: "failed",
      platformArticleId: result.platformArticleId,
      externalTaskId: result.externalTaskId,
      publicUrl: result.publicUrl,
      failureCode: result.failureCode || "verification_failed",
      failureReason: result.failureReason || "发布动作未成功，无法验证。",
      nextAction: result.nextAction
    };
  }
  return {
    ok: true,
    status: result.status,
    verifyStatus: result.status === "pending_verify" ? "pending" : "verified",
    platformArticleId: result.platformArticleId,
    externalTaskId: result.externalTaskId,
    publicUrl: result.publicUrl,
    pendingCsvReturn: result.pendingCsvReturn,
    nextAction: result.nextAction
  };
}

abstract class BaseDirectPublishAdapter implements PublishAdapter {
  abstract platform: DirectPublishPlatformKey;

  async checkAuth(): Promise<AuthStatus> {
    const mode = getMode();
    if (mode === "mock") {
      return { ok: true, status: "ready", message: `${this.platform} mock 正式发布预检查通过。`, nextAction: "可以执行本地状态机验收；真实发布前必须启动本机 bridge 和平台执行器。" };
    }
    if (mode === "disabled") {
      return { ok: false, status: "pending_config", message: `${this.platform} 正式发布未启用。`, nextAction: "完成本机配置与单篇验收后，再设置 DIRECT_PUBLISH_ENABLED=true。", missingConfig: ["DIRECT_PUBLISH_ENABLED"] };
    }
    return checkFormalPublishAuth(this.platform);
  }

  async validatePayload(payload: PlatformPublishPayload): Promise<ValidationResult> {
    return validateBasePayload(payload);
  }

  async publish(payload: PlatformPublishPayload): Promise<PublishResult> {
    const mode = getMode();
    if (mode === "mock") return mockPublish(this.platform, payload);
    if (mode === "disabled") return disabledPublish(this.platform, payload);
    return submitFormalPublish(this.platform, payload);
  }

  async verify(result: PublishResult): Promise<VerifyResult> {
    if (getMode() !== "real" || result.status !== "pending_verify") return verifyLocalResult(result);
    return verifyFormalPublish(this.platform, result);
  }
}

class WechatDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "wechat" as const;
}

class JuejinDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "juejin" as const;

  async validatePayload(payload: PlatformPublishPayload): Promise<ValidationResult> {
    const base = await super.validatePayload(payload);
    if (!base.ok) return base;
    if (getMode() === "real" && (!payload.categoryId || !payload.tagIds?.length)) {
      return { ok: false, message: "掘金正式发布缺少分类或标签。", nextAction: "请补齐 JUEJIN_CATEGORY_ID 和 JUEJIN_TAG_IDS 后重新创建排程。", failureCode: "payload_invalid" };
    }
    return base;
  }
}

class CsdnDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "csdn" as const;
}

class ZhihuDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "zhihu" as const;

  async checkAuth(): Promise<AuthStatus> {
    if (process.env.ZHIHU_MANUAL_TAKEOVER_REQUIRED === "true") {
      return { ok: false, status: "manual_takeover_required", message: "知乎当前需要人工接管。", nextAction: "请人工处理验证码、手机确认或平台安全挑战；系统不会尝试绕过风控。" };
    }
    return super.checkAuth();
  }
}

const adapters: Record<DirectPublishPlatformKey, PublishAdapter> = {
  wechat: new WechatDirectPublishAdapter(),
  juejin: new JuejinDirectPublishAdapter(),
  csdn: new CsdnDirectPublishAdapter(),
  zhihu: new ZhihuDirectPublishAdapter()
};

export function getPublishAdapter(platform: DirectPublishPlatformKey): PublishAdapter {
  return adapters[platform];
}

export function getDirectPublishPlatforms() {
  return [...directPublishPlatforms];
}

export function coerceDirectPublishPlatform(value: unknown): DirectPublishPlatformKey | undefined {
  return directPublishPlatforms.includes(value as DirectPublishPlatformKey) ? (value as DirectPublishPlatformKey) : undefined;
}
