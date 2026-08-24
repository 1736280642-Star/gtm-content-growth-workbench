import { NextResponse } from "next/server";
import { requestHostedEmailLogin } from "@/lib/v5/hosted-identity-service";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await requestHostedEmailLogin(String(body.email || ""));
    return NextResponse.json({
      ok: true,
      message: result.demoCode ? `演示模式：固定验证码为 ${result.demoCode}，邮件已进入演示收件箱。` : "如果邮箱有效，登录链接已经发送。请在15分钟内打开。",
      ...(result.demoCode ? { demoCode: result.demoCode } : {})
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

