export const hostedOrderStatuses = [
  "preparing",
  "pending_strategy_review",
  "generating_sample",
  "pending_sample_review",
  "running",
  "action_required",
  "paused",
  "completed"
] as const;

export type HostedOrderStatus = typeof hostedOrderStatuses[number];

export interface HostedSampleProgress {
  strategyPackId?: string;
  taskId?: string;
  operationId?: string;
  operationStatus?: string;
  progressStage?: string;
  attemptCount: number;
  reviewStatus?: string;
  hasReviewableDraft: boolean;
  error?: { code: string; message: string; nextAction?: string };
}

export interface HostedWorkflowState {
  status: HostedOrderStatus;
  currentActionType?: string;
  lastError?: { code: string; message: string };
}

export function deriveHostedWorkflowState(input: {
  strategyStatus?: string;
  sample?: HostedSampleProgress;
}): HostedWorkflowState {
  const sample = input.sample;
  if (sample?.reviewStatus === "approved") return { status: "running" };
  if (sample?.hasReviewableDraft) {
    return { status: "pending_sample_review", currentActionType: "review_sample" };
  }
  if (sample?.operationStatus === "queued" || sample?.operationStatus === "running") {
    return { status: "generating_sample", currentActionType: "generate_sample" };
  }
  if (["failed", "blocked", "pending_config"].includes(sample?.operationStatus || "") || sample?.error) {
    return {
      status: "action_required",
      currentActionType: "retry_sample",
      lastError: {
        code: "hosted_sample_generation_failed",
        message: sample?.error?.message || "代表样文生成失败，可以从当前进度重新生成。"
      }
    };
  }
  if (input.strategyStatus === "pending_strategy_review") {
    return { status: "pending_strategy_review", currentActionType: "review_strategy" };
  }
  if (input.strategyStatus === "rejected") return { status: "preparing" };
  if (input.strategyStatus === "strategy_approved" || input.strategyStatus === "pending_sample_review") {
    return { status: "generating_sample", currentActionType: "generate_sample" };
  }
  if (input.strategyStatus === "production_ready" || input.strategyStatus === "active") return { status: "running" };
  return { status: "preparing" };
}

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
  workspaceId: string;
  userId: string;
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
  currentStrategyPackId?: string;
  currentSampleTaskId?: string;
  currentSampleOperationId?: string;
  currentActionType?: string;
  pauseReason?: string;
  lastError?: { code: string; message: string };
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHostedPromotionOrderInput {
  workspaceId: string;
  userId: string;
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
  if (order.status === "generating_sample") {
    return { type: "wait", label: "正在生成代表样文", description: "系统正在生成并检查样文，完成后页面会自动更新。" };
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
      label: order.status === "completed" ? "查看本轮结果" : "查看最近发布结果",
      description: order.status === "completed" ? "本轮托管任务已经完成。" : "系统正在按本轮计划自动发布。"
    };
  }
  return { type: "wait", label: "等待系统完成调研", description: "完成后会通过邮件发送确认链接。" };
}
