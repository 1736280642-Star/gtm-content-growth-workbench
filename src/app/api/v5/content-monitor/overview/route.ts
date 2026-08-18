import { NextRequest, NextResponse } from "next/server";
import { getContentMonitorOverview } from "@/lib/v5/content-monitor-service";
import type { ContentMonitorPlatform } from "@/lib/v5/content-monitor-contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const rangeDays = Number(request.nextUrl.searchParams.get("rangeDays") || 30);
    const allowed = new Set<ContentMonitorPlatform>(["wechat", "csdn", "juejin", "zhihu"]);
    const selected = (request.nextUrl.searchParams.get("platforms") || "").split(",").filter((item): item is ContentMonitorPlatform => allowed.has(item as ContentMonitorPlatform));
    const data = await getContentMonitorOverview(rangeDays, selected.length ? selected : undefined);
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: { code: "CONTENT_MONITOR_READ_FAILED", message: error instanceof Error ? error.message : "内容监控数据读取失败。" }
    }, { status: 500 });
  }
}
