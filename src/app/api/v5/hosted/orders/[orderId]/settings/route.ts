import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { assertWorkspaceOrderAccess, requireHostedIdentity, requireHostedRole } from "@/lib/v5/hosted-identity-service";
import { listHostedChannelOptions } from "@/lib/v5/hosted-channel-service";
import { readHostedPromotionOrderRecord, updateHostedPromotionOrderPreferences } from "@/lib/v5/hosted-managed-repository";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const identity = await requireHostedIdentity(request);
    requireHostedRole(identity, ["workspace_admin", "product_owner"]);
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    const channels = Array.isArray(body.channels) ? body.channels.map((value: unknown) => {
      const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const dailyCap = item.dailyCap === undefined || item.dailyCap === null ? undefined : Number(item.dailyCap);
      return { channel: String(item.channel || "").trim(), dailyCap };
    }) : [];
    if (!channels.length || channels.length > 8 || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || !idempotencyKey) {
      throw new V5GovernanceServiceError("invalid_contract", "渠道、版本和提交标识为必填项。", 400);
    }
    if (channels.some((item) => !/^[a-z0-9_]{2,64}$/.test(item.channel) || item.dailyCap !== undefined && (!Number.isInteger(item.dailyCap) || item.dailyCap < 1 || item.dailyCap > 100))) {
      throw new V5GovernanceServiceError("invalid_contract", "渠道或每日上限无效。", 400);
    }
    const order = await readHostedPromotionOrderRecord(orderId);
    if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
    const available = await listHostedChannelOptions(order.productId);
    const capability = new Map(available.map((item) => [item.channel, item.capability]));
    const unavailable = channels.filter((item) => capability.get(item.channel) !== "auto_publish");
    if (unavailable.length) throw new V5GovernanceServiceError("hosted_channel_unavailable", `以下渠道当前不能托管：${unavailable.map((item) => item.channel).join("、")}。`, 409);
    const result = await updateHostedPromotionOrderPreferences({
      orderId,
      channels,
      dailyDigest: body.dailyDigest !== false,
      monthlyCompleted: body.monthlyCompleted !== false,
      expectedVersion: body.expectedVersion,
      idempotencyKey: `${identity.workspaceId}:${idempotencyKey}`,
      actor: { actorId: identity.userId, actorRole: identity.role, actorType: "human", auditReason: "用户修改托管渠道、每日上限或邮件偏好" }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
