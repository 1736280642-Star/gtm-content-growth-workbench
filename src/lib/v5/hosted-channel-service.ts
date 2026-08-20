import type { DirectPublishPlatformKey } from "../types";
import { getActiveGeoChannelRulePack, GEO_OWNED_CHANNEL_KEYS } from "./geo-channel-rule-pack";
import { deriveHostedChannelAuthorizationPhase, type HostedChannelOption } from "./hosted-managed-contracts";
import { getProductRolloutReadiness } from "./product-rollout-readiness-service";

export const hostedDirectPublishChannels = ["wechat", "zhihu", "csdn", "juejin"] as const satisfies readonly DirectPublishPlatformKey[];

export async function listHostedChannelOptions(productId?: string): Promise<HostedChannelOption[]> {
  let packError: unknown;
  let pack: ReturnType<typeof getActiveGeoChannelRulePack>;
  try {
    pack = getActiveGeoChannelRulePack();
  } catch (error) {
    packError = error;
  }
  const covered = new Set(pack?.channels.map((item) => item.channelKey) || []);
  const readinessEntries = productId
    ? await Promise.all(hostedDirectPublishChannels.map(async (channel) => [channel, await getProductRolloutReadiness(productId, channel)] as const))
    : [];
  const readinessByChannel = new Map(readinessEntries);

  return hostedDirectPublishChannels.map((channel) => {
    const owned = GEO_OWNED_CHANNEL_KEYS.has(channel);
    const ruleReady = owned || (!packError && covered.has(channel));
    if (!ruleReady) {
      return {
        channel,
        capability: "unsupported",
        authorizationStatus: "unavailable",
        authorizationPhase: "system_setup",
        detail: packError ? "渠道规则配置异常" : "尚未激活托管规则",
        nextAction: "由运营人员确认并激活该渠道的收录与发布规则。"
      };
    }
    const readiness = readinessByChannel.get(channel);
    const accountGate = readiness?.gates.find((gate) => gate.key === "account");
    const authGate = readiness?.gates.find((gate) => gate.key === "auth");
    const runtimeConfigured = !readiness || !["pending_config", "failed"].includes(readiness.authorizationRuntimeStatus || "pending_config");
    if (!runtimeConfigured) {
      return {
        channel,
        capability: "unsupported",
        authorizationStatus: "unavailable",
        authorizationPhase: "system_setup",
        detail: "渠道授权服务尚未完成系统配置",
        nextAction: "由运营人员启动本机发布 Bridge、专用浏览器 Runner 并完成连通性检查。"
      };
    }
    const connected = Boolean(readiness && accountGate?.status === "passed" && authGate?.status === "passed");
    const authPassed = authGate?.status === "passed";
    const candidateLabel = readiness?.configuredAccountCandidateLabel || readiness?.configuredAccountCandidate;
    const detail = connected
      ? `已连接 ${readiness?.confirmedAccount || candidateLabel || "发布账号"}`
      : !authPassed
        ? authGate?.detail || (channel === "wechat" ? "选择后需要连接公众号发布账号" : "需要在专用浏览器中完成登录")
        : readiness?.configuredAccountCandidate
        ? `已识别 ${candidateLabel || "唯一账号"}，等待你确认`
        : accountGate?.detail || "选择后需要确认发布账号";
    const authorizationPhase = deriveHostedChannelAuthorizationPhase({
      ruleReady: true,
      accountPassed: accountGate?.status === "passed",
      authPassed,
      authDetail: authGate?.detail,
      authNextAction: authGate?.nextAction
    });
    return {
      channel,
      capability: "auto_publish",
      authorizationStatus: connected ? "connected" : "required",
      authorizationPhase,
      accountLabel: connected ? readiness?.confirmedAccount : undefined,
      accountCandidate: readiness?.configuredAccountCandidate,
      accountCandidateLabel: readiness?.configuredAccountCandidateLabel,
      accountBindingVersion: readiness?.accountBindingVersion || 0,
      detail,
      nextAction: connected
        ? undefined
        : !authPassed
          ? authGate?.nextAction || (channel === "wechat" ? "连接并确认公众号发布账号。" : "打开专用登录窗口完成登录。")
          : accountGate?.nextAction || "确认该产品使用这个发布账号。"
    };
  });
}
