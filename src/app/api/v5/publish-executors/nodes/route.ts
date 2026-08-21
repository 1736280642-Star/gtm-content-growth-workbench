import { NextResponse } from "next/server";
import { listWorkspaceBrowserExecutors } from "@/lib/v5/browser-executor-pool";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    return NextResponse.json({ ok: true, nodes: await listWorkspaceBrowserExecutors(identity) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
