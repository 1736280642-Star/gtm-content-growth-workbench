import { NextResponse } from "next/server";
import { assertWorkspaceOrderAccess, requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";
import { listHostedResultSnapshots } from "@/lib/v5/hosted-history-repository";
import { readHostedPromotionOrderRecord } from "@/lib/v5/hosted-managed-repository";
import { hostedHistorySteps, summarizeHostedResult } from "@/lib/v5/hosted-history-contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { orderId } = await params;
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    const query = new URL(request.url).searchParams;
    const step = query.get("step"), resultId = query.get("resultId");
    if (step && !hostedHistorySteps.some(value => value === step)) throw new V5GovernanceServiceError("invalid_step", "结果步骤无效，请从托管回执重新进入。", 400);
    const [order, results] = await Promise.all([readHostedPromotionOrderRecord(orderId), listHostedResultSnapshots(orderId)]);
    if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
    const result = results.find(item => (!resultId || item.resultId === resultId) && (!step || item.step === step));
    if (resultId && !result) throw new V5GovernanceServiceError("hosted_result_not_found", "该历史结果不存在或不属于当前任务，请返回托管回执。", 404);
    return NextResponse.json({ order: { orderId, productName: order.productName }, entries: results.map(summarizeHostedResult), result: step || resultId ? result : undefined }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return v5GovernanceErrorResponse(error); }
}
