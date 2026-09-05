import type { HostedHistoryStep } from "@/lib/v5/hosted-history-contracts";
export const historyStepLabels: Record<HostedHistoryStep, string> = {
  research: "资料处理与 GEO 调研", strategy: "确认 GEO 策略", "sample-generation": "生成代表样文", "sample-review": "确认代表样文", publishing: "托管发布与 URL 回传"
};
export const historyChannelLabels: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };
export const historyStatusLabels: Record<string, string> = { published: "已公开", platform_review: "平台审核中", failed: "未完成", deferred: "已顺延" };
export function historyTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
