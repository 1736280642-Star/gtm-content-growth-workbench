import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { readHostedPromotionOrderRecord } from "@/lib/v5/hosted-managed-repository";
import { enqueueHostedReviewNotification, ensureHostedReviewForOrder } from "@/lib/v5/hosted-review-service";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const order = await readHostedPromotionOrderRecord(orderId);
    if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
    const review = await ensureHostedReviewForOrder(order);
    if (!review || review.status !== "pending") throw new V5GovernanceServiceError("hosted_review_not_pending", "当前没有等待确认的策略或样文。", 409);
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const queued = await enqueueHostedReviewNotification(review, `resend-${hourBucket}`);
    return NextResponse.json({ ok: true, queued: true, replayed: queued.replayed, message: queued.replayed ? "本小时已经重新发送过，请检查邮箱。" : "确认邮件已重新加入发送队列。" });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
