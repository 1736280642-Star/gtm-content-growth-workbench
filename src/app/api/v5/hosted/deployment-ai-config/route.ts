import { NextResponse } from "next/server";
import { requireHostedEmailSetupToken } from "@/lib/v5/hosted-email-sender-service";
import { saveDeploymentAiConfig } from "@/lib/v5/deployment-ai-config";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { setupToken?: string; configText?: string };
    requireHostedEmailSetupToken(String(body.setupToken || ""));
    const result = saveDeploymentAiConfig(String(body.configText || ""));
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
