import { NextRequest, NextResponse } from "next/server";
import { parseStrategyMutationRequest, removeV5StrategyItem, V5ServiceError } from "@/lib/v5/monthly-service";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ month: string; quotaRuleId: string }> }) {
  const routeParams = await params;
  try {
    const data = await removeV5StrategyItem(routeParams.month, routeParams.quotaRuleId, parseStrategyMutationRequest(await request.json()));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof V5ServiceError ? error : new V5ServiceError(500, "STRATEGY_ITEM_REMOVE_FAILED", "策略项删除失败，请稍后重试。");
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
