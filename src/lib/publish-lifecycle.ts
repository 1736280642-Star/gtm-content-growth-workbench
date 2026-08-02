import type { VerifyResult } from "./publish-adapters/types";
import type { PublishAttemptStatus, PublishSchedule } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function getPositiveNumberEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getStablePublishWindowMs(): number {
  return getPositiveNumberEnvironment("DIRECT_PUBLISH_STABLE_AFTER_HOURS", 72) * HOUR_MS;
}

function getVerificationTimeoutMs(): number {
  return getPositiveNumberEnvironment("DIRECT_PUBLISH_VERIFICATION_TIMEOUT_HOURS", 168) * HOUR_MS;
}

function getNextPublishVerificationAt(
  verifiedAt: string,
  firstPublicObservedAt?: string,
  verificationStartedAt?: string
): string {
  const verifiedTime = new Date(verifiedAt).getTime();
  const observedTime = firstPublicObservedAt ? new Date(firstPublicObservedAt).getTime() : Number.NaN;
  const observedAge = Number.isFinite(observedTime) ? Math.max(0, verifiedTime - observedTime) : -1;
  const verificationStartTime = verificationStartedAt ? new Date(verificationStartedAt).getTime() : verifiedTime;
  const pendingAge = Math.max(0, verifiedTime - verificationStartTime);
  const interval = observedAge >= 0
    ? observedAge < 10 * MINUTE_MS
        ? 10 * MINUTE_MS
        : observedAge < HOUR_MS
          ? HOUR_MS
          : observedAge < 6 * HOUR_MS
            ? 6 * HOUR_MS
            : 24 * HOUR_MS
    : pendingAge < 10 * MINUTE_MS
      ? MINUTE_MS
      : pendingAge < HOUR_MS
        ? 10 * MINUTE_MS
        : pendingAge < 6 * HOUR_MS
          ? HOUR_MS
          : pendingAge < 24 * HOUR_MS
            ? 6 * HOUR_MS
            : 24 * HOUR_MS;
  const boundedInterval =
    observedAge >= 0
      ? Math.max(MINUTE_MS, Math.min(interval, Math.max(0, getStablePublishWindowMs() - observedAge)))
      : interval;
  return new Date(verifiedTime + boundedInterval).toISOString();
}

export function isPublishVerificationDue(schedule: PublishSchedule, now: Date): boolean {
  if (!schedule.nextVerificationAt) return true;
  const nextTime = new Date(schedule.nextVerificationAt).getTime();
  return Number.isNaN(nextTime) || nextTime <= now.getTime();
}

export type PublishVerificationLifecycle = Omit<
  Pick<
    PublishSchedule,
    | "status"
    | "urlStatus"
    | "firstPublicObservedAt"
    | "lastVerifiedAt"
    | "nextVerificationAt"
    | "verificationStartedAt"
    | "stablePublishedAt"
    | "removedAt"
    | "verificationCount"
    | "consecutiveVerificationFailures"
    | "failureCode"
    | "failureReason"
  >,
  "status"
> & { status: PublishAttemptStatus };

export function resolvePublishVerificationLifecycle(
  schedule: PublishSchedule,
  verifyResult: VerifyResult,
  verifiedAt: string
): PublishVerificationLifecycle {
  const verificationCount = (schedule.verificationCount || 0) + 1;
  const verificationStartedAt = schedule.verificationStartedAt || verifiedAt;
  const explicitRejected = verifyResult.status === "platform_rejected" || verifyResult.failureCode === "platform_rejected";
  const explicitRemoved = verifyResult.status === "removed_after_publish" || verifyResult.failureCode === "removed_after_publish";
  const publicUrl = verifyResult.publicUrl || schedule.publicUrl;
  const publicConfirmed =
    Boolean(publicUrl) &&
    verifyResult.ok &&
    ["published_verified", "public_observed", "stable_published"].includes(verifyResult.status);

  if (explicitRejected) {
    return {
      status: "platform_rejected",
      urlStatus: "rejected",
      firstPublicObservedAt: schedule.firstPublicObservedAt,
      lastVerifiedAt: verifiedAt,
      nextVerificationAt: undefined,
      verificationStartedAt,
      stablePublishedAt: schedule.stablePublishedAt,
      removedAt: schedule.removedAt,
      verificationCount,
      consecutiveVerificationFailures: (schedule.consecutiveVerificationFailures || 0) + 1,
      failureCode: "platform_rejected",
      failureReason: verifyResult.failureReason
    };
  }

  if (publicConfirmed) {
    const firstPublicObservedAt = schedule.firstPublicObservedAt || verifiedAt;
    const observedAge = new Date(verifiedAt).getTime() - new Date(firstPublicObservedAt).getTime();
    const hasPriorPublicObservation = Boolean(schedule.firstPublicObservedAt) && (schedule.verificationCount || 0) > 0;
    const stable = hasPriorPublicObservation && observedAge >= getStablePublishWindowMs();
    return {
      status: stable ? "stable_published" : "public_observed",
      urlStatus: stable ? "stable" : "provisional",
      firstPublicObservedAt,
      lastVerifiedAt: verifiedAt,
      nextVerificationAt: stable ? undefined : getNextPublishVerificationAt(verifiedAt, firstPublicObservedAt),
      verificationStartedAt,
      stablePublishedAt: stable ? verifiedAt : schedule.stablePublishedAt,
      removedAt: undefined,
      verificationCount,
      consecutiveVerificationFailures: 0,
      failureCode: undefined,
      failureReason: undefined
    };
  }

  const consecutiveVerificationFailures = (schedule.consecutiveVerificationFailures || 0) + 1;
  const wasPublic = Boolean(schedule.firstPublicObservedAt || schedule.urlStatus === "provisional" || schedule.urlStatus === "stable");
  const shouldMarkRemoved =
    wasPublic &&
    consecutiveVerificationFailures >= 2 &&
    (explicitRemoved || verifyResult.status === "published_pending_url");

  if (shouldMarkRemoved) {
    return {
      status: "removed_after_publish",
      urlStatus: "removed",
      firstPublicObservedAt: schedule.firstPublicObservedAt,
      lastVerifiedAt: verifiedAt,
      nextVerificationAt: undefined,
      verificationStartedAt,
      stablePublishedAt: schedule.stablePublishedAt,
      removedAt: verifiedAt,
      verificationCount,
      consecutiveVerificationFailures,
      failureCode: "removed_after_publish",
      failureReason: verifyResult.failureReason || "公开文章连续验证失败，已判定为发布后不可访问。"
    };
  }

  const verificationTimedOut =
    !wasPublic &&
    new Date(verifiedAt).getTime() - new Date(verificationStartedAt).getTime() >= getVerificationTimeoutMs();
  const continuingStatus: PublishAttemptStatus =
    verifyResult.status === "published_pending_url"
      ? "published_pending_url"
      : ["manual_takeover_required", "risk_blocked", "auth_expired", "pending_config"].includes(verifyResult.status)
        ? verifyResult.status === "manual_takeover_required"
          ? "risk_blocked"
          : verifyResult.status
        : "pending_verify";
  const nextVerificationAt =
    continuingStatus === "risk_blocked"
      ? new Date(new Date(verifiedAt).getTime() + 6 * HOUR_MS).toISOString()
      : getNextPublishVerificationAt(verifiedAt, schedule.firstPublicObservedAt, verificationStartedAt);

  return {
    status: verificationTimedOut ? "verification_timeout" : continuingStatus,
    urlStatus: wasPublic ? schedule.urlStatus || "provisional" : "pending",
    firstPublicObservedAt: schedule.firstPublicObservedAt,
    lastVerifiedAt: verifiedAt,
    nextVerificationAt: verificationTimedOut ? undefined : nextVerificationAt,
    verificationStartedAt,
    stablePublishedAt: schedule.stablePublishedAt,
    removedAt: schedule.removedAt,
    verificationCount,
    consecutiveVerificationFailures,
    failureCode: verificationTimedOut ? "verification_timeout" : verifyResult.failureCode,
    failureReason: verificationTimedOut ? "平台在验证窗口内始终未形成可访问公开 URL。" : verifyResult.failureReason
  };
}
