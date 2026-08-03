import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule } from "@/lib/types";

export interface PublishReliabilityMetrics {
  platform: DirectPublishPlatformKey;
  total: number;
  submitted: number;
  uniqueSubmittedDrafts: number;
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

export interface PublishReliabilityThresholds {
  minimumSubmittedSamples: number;
  minimumSubmissionAcceptanceRate: number;
  minimumPublicConversionRate: number;
  minimumSurvival24hRate: number;
  minimumSurvival72hRate: number;
  maximumRiskBlockRate: number;
  maximumDuplicatePublishCount: number;
}

export interface PublishPlatformRolloutReadiness {
  platform: DirectPublishPlatformKey;
  ready: boolean;
  blockers: string[];
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

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getPublishReliabilityThresholds(): PublishReliabilityThresholds {
  return {
    minimumSubmittedSamples: environmentNumber("PUBLISH_RELIABILITY_MIN_SUBMITTED_SAMPLES", 3),
    minimumSubmissionAcceptanceRate: environmentNumber("PUBLISH_RELIABILITY_MIN_SUBMISSION_ACCEPTANCE_RATE", 0.9),
    minimumPublicConversionRate: environmentNumber("PUBLISH_RELIABILITY_MIN_PUBLIC_CONVERSION_RATE", 0.9),
    minimumSurvival24hRate: environmentNumber("PUBLISH_RELIABILITY_MIN_SURVIVAL_24H_RATE", 0.95),
    minimumSurvival72hRate: environmentNumber("PUBLISH_RELIABILITY_MIN_SURVIVAL_72H_RATE", 0.95),
    maximumRiskBlockRate: environmentNumber("PUBLISH_RELIABILITY_MAX_RISK_BLOCK_RATE", 0.1),
    maximumDuplicatePublishCount: environmentNumber("PUBLISH_RELIABILITY_MAX_DUPLICATE_PUBLISH_COUNT", 0)
  };
}

export function evaluatePublishRolloutReadiness(
  metrics: PublishReliabilityMetrics[],
  thresholds: PublishReliabilityThresholds = getPublishReliabilityThresholds()
): PublishPlatformRolloutReadiness[] {
  const requiredPlatforms: DirectPublishPlatformKey[] = ["juejin", "csdn", "zhihu"];
  return requiredPlatforms.map((platform) => {
    const metric = metrics.find((item) => item.platform === platform);
    const blockers: string[] = [];
    if (!metric) {
      blockers.push("missing_metrics");
      return { platform, ready: false, blockers };
    }
    if (metric.submitted < thresholds.minimumSubmittedSamples) blockers.push("insufficient_submitted_samples");
    if (metric.uniqueSubmittedDrafts < thresholds.minimumSubmittedSamples) blockers.push("insufficient_unique_drafts");
    if (
      metric.submissionAcceptanceRate === null ||
      metric.submissionAcceptanceRate < thresholds.minimumSubmissionAcceptanceRate
    ) blockers.push("submission_acceptance_below_threshold");
    if (metric.publicConversionRate === null || metric.publicConversionRate < thresholds.minimumPublicConversionRate) {
      blockers.push("public_conversion_below_threshold");
    }
    if (metric.survival24hRate === null || metric.survival24hRate < thresholds.minimumSurvival24hRate) {
      blockers.push("survival_24h_not_proven");
    }
    if (metric.survival72hRate === null || metric.survival72hRate < thresholds.minimumSurvival72hRate) {
      blockers.push("survival_72h_not_proven");
    }
    if (metric.riskBlockRate !== null && metric.riskBlockRate > thresholds.maximumRiskBlockRate) {
      blockers.push("risk_block_rate_above_threshold");
    }
    if (metric.duplicatePublishCount > thresholds.maximumDuplicatePublishCount) {
      blockers.push("duplicate_publish_count_above_threshold");
    }
    return { platform, ready: blockers.length === 0, blockers };
  });
}

function elapsedHours(from?: string, to?: string): number {
  if (!from || !to) return 0;
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

function publicIdentity(schedule: PublishSchedule): string {
  if (schedule.platformArticleId) return `article:${schedule.platformArticleId}`;
  if (schedule.publicUrl) {
    try {
      const url = new URL(schedule.publicUrl);
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/$/, "");
      return `url:${url.toString()}`;
    } catch {
      return `url:${schedule.publicUrl.trim()}`;
    }
  }
  return `schedule:${schedule.id}`;
}

interface ObservedPublication {
  schedules: PublishSchedule[];
  firstPublicObservedAt: string;
  lastVerifiedAt?: string;
  removedAt?: string;
  status: PublishSchedule["status"];
}

function groupObservedPublications(schedules: PublishSchedule[]): ObservedPublication[] {
  const groups = new Map<string, PublishSchedule[]>();
  for (const schedule of schedules.filter((item) => Boolean(item.firstPublicObservedAt))) {
    const key = publicIdentity(schedule);
    groups.set(key, [...(groups.get(key) || []), schedule]);
  }
  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((left, right) =>
      String(left.lastVerifiedAt || left.firstPublicObservedAt).localeCompare(
        String(right.lastVerifiedAt || right.firstPublicObservedAt)
      )
    );
    const latest = ordered.at(-1)!;
    const firstPublicObservedAt = ordered
      .map((item) => item.firstPublicObservedAt!)
      .sort((left, right) => left.localeCompare(right))[0];
    return {
      schedules: ordered,
      firstPublicObservedAt,
      lastVerifiedAt: latest.lastVerifiedAt,
      removedAt: latest.status === "removed_after_publish" ? latest.removedAt : undefined,
      status: latest.status
    };
  });
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
    const uniqueSubmittedDrafts = new Set(submittedSchedules.map((schedule) => schedule.draftId)).size;
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
    const observed = groupObservedPublications(platformSchedules);
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
      .map((publication) => {
        const submissionTimes = publication.schedules
          .map((schedule) => firstSubmissionActionAt.get(schedule.id) || schedule.publishedAt)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => left.localeCompare(right));
        if (!submissionTimes.length) return Number.NaN;
        return elapsedHours(submissionTimes[0], publication.firstPublicObservedAt) * 60;
      })
      .filter((value) => Number.isFinite(value) && value >= 0);
    return {
      platform,
      total: platformSchedules.length,
      submitted: submittedSchedules.length,
      uniqueSubmittedDrafts,
      publicObserved: observed.length,
      stablePublished: observed.filter((publication) => publication.status === "stable_published").length,
      removedAfterPublish: observed.filter((publication) => publication.status === "removed_after_publish").length,
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
