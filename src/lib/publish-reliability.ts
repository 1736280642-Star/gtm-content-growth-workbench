import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule } from "@/lib/types";

export interface PublishReliabilityMetrics {
  platform: DirectPublishPlatformKey;
  total: number;
  submitted: number;
  publicObserved: number;
  stablePublished: number;
  removedAfterPublish: number;
  platformRejected: number;
  riskBlocked: number;
  duplicateProtectedAttempts: number;
  duplicatePublishCount: number;
  submissionAcceptanceRate: number | null;
  publicConversionRate: number | null;
  survival24hRate: number | null;
  survival72hRate: number | null;
  riskBlockRate: number | null;
  duplicatePublishRate: number | null;
  averageUrlBackfillLatencyMinutes: number | null;
}

const SUBMITTED_STATUSES = new Set([
  "published_pending_url",
  "published_verified",
  "public_observed",
  "stable_published",
  "removed_after_publish"
]);

const ACCEPTED_PUBLISH_STATUSES = new Set(["submitted", "confirmed", "pending_review"]);

function rate(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function elapsedHours(from?: string, to?: string): number {
  if (!from || !to) return 0;
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

export function buildPublishReliabilityMetrics(
  schedules: PublishSchedule[],
  attempts: PublishAttempt[]
): PublishReliabilityMetrics[] {
  const platforms: DirectPublishPlatformKey[] = ["wechat", "juejin", "csdn", "zhihu"];
  return platforms.map((platform) => {
    const platformSchedules = schedules.filter((schedule) => schedule.platform === platform);
    const platformAttempts = attempts.filter((attempt) => attempt.platform === platform);
    const acceptedAttemptScheduleIds = new Set(
      platformAttempts
        .filter((attempt) => attempt.publishStatus && ACCEPTED_PUBLISH_STATUSES.has(attempt.publishStatus))
        .map((attempt) => attempt.scheduleId)
    );
    const firstSubmissionActionAt = new Map<string, string>();
    for (const attempt of platformAttempts
      .filter(
        (attempt) =>
          attempt.mode === "real" &&
          (Boolean(attempt.publishStatus && ACCEPTED_PUBLISH_STATUSES.has(attempt.publishStatus)) ||
            attempt.failureCode === "publish_action_unconfirmed")
      )
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
      if (!firstSubmissionActionAt.has(attempt.scheduleId)) {
        firstSubmissionActionAt.set(attempt.scheduleId, attempt.startedAt);
      }
    }
    const submittedSchedules = platformSchedules.filter(
      (schedule) => SUBMITTED_STATUSES.has(schedule.status) || acceptedAttemptScheduleIds.has(schedule.id)
    );
    const acceptedInitialAttemptsBySchedule = new Map<string, number>();
    for (const attempt of platformAttempts.filter(
      (item) =>
        item.mode === "real" &&
        item.verificationKind !== "liveness" &&
        item.diagnosticSummary !== "verify_only_no_publish_action" &&
        Boolean(item.publishStatus && ACCEPTED_PUBLISH_STATUSES.has(item.publishStatus))
    )) {
      acceptedInitialAttemptsBySchedule.set(
        attempt.scheduleId,
        (acceptedInitialAttemptsBySchedule.get(attempt.scheduleId) || 0) + 1
      );
    }
    const duplicatePublishCount = [...acceptedInitialAttemptsBySchedule.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0
    );
    const observed = platformSchedules.filter((schedule) => Boolean(schedule.firstPublicObservedAt));
    const observed24h = observed.filter(
      (schedule) =>
        elapsedHours(schedule.firstPublicObservedAt, schedule.lastVerifiedAt) >= 24 &&
        (!schedule.removedAt || elapsedHours(schedule.firstPublicObservedAt, schedule.removedAt) >= 24)
    );
    const eligible24h = observed.filter(
      (schedule) => Boolean(schedule.removedAt) || elapsedHours(schedule.firstPublicObservedAt, schedule.lastVerifiedAt) >= 24
    );
    const observed72h = observed.filter(
      (schedule) =>
        elapsedHours(schedule.firstPublicObservedAt, schedule.lastVerifiedAt) >= 72 &&
        (!schedule.removedAt || elapsedHours(schedule.firstPublicObservedAt, schedule.removedAt) >= 72)
    );
    const eligible72h = observed.filter(
      (schedule) => Boolean(schedule.removedAt) || elapsedHours(schedule.firstPublicObservedAt, schedule.lastVerifiedAt) >= 72
    );
    const latencies = observed
      .map(
        (schedule) =>
          elapsedHours(firstSubmissionActionAt.get(schedule.id) || schedule.publishedAt, schedule.firstPublicObservedAt) * 60
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    return {
      platform,
      total: platformSchedules.length,
      submitted: submittedSchedules.length,
      publicObserved: observed.length,
      stablePublished: platformSchedules.filter((schedule) => schedule.status === "stable_published").length,
      removedAfterPublish: platformSchedules.filter((schedule) => schedule.status === "removed_after_publish").length,
      platformRejected: platformSchedules.filter((schedule) => schedule.status === "platform_rejected").length,
      riskBlocked: platformSchedules.filter((schedule) => schedule.status === "risk_blocked").length,
      duplicateProtectedAttempts: platformAttempts.filter((attempt) => attempt.failureCode === "duplicate_protected").length,
      duplicatePublishCount,
      submissionAcceptanceRate: rate(submittedSchedules.length, platformSchedules.length),
      publicConversionRate: rate(observed.length, submittedSchedules.length),
      survival24hRate: rate(observed24h.length, eligible24h.length),
      survival72hRate: rate(observed72h.length, eligible72h.length),
      riskBlockRate: rate(
        platformSchedules.filter((schedule) => schedule.status === "risk_blocked").length,
        platformSchedules.length
      ),
      duplicatePublishRate: rate(duplicatePublishCount, submittedSchedules.length),
      averageUrlBackfillLatencyMinutes: latencies.length
        ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2))
        : null
    };
  });
}
