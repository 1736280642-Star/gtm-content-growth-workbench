import type { DirectPublishPlatformKey, PlatformPublishPayload } from "../types";
import type { AuthStatus, PublishAdapter, PublishResult, ValidationResult, VerifyResult } from "./types";

const directPublishPlatforms: DirectPublishPlatformKey[] = ["wechat", "juejin", "csdn", "zhihu"];

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function getMode(): "mock" | "real" | "disabled" {
  if (process.env.DIRECT_PUBLISH_ENABLED === "true") {
    return "real";
  }

  if (process.env.DIRECT_PUBLISH_MOCK === "false") {
    return "disabled";
  }

  return "mock";
}

function missing(names: string[]) {
  return names.filter((name) => !hasEnv(name));
}

function createPendingConfigAuth(platform: DirectPublishPlatformKey, missingConfig: string[], nextAction: string): AuthStatus {
  return {
    ok: false,
    status: "pending_config",
    message: `${platform} 正式发布配置未就绪。`,
    nextAction,
    missingConfig
  };
}

function validateBasePayload(payload: PlatformPublishPayload): ValidationResult {
  if (!payload.title.trim()) {
    return {
      ok: false,
      message: "标题不能为空。",
      nextAction: "请先回到终稿或矩阵项补齐标题。",
      failureCode: "payload_invalid"
    };
  }

  if (!payload.markdown.trim() || payload.markdown.trim().length < 80) {
    return {
      ok: false,
      message: "正文过短，不能进入正式发布。",
      nextAction: "请先生成或补齐终稿正文，再重新创建发布排程。",
      failureCode: "payload_invalid"
    };
  }

  if (Number.isNaN(new Date(payload.scheduledAt).getTime())) {
    return {
      ok: false,
      message: "定时发布时间不是有效时间。",
      nextAction: "请重新选择 scheduledAt。",
      failureCode: "payload_invalid"
    };
  }

  return {
    ok: true,
    message: "发布载荷校验通过。",
    nextAction: "可以进入正式发布预检查。"
  };
}

function mockPublish(platform: DirectPublishPlatformKey): PublishResult {
  return {
    ok: true,
    status: "published_pending_url",
    mode: "mock",
    publishStatus: "confirmed",
    pendingCsvReturn: true,
    nextAction: "mock 已确认正式发布状态机；真实平台 URL 需通过后续 CSV 或人工回填。",
    diagnosticSummary: `${platform} mock direct publish completed without external platform write.`
  };
}

function disabledPublish(platform: DirectPublishPlatformKey): PublishResult {
  return {
    ok: false,
    status: "pending_config",
    mode: "dry_run",
    publishStatus: "failed",
    pendingCsvReturn: true,
    failureCode: "pending_config",
    failureReason: `${platform} direct publish is disabled.`,
    nextAction: "配置 DIRECT_PUBLISH_ENABLED=true 接入真实发布，或保持 mock 用于本地验收。"
  };
}

function verifyPublishResult(result: PublishResult): VerifyResult {
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      verifyStatus: "failed",
      failureCode: result.failureCode || "verification_failed",
      failureReason: result.failureReason || "发布动作未成功，无法验证。",
      nextAction: result.nextAction
    };
  }

  if (result.status === "published_verified") {
    return {
      ok: true,
      status: "published_verified",
      verifyStatus: "verified",
      platformArticleId: result.platformArticleId,
      publicUrl: result.publicUrl,
      pendingCsvReturn: false,
      nextAction: "平台已返回可验证正式发布结果。"
    };
  }

  return {
    ok: true,
    status: "published_pending_url",
    verifyStatus: "verified",
    platformArticleId: result.platformArticleId,
    publicUrl: result.publicUrl,
    pendingCsvReturn: true,
    nextAction: "发布已确认；公开 URL 等待后续 CSV 回传或人工回填。"
  };
}

abstract class BaseDirectPublishAdapter implements PublishAdapter {
  abstract platform: DirectPublishPlatformKey;

  abstract checkAuth(): Promise<AuthStatus>;

  async validatePayload(payload: PlatformPublishPayload): Promise<ValidationResult> {
    return validateBasePayload(payload);
  }

  async publish(_payload: PlatformPublishPayload): Promise<PublishResult> {
    const mode = getMode();

    if (mode === "mock") {
      return mockPublish(this.platform);
    }

    return disabledPublish(this.platform);
  }

  async verify(result: PublishResult): Promise<VerifyResult> {
    return verifyPublishResult(result);
  }
}

class WechatDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "wechat" as const;

  async checkAuth(): Promise<AuthStatus> {
    if (getMode() === "mock") {
      return {
        ok: true,
        status: "ready",
        message: "微信公众号 mock 正式发布预检查通过。",
        nextAction: "可以执行本地状态机验收；真实发布前必须补齐官方 API 配置。"
      };
    }

    const missingConfig = missing(["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET", "WECHAT_MP_THUMB_MEDIA_ID"]);

    if (missingConfig.length) {
      return createPendingConfigAuth(
        this.platform,
        missingConfig,
        "请在本机环境变量补齐公众号 AppID、AppSecret 和永久封面 media_id；不要在文档或聊天中粘贴密钥。"
      );
    }

    return {
      ok: true,
      status: "ready",
      message: "微信公众号官方发布配置存在。",
      nextAction: "可以调用 freepublish submit 并轮询官方发布状态。"
    };
  }
}

class JuejinDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "juejin" as const;

  async checkAuth(): Promise<AuthStatus> {
    if (getMode() === "mock") {
      return {
        ok: true,
        status: "ready",
        message: "掘金 mock 登录态预检查通过。",
        nextAction: "可以执行本地状态机验收；真实发布前需要持久浏览器登录态或 same-origin bridge。"
      };
    }

    const missingConfig = missing(["JUEJIN_COOKIE", "JUEJIN_TAG_IDS", "JUEJIN_CATEGORY_ID"]);

    if (missingConfig.length) {
      return createPendingConfigAuth(this.platform, missingConfig, "请在本机环境变量补齐掘金登录态、标签 ID 和分类 ID。");
    }

    return {
      ok: true,
      status: "ready",
      message: "掘金直接发布配置存在。",
      nextAction: "发布后需通过文章列表或公开页验证正式发布状态。"
    };
  }

  async validatePayload(payload: PlatformPublishPayload): Promise<ValidationResult> {
    const base = await super.validatePayload(payload);

    if (!base.ok) return base;

    if (getMode() !== "mock" && (!payload.categoryId || !payload.tagIds?.length)) {
      return {
        ok: false,
        message: "掘金正式发布缺少分类或标签。",
        nextAction: "请补齐 categoryId 和 tagIds，或使用环境默认分类与标签。",
        failureCode: "payload_invalid"
      };
    }

    return base;
  }
}

class CsdnDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "csdn" as const;

  async checkAuth(): Promise<AuthStatus> {
    if (getMode() === "mock") {
      return {
        ok: true,
        status: "ready",
        message: "CSDN mock 登录态预检查通过。",
        nextAction: "可以执行本地状态机验收；真实发布前需要持久浏览器登录态或 same-origin bridge。"
      };
    }

    const missingConfig = missing(["CSDN_COOKIE", "CSDN_CATEGORIES", "CSDN_TAGS"]);

    if (missingConfig.length) {
      return createPendingConfigAuth(this.platform, missingConfig, "请在本机环境变量补齐 CSDN 登录态、分类和标签配置。");
    }

    return {
      ok: true,
      status: "ready",
      message: "CSDN 直接发布配置存在。",
      nextAction: "发布后需通过文章管理列表或公开页验证正式发布状态。"
    };
  }
}

class ZhihuDirectPublishAdapter extends BaseDirectPublishAdapter {
  platform = "zhihu" as const;

  async checkAuth(): Promise<AuthStatus> {
    if (process.env.ZHIHU_MANUAL_TAKEOVER_REQUIRED === "true") {
      return {
        ok: false,
        status: "manual_takeover_required",
        message: "知乎当前需要人工接管。",
        nextAction: "请人工处理验证码、手机确认或平台安全挑战；系统不会尝试绕过风控。"
      };
    }

    if (getMode() === "mock") {
      return {
        ok: true,
        status: "ready",
        message: "知乎 mock 登录态预检查通过。",
        nextAction: "可以执行本地状态机验收；真实发布前需要持久浏览器登录态。"
      };
    }

    const missingConfig = missing(["ZHIHU_COOKIE", "ZHIHU_XSRF_TOKEN"]);

    if (missingConfig.length) {
      return createPendingConfigAuth(this.platform, missingConfig, "请在本机环境变量补齐知乎登录态；若遇到安全挑战，改为人工接管。");
    }

    return {
      ok: true,
      status: "ready",
      message: "知乎直接发布配置存在。",
      nextAction: "发布后需通过创作者中心或公开页验证正式发布状态。"
    };
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
