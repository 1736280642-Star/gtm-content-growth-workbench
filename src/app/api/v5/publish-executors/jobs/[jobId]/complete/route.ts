import { NextResponse } from "next/server";
import { completeBrowserExecutionJob, requireBrowserExecutor } from "@/lib/v5/browser-executor-pool";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const identity = await requireBrowserExecutor(request);
    const { jobId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await completeBrowserExecutionJob(identity, {
      jobId,
      leaseToken: String(body.leaseToken || ""),
      ok: body.ok === true,
      result: body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : undefined,
      failureCode: body.failureCode ? String(body.failureCode) : undefined,
      failureMessage: body.failureMessage ? String(body.failureMessage) : undefined
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

