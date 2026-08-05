import { NextResponse } from "next/server";
import { createPublishJobFromApprovedContent, dispatchPublishJob } from "@/lib/publish-job-service";
import type { DirectPublishPlatformKey } from "@/lib/types";
import { getMonthlyWorkspaceReadModel } from "@/lib/v5/monthly-workspace-read-model";
import { readFormalDraftVersion } from "@/lib/v5/single-article-production-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platforms = new Set<DirectPublishPlatformKey>(["wechat", "csdn", "juejin", "zhihu"]);
const platformByChannel: Record<string, DirectPublishPlatformKey | undefined> = {
  wechat: "wechat",
  csdn: "csdn",
  juejin: "juejin",
  zhihu_toutiao_general: "zhihu"
};

function restoredSnapshotAuditReason(payload: Record<string, unknown>) {
  return typeof payload.auditReason === "string" ? payload.auditReason.trim() : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const draftId = typeof payload.draftId === "string" ? payload.draftId.trim() : "";
  const platform = typeof payload.platform === "string" && platforms.has(payload.platform as DirectPublishPlatformKey)
    ? payload.platform as DirectPublishPlatformKey
    : undefined;
  if (!draftId || !platform) {
    return NextResponse.json(
      { ok: false, message: "draftId and a supported platform are required." },
      { status: 400 }
    );
  }

  const draft = await readFormalDraftVersion(draftId);
  let approvedDraft = draft
    ? {
        draftVersionId: draft.draftVersionId,
        matrixItemId: draft.matrixItemId || taskId,
        title: draft.title,
        markdown: draft.markdown
      }
    : undefined;

  if (draft && (!draft.copyAllowed || draft.testOnly || !draft.hardRuleResult.passed)) {
    return NextResponse.json(
      { ok: false, message: "Only a formal, copy-allowed draft that passed hard rules can enter Publish Job." },
      { status: 422 }
    );
  }

  if (!approvedDraft && payload.allowRestoredSnapshot === true) {
    const auditReason = restoredSnapshotAuditReason(payload);
    if (process.env.V5_TRUSTED_SERVER_WRITES_ENABLED !== "true" || !auditReason) {
      return NextResponse.json(
        { ok: false, message: "Restored snapshot publishing requires trusted server writes and an audit reason." },
        { status: 403 }
      );
    }
    const month = typeof payload.month === "string" ? payload.month.trim() : undefined;
    const workspace = await getMonthlyWorkspaceReadModel(month);
    const task = workspace.productionTasks.find((item) => item.taskId === taskId);
    const restoredDraft = [task?.lastUsableDraft, task?.currentDraft]
      .find((item) => item?.draftId === draftId && item.status === "available" && item.markdown?.trim());
    const expectedPlatform = task ? platformByChannel[task.channel] : undefined;
    if (workspace.plan?.status !== "confirmed" || !task || task.status !== "scheduled" || !restoredDraft || expectedPlatform !== platform) {
      return NextResponse.json(
        { ok: false, message: "The restored monthly snapshot is not an approved, scheduled task for this platform." },
        { status: 422 }
      );
    }
    approvedDraft = {
      draftVersionId: restoredDraft.draftId,
      matrixItemId: task.taskId,
      title: restoredDraft.title,
      markdown: restoredDraft.markdown
    };
  }

  if (!approvedDraft) {
    return NextResponse.json(
      { ok: false, message: "Only a formal approved draft, or an explicitly audited restored snapshot, can enter Publish Job." },
      { status: 422 }
    );
  }

  const created = await createPublishJobFromApprovedContent({
    sourceDraftId: approvedDraft.draftVersionId,
    sourceTaskId: taskId,
    matrixItemId: approvedDraft.matrixItemId,
    title: approvedDraft.title,
    markdown: approvedDraft.markdown,
    platform,
    scheduledAt: typeof payload.scheduledAt === "string" ? payload.scheduledAt : undefined
  });
  if (!created.ok || !created.data) {
    return NextResponse.json(created, { status: created.status === "pending_input" ? 409 : 422 });
  }

  const dispatched: Awaited<ReturnType<typeof dispatchPublishJob>>[] = [];
  if (payload.dispatch !== false) {
    for (const schedule of created.data.schedules) dispatched.push(await dispatchPublishJob(schedule.id));
  }
  return NextResponse.json({ ...created, dispatched }, { status: 202 });
}
