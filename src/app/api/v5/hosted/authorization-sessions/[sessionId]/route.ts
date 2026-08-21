import { NextResponse } from "next/server";
import { readChannelAuthorizationSession } from "@/lib/v5/channel-account-connection-service";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const identity = await requireHostedIdentity(request);
    const { sessionId } = await params;
    return NextResponse.json({ ok: true, session: await readChannelAuthorizationSession(identity, sessionId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

