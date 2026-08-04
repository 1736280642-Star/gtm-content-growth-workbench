import { NextResponse } from "next/server";
import { createPublishJobFromApprovedContent, dispatchPublishJob } from "@/lib/publish-job-service";
import type { DirectPublishPlatformKey } from "@/lib/types";
import { readFormalDraftVersion } from "@/lib/v5/single-article-production-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platforms = new Set<DirectPublishPlatformKey>(["wechat", "csdn", "juejin", "zhihu"]);

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
  if (!draft || !draft.copyAllowed || draft.testOnly || !draft.hardRuleResult.passed) {
    return NextResponse.json(
      { ok: false, message: "Only a formal, copy-allowed draft that passed hard rules can enter Publish Job." },
      { status: 422 }
    );
  }

  const created = await createPublishJobFromApprovedContent({
    sourceDraftId: draft.draftVersionId,
    sourceTaskId: taskId,
    matrixItemId: draft.matrixItemId || taskId,
    title: draft.title,
    markdown: draft.markdown,
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
