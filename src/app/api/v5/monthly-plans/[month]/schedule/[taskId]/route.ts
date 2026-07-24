import { NextRequest, NextResponse } from "next/server";
import type { V5ApiEnvelope, V5MonthlyPlanRecord } from "@/lib/v5/monthly-workspace-contracts";
import { parseScheduleTaskRequest, scheduleV5ProductionTask, V5ServiceError } from "@/lib/v5/monthly-service";

export async function PATCH(request: NextRequest, { params }: { params: { month: string; taskId: string } }) {
  try {
    const data = await scheduleV5ProductionTask(params.month, params.taskId, parseScheduleTaskRequest(await request.json()));
    return NextResponse.json<V5ApiEnvelope<V5MonthlyPlanRecord>>({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "SCHEDULE_SAVE_FAILED", "排程保存失败，请稍后重试。");
    return NextResponse.json<V5ApiEnvelope<never>>({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
