import { NextRequest, NextResponse } from "next/server";
import { compactMonthlyWorkspace, getMonthlyWorkspaceReadModel } from "@/lib/v5/monthly-workspace-read-model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fullModel = await getMonthlyWorkspaceReadModel(request.nextUrl.searchParams.get("month") || undefined);
  const taskId = request.nextUrl.searchParams.get("taskId")?.trim();
  if (taskId) {
    const task = fullModel.productionTasks.find((item) => item.taskId === taskId);
    if (!task) return NextResponse.json({ ok: false, error: { code: "task_not_found", message: "未找到对应的生产任务。" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: { month: fullModel.month, task } }, { headers: { "cache-control": "no-store" } });
  }
  const model = compactMonthlyWorkspace(fullModel);
  return NextResponse.json({ ok: true, data: { month: model.month, productionTasks: model.productionTasks, batchQueueItems: model.batchQueueItems } }, { headers: { "cache-control": "no-store" } });
}
