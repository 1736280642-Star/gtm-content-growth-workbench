import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { assertWorkspaceOrderAccess, requireHostedIdentity, requireHostedRole } from "@/lib/v5/hosted-identity-service";
import { setHostedPromotionOrderPauseState } from "@/lib/v5/hosted-managed-repository";
import { getHostedPromotionOrder } from "@/lib/v5/hosted-managed-service";
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
    const action = body.action === "pause" || body.action === "resume" ? body.action : undefined;
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    if (!action || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || !idempotencyKey) {
      throw new V5GovernanceServiceError("invalid_contract", "action、expectedVersion 和提交标识为必填项。", 400);
    }
    const result = await setHostedPromotionOrderPauseState({
      orderId,
      paused: action === "pause",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      expectedVersion: body.expectedVersion,
      idempotencyKey: `${identity.workspaceId}:${idempotencyKey}`,
      actor: { actorId: identity.userId, actorRole: identity.role, actorType: "human", auditReason: action === "pause" ? "用户暂停 GEO 托管" : "用户恢复 GEO 托管" }
    });
    return NextResponse.json({ ok: true, ...(action === "resume" ? await getHostedPromotionOrder(orderId) : result) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
