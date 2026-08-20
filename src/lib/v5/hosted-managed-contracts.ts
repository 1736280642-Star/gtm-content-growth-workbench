export const hostedOrderStatuses = [
  "preparing",
  "pending_strategy_review",
  "pending_sample_review",
  "running",
  "action_required",
  "paused",
  "completed"
] as const;

export type HostedOrderStatus = typeof hostedOrderStatuses[number];

export type HostedChannelCapability = "auto_publish" | "draft_only" | "unsupported";
export type HostedChannelAuthorizationStatus = "connected" | "required" | "not_applicable" | "unavailable";
export type HostedChannelAuthorizationPhase =
  | "system_setup"
  | "needs_login"
  | "manual_takeover_required"
  | "needs_account_confirmation"
  | "connected";

export function deriveHostedChannelAuthorizationPhase(input: {
  ruleReady: boolean;
  accountPassed: boolean;
  authPassed: boolean;
  authDetail?: string;
  authNextAction?: string;
}): HostedChannelAuthorizationPhase {
  if (!input.ruleReady) return "system_setup";
  if (input.accountPassed && input.authPassed) return "connected";
  if (!input.authPassed) {
    return /验证码|安全挑战|手机确认|manual_takeover/i.test(`${input.authDetail || ""} ${input.authNextAction || ""}`)
      ? "manual_takeover_required"
      : "needs_login";
  }
  return "needs_account_confirmation";
}

export interface HostedChannelPreference {
  channel: string;
  dailyCap?: number;
}

export interface HostedChannelOption extends HostedChannelPreference {
  capability: HostedChannelCapability;
  authorizationStatus: HostedChannelAuthorizationStatus;
  authorizationPhase: HostedChannelAuthorizationPhase;
  accountLabel?: string;
  accountCandidate?: string;
  accountCandidateLabel?: string;
  accountBindingVersion?: number;
  detail: string;
  nextAction?: string;
}

export interface HostedMaterialSummary {
  officialUrl?: string;
  fileNames: string[];
  acceptedSourceCount: number;
  failedSources: Array<{ name: string; reason: string }>;
  importStatus: "not_required" | "queued" | "pending_config" | "needs_attention";
}

export interface HostedPromotionOrderRecord {
  orderId: string;
  productId: string;
  productName: string;
  contactEmail: string;
  contactEmailVerified: boolean;
  status: HostedOrderStatus;
  channels: HostedChannelPreference[];
  dailyCaps: Record<string, number>;
  notificationPreferences: { dailyDigest: boolean; actionRequired: true; monthlyCompleted: boolean };
  materialSummary: HostedMaterialSummary;
  timezone: string;
  currentMonthlyPlanId?: string;
  currentActionType?: string;
  pauseReason?: string;
  lastError?: { code: string; message: string };
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHostedPromotionOrderInput {
  productId: string;
  contactEmail: string;
  channels: HostedChannelPreference[];
  materialSummary: HostedMaterialSummary;
  timezone: string;
  status?: HostedOrderStatus;
  idempotencyKey: string;
  actorId: string;
}

export interface HostedOrderNextAction {
  type: "wait" | "review_strategy" | "review_sample" | "resolve_issue" | "view_results" | "resume";
  label: string;
  description: string;
  href?: string;
}

export function compileHostedOrderNextAction(order: HostedPromotionOrderRecord): HostedOrderNextAction {
  if (order.status === "pending_strategy_review") {
    return { type: "review_strategy", label: "确认 GEO 推广策略", description: "策略已准备好，需要你做一次判断。" };
  }
  if (order.status === "pending_sample_review") {
    return { type: "review_sample", label: "确认代表样文", description: "样文已生成，通过后系统开始批量托管。" };
  }
  if (order.status === "action_required") {
    return {
      type: "resolve_issue",
      label: "处理当前问题",
      description: order.lastError?.message || "有一项问题无法由系统自动判断。",
      href: order.lastError?.code.startsWith("hosted_channel_")
        ? `/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`
        : undefined
    };
  }
  if (order.status === "paused") {
    return { type: "resume", label: "恢复托管", description: order.pauseReason || "这项推广当前已暂停。" };
  }
  if (order.status === "running" || order.status === "completed") {
    return {
      type: "view_results",
      label: order.status === "completed" ? "查看本月结果" : "查看最近发布结果",
      description: order.status === "completed" ? "本月托管周期已经完成。" : "系统正在按当月计划自动发布。"
    };
  }
  return { type: "wait", label: "等待系统完成调研", description: "完成后会通过邮件发送确认链接。" };
}
