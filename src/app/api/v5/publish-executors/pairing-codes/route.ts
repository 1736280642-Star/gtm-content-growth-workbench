import { NextResponse } from "next/server";
import { createDesktopExecutorPairingCode } from "@/lib/v5/browser-executor-pool";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json({ ok: true, ...(await createDesktopExecutorPairingCode(identity, String(body.displayName || "Desktop Connector"))) }, { status: 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

