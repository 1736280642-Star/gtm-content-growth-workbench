import { NextResponse } from "next/server";
import { claimBrowserExecutionJob, requireBrowserExecutor } from "@/lib/v5/browser-executor-pool";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireBrowserExecutor(request);
    const job = await claimBrowserExecutionJob(identity);
    return NextResponse.json({ ok: true, job: job || null }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
