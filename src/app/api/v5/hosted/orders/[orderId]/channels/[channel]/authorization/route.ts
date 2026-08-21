import { NextResponse } from "next/server";
import { openHostedChannelAuthorization } from "@/lib/v5/hosted-channel-authorization-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { assertWorkspaceOrderAccess, requireHostedIdentity, requireHostedRole } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string; channel: string }> }) {
  try {
    const { orderId, channel } = await params;
    const identity = await requireHostedIdentity(request);
    requireHostedRole(identity, ["workspace_admin", "product_owner"]);
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    const result = await openHostedChannelAuthorization({ orderId, channel });
    return NextResponse.json(
      { ok: result.ok, authorization: result },
      { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
