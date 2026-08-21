import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { listHostedDailyPublishBatches } from "@/lib/v5/hosted-daily-batch-service";
import { assertWorkspaceOrderAccess, requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const identity = await requireHostedIdentity(request);
    await assertWorkspaceOrderAccess(identity.workspaceId, orderId);
    return NextResponse.json({ ok: true, batches: await listHostedDailyPublishBatches(orderId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
