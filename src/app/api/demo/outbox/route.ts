import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/config";
import { listDemoEmails } from "@/lib/demo/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!isDemoMode()) {
    return NextResponse.json({ ok: false, message: "演示模式未开启。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, emails: listDemoEmails() }, { headers: { "cache-control": "no-store" } });
}
