import { NextRequest, NextResponse } from "next/server";
import { parseStrategyMutationRequest, removeV5ProductionTasks, V5ServiceError } from "@/lib/v5/monthly-service";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const routeParams = await params;
  try {
    const body = await request.json() as { taskIds?: unknown; expectedVersion?: unknown; auditReason?: unknown };
    const data = await removeV5ProductionTasks(routeParams.month, Array.isArray(body.taskIds) ? body.taskIds.map(String) : [], parseStrategyMutationRequest(body));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "PRODUCTION_TASK_REMOVE_FAILED", "文章任务删除失败，请稍后重试。");
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
