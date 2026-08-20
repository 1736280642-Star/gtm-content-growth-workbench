import type { DirectPublishPlatformKey } from "../types";
import { openFormalPublishAuthorization } from "../formal-publish-client";
import { getActiveGeoChannelRulePack } from "./geo-channel-rule-pack";
import { readHostedPromotionOrderRecord } from "./hosted-managed-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";

const supportedAuthorizationChannels = new Set<DirectPublishPlatformKey>(["zhihu", "csdn", "juejin"]);

export async function openHostedChannelAuthorization(input: { orderId: string; channel: string }) {
  const channel = input.channel as DirectPublishPlatformKey;
  if (!supportedAuthorizationChannels.has(channel)) {
    throw new V5GovernanceServiceError(
      "hosted_channel_authorization_unsupported",
      "该渠道不使用专用浏览器授权。",
      409,
      "返回托管设置选择知乎、CSDN 或掘金。"
    );
  }
  const order = await readHostedPromotionOrderRecord(input.orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);

  let pack;
  try {
    pack = getActiveGeoChannelRulePack();
  } catch (error) {
    throw new V5GovernanceServiceError(
      "hosted_channel_rule_pack_invalid",
      error instanceof Error ? error.message : "渠道规则配置异常。",
      503,
      "由运营人员修复并重新人工激活渠道规则。"
    );
  }
  if (!pack?.channels.some((item) => item.channelKey === channel)) {
    throw new V5GovernanceServiceError(
      "hosted_channel_rule_not_active",
      "该渠道尚未完成系统开通，暂时不能连接账号。",
      409,
      "无需提供账号凭据；等待运营人员激活渠道规则后再连接。"
    );
  }

  return {
    orderId: order.orderId,
    productId: order.productId,
    channel,
    ...(await openFormalPublishAuthorization(channel))
  };
}
