import type { PublishSchedule } from "@/lib/types";

function observedVerificationIdentity(schedule: PublishSchedule): string {
  if (schedule.platformArticleId) return `${schedule.platform}:article:${schedule.platformArticleId}`;
  if (schedule.publicUrl) {
    return `${schedule.platform}:url:${schedule.publicUrl.split(/[?#]/, 1)[0].replace(/\/$/, "")}`;
  }
  return `${schedule.platform}:schedule:${schedule.id}`;
}

export function deduplicateObservedPublishVerifications(schedules: PublishSchedule[]): PublishSchedule[] {
  const canonicalByIdentity = new Map<string, PublishSchedule>();
  for (const schedule of schedules.filter((item) => Boolean(item.firstPublicObservedAt))) {
    const identity = observedVerificationIdentity(schedule);
    const current = canonicalByIdentity.get(identity);
    if (!current || String(schedule.firstPublicObservedAt).localeCompare(String(current.firstPublicObservedAt)) < 0) {
      canonicalByIdentity.set(identity, schedule);
    }
  }
  const canonicalIds = new Set([...canonicalByIdentity.values()].map((schedule) => schedule.id));
  return schedules.filter((schedule) => !schedule.firstPublicObservedAt || canonicalIds.has(schedule.id));
}
