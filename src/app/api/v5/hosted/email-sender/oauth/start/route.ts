import { NextResponse } from "next/server";
import { beginHostedEmailOAuth } from "@/lib/v5/hosted-email-sender-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const result = await beginHostedEmailOAuth({
      provider: field(formData, "provider"),
      setupToken: field(formData, "setupToken")
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
