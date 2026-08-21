import { NextResponse } from "next/server";
import { readHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await readHostedIdentity(request);
  if (!identity) {
    return NextResponse.json({ ok: false, message: "请先通过邮箱登录。" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ ok: true, identity }, { headers: { "cache-control": "no-store" } });
}

