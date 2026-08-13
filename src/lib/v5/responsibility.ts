// 统一责任模型 · V5 Phase 0
// 全站只认一套分类，消除各页面各自定义"需处理"口径的问题。

// ── 责任状态 ──
export type Responsibility = "system" | "external" | "user";

// ── 恢复状态 ──
export type RecoveryStatus = "waiting" | "retrying" | "repaired" | "exhausted";

// ── 责任标签 ──
export interface ResponsibilityLabel {
  responsibility: Responsibility;
  recoveryStatus: RecoveryStatus;
  /** 用户是否需要操作 */
  userActionRequired: boolean;
  /** 系统下一步自动动作 */
  nextAutomaticAction?: string;
  /** 预计下次重试时间（ISO 8601） */
  nextAttemptAt?: string;
  /** 已尝试次数 */
  attemptCount: number;
  /** 影响范围（受影响任务数） */
  impactCount: number;
}

// ── 告警四要素 ──
export interface AttentionAlert {
  id: string;
  /** 发生了什么 */
  whatHappened: string;
  /** 影响什么 */
  impact: string;
  /** 系统下一步做什么 */
  nextAction: string;
  /** 预计何时再次检查 */
  nextCheckAt: string;
  /** 关联任务/产品 ID */
  refId?: string;
  /** 导航链接 */
  href?: string;
  /** 明确操作指引 */
  userAction?: string;
  /** 尝试次数 */
  attemptCount: number;
  /** 影响范围 */
  impactCount: number;
}

// ── 发布状态责任判定 ──
// 将 PublishScheduleStatus 映射到四类责任状态

/** 系统自动恢复中（不告警、不通知用户） */
export const AUTO_RECOVERING_PUBLISH_STATUSES = new Set([
  "scheduled",
  "publishing",
  "published_verified",
  "published_pending_url",
  "pending_verify",
  "public_observed",
  "stable_published",
]);

/** 系统可自动重试/顺延，不计入"需你处理" */
export const SYSTEM_RECOVERING_PUBLISH_STATUSES = new Set([
  "precheck_failed",
  "verification_timeout",
  "pending_config",
]);

/** 等待外部结果（平台审核、URL 回传等） */
export const EXTERNAL_WAITING_PUBLISH_STATUSES = new Set([
  "published_verified",
  "published_pending_url",
  "pending_verify",
]);

/** 系统确认无法自行恢复，需用户介入 */
export const USER_ACTION_PUBLISH_STATUSES = new Set([
  "auth_expired",
  "platform_rejected",
  "removed_after_publish",
  "risk_blocked",
  "failed",
  "manual_takeover_required",
]);

// ── 生产任务状态责任判定 ──

/** 系统自动恢复中（不计入"需你处理"） */
export const AUTO_RECOVERING_PRODUCTION_STATUSES = new Set([
  "ready_for_generation",
  "generating",
  "available",
  "scheduled",
  "published",
]);

/** 系统可自动重试/修复 */
export const SYSTEM_RECOVERING_PRODUCTION_STATUSES = new Set([
  "system_recovering",
  "awaiting_material",
]);

// ── 责任判定器 ──

/**
 * 判定发布任务的责任状态
 */
export function classifyPublishResponsibility(
  status: string,
  _attemptCount = 0,
): ResponsibilityLabel {
  if (AUTO_RECOVERING_PUBLISH_STATUSES.has(status as never)) {
    return {
      responsibility: "system",
      recoveryStatus: "repaired",
      userActionRequired: false,
      attemptCount: 0,
      impactCount: 0,
    };
  }
  if (SYSTEM_RECOVERING_PUBLISH_STATUSES.has(status as never)) {
    return {
      responsibility: "system",
      recoveryStatus: "retrying",
      nextAutomaticAction: "系统将自动重试",
      userActionRequired: false,
      attemptCount: _attemptCount,
      impactCount: 0,
    };
  }
  if (status === "failed" && _attemptCount < 3) {
    return {
      responsibility: "system",
      recoveryStatus: "retrying",
      nextAutomaticAction: "系统将按退避策略自动重试",
      userActionRequired: false,
      attemptCount: _attemptCount,
      impactCount: 0,
    };
  }
  if (USER_ACTION_PUBLISH_STATUSES.has(status as never)) {
    return {
      responsibility: "user",
      recoveryStatus: "exhausted",
      userActionRequired: true,
      attemptCount: _attemptCount,
      impactCount: 1,
    };
  }
  return {
    responsibility: "external",
    recoveryStatus: "waiting",
    userActionRequired: false,
    attemptCount: 0,
    impactCount: 0,
  };
}

/**
 * 判定生产任务的责任状态
 */
export function classifyProductionResponsibility(
  status: string,
  _attemptCount = 0,
): ResponsibilityLabel {
  if (AUTO_RECOVERING_PRODUCTION_STATUSES.has(status as never)) {
    return {
      responsibility: "system",
      recoveryStatus: "repaired",
      userActionRequired: false,
      attemptCount: 0,
      impactCount: 0,
    };
  }
  if (status === "system_recovering") {
    return {
      responsibility: "system",
      recoveryStatus: "retrying",
      nextAutomaticAction: "系统正在自动修复，完成后将恢复生产",
      userActionRequired: false,
      attemptCount: _attemptCount,
      impactCount: 0,
    };
  }
  if (status === "awaiting_material") {
    return {
      responsibility: "external",
      recoveryStatus: "waiting",
      nextAutomaticAction: "等待资料补充完成后自动继续",
      userActionRequired: false,
      attemptCount: 0,
      impactCount: 0,
    };
  }
  return {
    responsibility: "system",
    recoveryStatus: "waiting",
    userActionRequired: false,
    attemptCount: 0,
    impactCount: 0,
  };
}

// ── 责任标签文本映射 ──

export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = {
  system: "系统运行中",
  external: "等待外部结果",
  user: "需你处理",
};

export const RESPONSIBILITY_COLORS: Record<Responsibility, "blue" | "default" | "red" | "gold"> = {
  system: "blue",
  external: "default",
  user: "red",
};

export const RECOVERY_LABEL_MAP: Record<RecoveryStatus, string> = {
  waiting: "等待中",
  retrying: "自动处理中",
  repaired: "已恢复",
  exhausted: "已达上限",
};
