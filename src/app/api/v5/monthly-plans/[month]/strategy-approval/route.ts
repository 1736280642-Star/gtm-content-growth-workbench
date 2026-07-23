import { NextRequest, NextResponse } from "next/server";
import type { V5ApiEnvelope, V5MonthlyPlanRecord } from "@/lib/v5/monthly-workspace-contracts";
import { approveV5Strategy, parseStrategyMutationRequest, V5ServiceError } from "@/lib/v5/monthly-service";

export async function POST(request: NextRequest, { params }: { params: { month: string } }) {
  try {
    const data = await approveV5Strategy(params.month, parseStrategyMutationRequest(await request.json()));
    return NextResponse.json<V5ApiEnvelope<V5MonthlyPlanRecord>>({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "STRATEGY_APPROVAL_FAILED", "内容策略包批准失败，请稍后重试。");
    return NextResponse.json<V5ApiEnvelope<never>>({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
