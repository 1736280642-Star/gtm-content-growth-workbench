"use client";

import { CheckCircleFilled, ClockCircleOutlined, ExclamationCircleFilled, LoadingOutlined } from "@ant-design/icons";
import type { PublishSchedule } from "@/lib/types";

const terminalFailure = new Set(["platform_rejected", "removed_after_publish", "verification_timeout", "failed", "risk_blocked", "auth_expired"]);

function stage(schedule: PublishSchedule) {
  if (terminalFailure.has(schedule.status)) return 2;
  if (schedule.status === "stable_published") return 6;
  if (schedule.firstPublicObservedAt) {
    const age = Date.now() - Date.parse(schedule.firstPublicObservedAt);
    if (age >= 72 * 3_600_000) return 6;
    if (age >= 24 * 3_600_000) return 5;
    return 4;
  }
  if (schedule.publicUrl) return 3;
  if (["published_verified", "published_pending_url", "pending_verify", "public_observed"].includes(schedule.status)) return 2;
  if (schedule.status === "publishing" || schedule.attemptIds.length) return 1;
  return 0;
}

const steps = ["Publish Job", "Worker", "Reconciliation", "URL 回填", "公开存活", "24h", "72h / 稳定"];

export function PublishLifecycleRail({ schedule }: { schedule: PublishSchedule }) {
  const current = stage(schedule);
  const failed = terminalFailure.has(schedule.status);
  return (
    <div className="publish-lifecycle" aria-label="自动发布生命周期">
      {steps.map((label, index) => {
        const done = !failed && index < current;
        const active = index === current;
        return (
          <div className={`publish-lifecycle-step ${done ? "is-done" : ""} ${active ? "is-active" : ""} ${failed && active ? "is-failed" : ""}`} key={label}>
            <span className="publish-lifecycle-icon">
              {failed && active ? <ExclamationCircleFilled /> : done ? <CheckCircleFilled /> : active ? <LoadingOutlined /> : <ClockCircleOutlined />}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
