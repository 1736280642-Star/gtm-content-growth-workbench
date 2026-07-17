import { NextRequest, NextResponse } from "next/server";
import type { V5ApiEnvelope, V5MonthlyPlanRecord } from "@/lib/v5/monthly-workspace-contracts";
import { parseSaveMonthlyPlanRequest, saveV5MonthlyPlan, V5ServiceError } from "@/lib/v5/monthly-service";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: { month: string } }) {
  try {
    const body = parseSaveMonthlyPlanRequest(await request.json());
    const data = await saveV5MonthlyPlan(params.month, body, request.headers.get("x-idempotency-key"));
    return NextResponse.json<V5ApiEnvelope<V5MonthlyPlanRecord>>({ ok: true, data });
  } catch (error) {
    const serviceError = error instanceof V5ServiceError ? error : new V5ServiceError(500, "V5_MONTHLY_PLAN_SAVE_FAILED", "月度计划保存失败，请稍后重试。");
    return NextResponse.json<V5ApiEnvelope<never>>(
      {
        ok: false,
        error: { code: serviceError.code, message: serviceError.message, details: serviceError.details }
      },
      { status: serviceError.status }
    );
  }
}
