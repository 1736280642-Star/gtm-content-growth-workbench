import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { verifyHostedPreferenceToken } from "@/lib/v5/hosted-link-signing";
import { readHostedPromotionOrderRecord, updateHostedPromotionOrderPreferences } from "@/lib/v5/hosted-managed-repository";
import { hashV5GovernancePayload } from "@/lib/v5/knowledge-governance-repository";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readOrder(token: string) {
  const { orderId } = verifyHostedPreferenceToken(token);
  const order = await readHostedPromotionOrderRecord(orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  return order;
}

function publicView(order: NonNullable<Awaited<ReturnType<typeof readHostedPromotionOrderRecord>>>) {
  return {
    orderId: order.orderId,
    productName: order.productName,
    status: order.status,
    rowVersion: order.rowVersion,
    notificationPreferences: order.notificationPreferences
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return NextResponse.json({ ok: true, order: publicView(await readOrder(token)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    if (typeof body.dailyDigest !== "boolean" || typeof body.monthlyCompleted !== "boolean"
      || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || !idempotencyKey) {
      throw new V5GovernanceServiceError("invalid_contract", "通知偏好、版本和提交标识为必填项。", 400);
    }
    const order = await readOrder(token);
    const actorId = `hosted-preference-${hashV5GovernancePayload(token).slice(0, 24)}`;
    const result = await updateHostedPromotionOrderPreferences({
      orderId: order.orderId,
      channels: order.channels,
      dailyDigest: body.dailyDigest,
      monthlyCompleted: body.monthlyCompleted,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
      actor: {
        actorId,
        actorRole: "product_owner",
        actorType: "human",
        auditReason: "用户通过签名邮件链接修改托管通知偏好"
      }
    });
    return NextResponse.json({ ok: true, order: publicView(result.order), replayed: result.replayed });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
