import { NextResponse } from "next/server";
import { completeHostedEmailOAuth } from "@/lib/v5/hosted-email-sender-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function setupPage(request: Request, search: Record<string, string>) {
  const url = new URL("/hosted/email-sender", request.url);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const { provider } = await params;
  if (url.searchParams.get("error")) return setupPage(request, { error: "authorization_cancelled" });
  try {
    const result = await completeHostedEmailOAuth({
      provider,
      state: url.searchParams.get("state") || "",
      code: url.searchParams.get("code") || ""
    });
    return setupPage(request, { result: "connected", provider: result.provider });
  } catch {
    return setupPage(request, { error: "authorization_failed" });
  }
}
