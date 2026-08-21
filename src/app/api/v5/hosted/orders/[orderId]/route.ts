import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getHostedPromotionOrder } from "@/lib/v5/hosted-managed-service";
import { assertWorkspaceOrderAccess, requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { orderId } = await params;
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    return NextResponse.json(
      { ok: true, ...(await getHostedPromotionOrder(orderId)) },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
