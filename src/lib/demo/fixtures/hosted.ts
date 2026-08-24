import type { HostedPromotionOrderRecord } from "../../v5/hosted-managed-contracts";
import type { HostedReviewRequestRecord } from "../../v5/hosted-review-repository";
import { DEMO_MONTH } from "../config";

export const DEMO_HOSTED_ORDER_ID = "hosted-order-demo-1";

export function demoHostedOrder(orderId?: string): HostedPromotionOrderRecord {
  return {
    orderId: orderId || DEMO_HOSTED_ORDER_ID,
    workspaceId: "demo-workspace-1",
    userId: "demo-user-1",
    productId: "workbuddy",
    productName: "JOTO WorkBuddy",
    contactEmail: "demo@joto.ai",
    contactEmailVerified: true,
    status: "running",
    channels: [
      { channel: "wechat", dailyCap: 2 },
      { channel: "csdn", dailyCap: 2 },
      { channel: "juejin", dailyCap: 1 },
      { channel: "zhihu", dailyCap: 1 }
    ],
    dailyCaps: { wechat: 2, csdn: 2, juejin: 1, zhihu: 1 },
    notificationPreferences: { dailyDigest: true, actionRequired: true, monthlyCompleted: true },
    materialSummary: { officialUrl: "https://jotoai.com", fileNames: [], acceptedSourceCount: 3, failedSources: [], importStatus: "queued" },
    timezone: "Asia/Shanghai",
    currentMonthlyPlanId: `mp-${DEMO_MONTH}`,
    rowVersion: 1,
    createdAt: `${DEMO_MONTH}-01T08:00:00.000Z`,
    updatedAt: `${DEMO_MONTH}-21T08:00:00.000Z`
  };
}

const demoConnectionAccount: Record<string, string> = {
  zhihu: "JOTO 知乎号",
  csdn: "JOTO 技术博客",
  juejin: "JOTO 掘金号"
};

export function demoOrderChannelConnections(): Array<{
  channel: string;
  session: undefined;
  connection: { accountConnectionId: string; publicDisplayName: string; publicAvatarUrl?: string; authorizationStatus: string; executorType: string };
}> {
  return (["zhihu", "csdn", "juejin"] as const).map((channel) => ({
    channel,
    session: undefined,
    connection: {
      accountConnectionId: `demo-conn-${channel}`,
      publicDisplayName: demoConnectionAccount[channel] || `JOTO ${channel} 账号`,
      authorizationStatus: "confirmed",
      executorType: "cloud_browser"
    }
  }));
}

export function demoReviewRequest(): HostedReviewRequestRecord {
  return {
    reviewRequestId: "demo-review-1",
    orderId: DEMO_HOSTED_ORDER_ID,
    productId: "workbuddy",
    productName: "JOTO WorkBuddy",
    contactEmail: "demo@joto.ai",
    gateType: "strategy",
    targetId: "sp-workbuddy-adp-001",
    status: "pending",
    expiresAt: `${DEMO_MONTH}-28T08:00:00.000Z`,
    rowVersion: 1,
    createdAt: `${DEMO_MONTH}-02T09:00:00.000Z`
  };
}
