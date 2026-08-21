import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { listHostedChannelOptions } from "@/lib/v5/hosted-channel-service";
import { assertWorkspaceProductAccess, requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    const productId = new URL(request.url).searchParams.get("productId")?.trim() || undefined;
    if (productId) await assertWorkspaceProductAccess(identity.workspaceId, productId);
    return NextResponse.json(
      { ok: true, channels: await listHostedChannelOptions(productId) },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
