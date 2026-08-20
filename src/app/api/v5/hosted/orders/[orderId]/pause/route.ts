import { NextResponse } from "next/server";
import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { setHostedPromotionOrderPauseState } from "@/lib/v5/hosted-managed-repository";
import { getHostedPromotionOrder } from "@/lib/v5/hosted-managed-service";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "pause" || body.action === "resume" ? body.action : undefined;
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    if (!action || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || !idempotencyKey) {
      throw new V5GovernanceServiceError("invalid_contract", "action、expectedVersion 和提交标识为必填项。", 400);
    }
    const trusted = readTrustedServerActor("product_owner");
    if (process.env.NODE_ENV === "production" && !trusted) throw new V5GovernanceServiceError("authorization_not_configured", "生产环境尚未配置可信用户身份。", 503);
    const actor = trusted || { actorId: "local-workbench-user", actorRole: "product_owner", actorType: "human" as const, auditReason: "用户调整 GEO 托管运行状态" };
    const result = await setHostedPromotionOrderPauseState({
      orderId,
      paused: action === "pause",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
      actor: { ...actor, auditReason: action === "pause" ? "用户暂停 GEO 托管" : "用户恢复 GEO 托管" }
    });
    return NextResponse.json({ ok: true, ...(action === "resume" ? await getHostedPromotionOrder(orderId) : result) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
