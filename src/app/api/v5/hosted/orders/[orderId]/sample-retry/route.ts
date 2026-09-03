import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { assertWorkspaceOrderAccess, requireHostedIdentity, requireHostedRole } from "@/lib/v5/hosted-identity-service";
import { retryHostedSampleGeneration } from "@/lib/v5/hosted-managed-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const identity = await requireHostedIdentity(request);
    requireHostedRole(identity, ["workspace_admin", "product_owner"]);
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    return NextResponse.json({ ok: true, ...(await retryHostedSampleGeneration(orderId, identity.userId)) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
