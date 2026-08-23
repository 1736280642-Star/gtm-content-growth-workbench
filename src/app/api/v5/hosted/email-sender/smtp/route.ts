import { NextResponse } from "next/server";
import { connectHostedSmtpSender } from "@/lib/v5/hosted-email-sender-service";
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
    const sender = await connectHostedSmtpSender({
      provider: field(formData, "provider"),
      email: field(formData, "email"),
      appPassword: field(formData, "appPassword"),
      setupToken: field(formData, "setupToken")
    });
    return NextResponse.json({ ok: true, sender }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
