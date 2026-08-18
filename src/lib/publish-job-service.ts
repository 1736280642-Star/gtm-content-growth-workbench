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
import { productLabels } from "@/lib/labels";

export interface PublishJobView {
  schedule: PublishSchedule;
  attempts: PublishAttempt[];
  title: string;
  productName: string;
}

function inferProductName(title: string, fallback?: string) {
  if (/腾讯云\s*ADP|Tencent\s+Cloud\s+ADP/i.test(title)) return "腾讯云 ADP";
  if (/WorkBuddy/i.test(title)) return "WorkBuddy";
  if (/NoteFlow/i.test(title)) return "Noteflow";
  if (/Pharaoh\s+Command/i.test(title)) return "Pharaoh Command";
  if (/唯客|Weike|Guardrail|AI\s*护栏/i.test(title) || fallback === productLabels.weike_guardrails) return "Weike AI Guardrail";
  return fallback || "其他产品内容";
}

function viewForSchedule(schedule: PublishSchedule, attempts: PublishAttempt[], state: ReturnType<typeof readWorkbenchState>): PublishJobView {
  const draft = state.drafts.find((item) => item.id === schedule.draftId);
  const task = draft ? state.tasks.find((item) => item.id === draft.taskId) : undefined;
  const publishRecord = state.publishRecords.find((item) => item.id === schedule.publishRecordId || item.draftId === schedule.draftId);
  const platformVariant = state.platformDraftVariants.find((item) => item.id === schedule.platformVariantId || item.articleDraftId === schedule.draftId);
  const title = platformVariant?.title || draft?.title || publishRecord?.title || `发布任务 ${schedule.id}`;
  return {
    schedule,
    title,
    productName: inferProductName(title, task ? productLabels[task.product] : undefined),
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
    .map((schedule) => viewForSchedule(schedule, state.publishAttempts, state));
}

export function getPublishJob(id: string): PublishJobView | undefined {
  const state = readWorkbenchState();
  const schedule = state.publishSchedules.find((candidate) => candidate.id === id);
  return schedule ? viewForSchedule(schedule, state.publishAttempts, state) : undefined;
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
