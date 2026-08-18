import { NextResponse } from "next/server";
import { getContentMonitorFailureAlerts } from "@/lib/v5/content-monitor-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: { items: getContentMonitorFailureAlerts() } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : "失败告警读取失败。" } }, { status: 500 });
  }
}
