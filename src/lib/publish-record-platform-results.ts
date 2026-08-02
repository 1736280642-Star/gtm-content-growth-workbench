import type { DirectPublishPlatformKey, PublishRecord, PublishSchedule } from "./types";

function primaryPlatformForRecord(record: PublishRecord): DirectPublishPlatformKey {
  if (record.channel === "zhihu_toutiao_general") return "zhihu";
  return record.channel;
}

export function mergePublishRecordPlatformResult(record: PublishRecord, schedule: PublishSchedule): PublishRecord {
  const platformResult = {
    platform: schedule.platform,
    scheduleId: schedule.id,
    status: schedule.status,
    platformArticleId: schedule.platformArticleId,
    publicUrl: schedule.publicUrl,
    urlStatus: schedule.urlStatus,
    firstPublicObservedAt: schedule.firstPublicObservedAt,
    lastVerifiedAt: schedule.lastVerifiedAt,
    stablePublishedAt: schedule.stablePublishedAt,
    removedAt: schedule.removedAt,
    failureCode: schedule.failureCode,
    failureReason: schedule.failureReason
  };
  const nextRecord: PublishRecord = {
    ...record,
    platformResults: {
      ...(record.platformResults || {}),
      [schedule.platform]: platformResult
    }
  };

  if (schedule.platform !== primaryPlatformForRecord(record)) return nextRecord;

  if (["public_observed", "stable_published", "published_verified", "published_pending_url"].includes(schedule.status)) {
    return {
      ...nextRecord,
      publishStatus: schedule.publicUrl ? "url_filled" : "published",
      publishedAt: schedule.publishedAt || record.publishedAt,
      publishedUrl: schedule.publicUrl || record.publishedUrl,
      urlStatus: schedule.urlStatus || (schedule.publicUrl ? "provisional" : "pending"),
      firstPublicObservedAt: schedule.firstPublicObservedAt || record.firstPublicObservedAt,
      lastVerifiedAt: schedule.lastVerifiedAt || record.lastVerifiedAt,
      stablePublishedAt: schedule.stablePublishedAt || record.stablePublishedAt,
      removedAt: undefined,
      notes: schedule.pendingCsvReturn ? "平台已受理，公开 URL 仍在自动验证。" : record.notes
    };
  }

  if (schedule.status === "removed_after_publish" || schedule.status === "platform_rejected") {
    return {
      ...nextRecord,
      publishStatus: "failed",
      publishedUrl: schedule.publicUrl || record.publishedUrl,
      urlStatus: schedule.status === "removed_after_publish" ? "removed" : "rejected",
      firstPublicObservedAt: schedule.firstPublicObservedAt || record.firstPublicObservedAt,
      lastVerifiedAt: schedule.lastVerifiedAt || record.lastVerifiedAt,
      stablePublishedAt: schedule.stablePublishedAt || record.stablePublishedAt,
      removedAt: schedule.removedAt || record.removedAt,
      notes: schedule.failureReason || record.notes
    };
  }

  if (["failed", "precheck_failed", "verification_timeout", "auth_expired", "risk_blocked", "manual_takeover_required"].includes(schedule.status)) {
    return {
      ...nextRecord,
      publishStatus: "failed",
      publishedUrl: schedule.publicUrl,
      publishedAt: schedule.publishedAt,
      urlStatus: schedule.urlStatus,
      firstPublicObservedAt: schedule.firstPublicObservedAt,
      lastVerifiedAt: schedule.lastVerifiedAt,
      stablePublishedAt: schedule.stablePublishedAt,
      removedAt: schedule.removedAt,
      notes: schedule.failureReason || record.notes
    };
  }

  if (schedule.status === "scheduled" || schedule.status === "pending_config") {
    return { ...nextRecord, publishStatus: "queued" };
  }

  return nextRecord;
}
