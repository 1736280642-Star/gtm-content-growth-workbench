import { NextResponse } from "next/server";
import { readHostedEmailSenderStatus } from "@/lib/v5/hosted-email-sender-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(
      { ok: true, sender: await readHostedEmailSenderStatus() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
