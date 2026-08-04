import {
  createPublishSchedules,
  createPublishSchedulesFromApprovedContent,
  dispatchPublishReconciliation,
  dispatchPublishSchedule,
  readWorkbenchState,
  runDuePublishSchedules,
  runPublishSchedule,
  verifyPublishSchedule
} from "@/lib/workbench-store";
import { getPublishAdapter } from "@/lib/publish-adapters";
import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule } from "@/lib/types";
import type { ApprovedPublishContentInput } from "@/lib/workbench-store";
import { serializePublishMutation } from "@/lib/publish-mutation-queue";
import { backfillPublishJob } from "@/lib/publish-job-backfill";

export interface PublishJobView {
  schedule: PublishSchedule;
  attempts: PublishAttempt[];
}

function viewForSchedule(schedule: PublishSchedule, attempts: PublishAttempt[]): PublishJobView {
  return {
    schedule,
    attempts: attempts
      .filter((attempt) => attempt.scheduleId === schedule.id)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  };
}

export function listPublishJobs(filters: { platform?: string; status?: string } = {}): PublishJobView[] {
  const state = readWorkbenchState();
  return state.publishSchedules
    .filter((schedule) => !filters.platform || schedule.platform === filters.platform)
    .filter((schedule) => !filters.status || schedule.status === filters.status)
    .map((schedule) => viewForSchedule(schedule, state.publishAttempts));
}

export function getPublishJob(id: string): PublishJobView | undefined {
  const state = readWorkbenchState();
  const schedule = state.publishSchedules.find((candidate) => candidate.id === id);
  return schedule ? viewForSchedule(schedule, state.publishAttempts) : undefined;
}

export function listPublishCandidates() {
  const state = readWorkbenchState();
  return state.drafts
    .filter((draft) => draft.status === "final" && draft.qaResult.passed && draft.qaResult.distributionAllowed !== false)
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      channel: draft.channel,
      version: draft.version,
      updatedAt: draft.updatedAt,
      existingPlatforms: state.publishSchedules
        .filter((schedule) => schedule.draftId === draft.id)
        .map((schedule) => schedule.platform)
    }));
}

export async function createPublishJob(input: Record<string, unknown>) {
  return serializePublishMutation(() => createPublishSchedules(input));
}

export async function createPublishJobFromApprovedContent(input: ApprovedPublishContentInput) {
  return serializePublishMutation(() => createPublishSchedulesFromApprovedContent(input));
}

export async function runPublishJob(id: string) {
  return serializePublishMutation(() => runPublishSchedule(id));
}

export async function dispatchPublishJob(id: string) {
  return serializePublishMutation(() => dispatchPublishSchedule(id));
}

export async function dispatchPublishJobReconciliation(id: string) {
  return serializePublishMutation(() => dispatchPublishReconciliation(id));
}

export async function reconcilePublishJob(id: string) {
  const result = await serializePublishMutation(() => verifyPublishSchedule(id));
  if (result.ok && result.data?.schedule) await backfillPublishJob(result.data.schedule);
  return result;
}

export async function runDuePublishJobs(input: Record<string, unknown>) {
  const result = await serializePublishMutation(() => runDuePublishSchedules(input));
  if (result.ok && result.data?.attempts) {
    for (const attempt of result.data.attempts) {
      const job = getPublishJob(attempt.scheduleId);
      if (job) await backfillPublishJob(job.schedule);
    }
  }
  return result;
}

export async function probePublishPlatformAuth(platform: DirectPublishPlatformKey) {
  const result = await getPublishAdapter(platform).checkAuth();
  return {
    ok: result.ok,
    status: result.status === "ready" ? "success" : result.status === "pending_config" ? "pending_config" : "failed",
    message: result.message || (result.ok ? `${platform} publish session is ready.` : `${platform} publish session is unavailable.`),
    data: {
      platform,
      authenticated: result.ok,
      authStatus: result.status,
      nextAction: result.nextAction,
      failureCode: result.failureCode,
      missingConfig: result.missingConfig
    }
  };
}
