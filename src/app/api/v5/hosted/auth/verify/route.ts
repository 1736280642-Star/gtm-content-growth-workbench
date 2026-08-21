import { NextResponse } from "next/server";
import { consumeHostedEmailLogin, hostedSessionCookie } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token || "").trim();
  try {
    const result = await consumeHostedEmailLogin(token);
    const response = NextResponse.json({ ok: true, redirectTo: "/" });
    response.headers.set("set-cookie", hostedSessionCookie(result.sessionToken));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ ok: false, message: "登录链接无效、已使用或已过期。" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
}
