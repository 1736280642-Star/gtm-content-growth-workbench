import { NextResponse } from "next/server";
import { completeHostedEmailOAuth } from "@/lib/v5/hosted-email-sender-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function setupPage(request: Request, search: Record<string, string>) {
  const configuredBase = (process.env.HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL || process.env.HOSTED_PUBLIC_BASE_URL)?.trim();
  const url = new URL(configuredBase || request.url);
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  url.pathname = "/hosted/email-sender";
  url.search = "";
  url.hash = "";
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { headers: { "cache-control": "no-store" } });
}

function safeFailureCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "hosted_email_oauth_unexpected";
  const code = String(error.code);
  return /^hosted_email_[a-z0-9_]+$/.test(code) ? code : "hosted_email_oauth_unexpected";
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const { provider } = await params;
  if (url.searchParams.get("error")) return setupPage(request, { error: "authorization_cancelled" });
  let result: Awaited<ReturnType<typeof completeHostedEmailOAuth>>;
  try {
    result = await completeHostedEmailOAuth({
      provider,
      state: url.searchParams.get("state") || "",
      code: url.searchParams.get("code") || ""
    });
  } catch (error) {
    return setupPage(request, { error: "authorization_failed", reason: safeFailureCode(error) });
  }
  return setupPage(request, { result: "connected", provider: result.provider });
}
