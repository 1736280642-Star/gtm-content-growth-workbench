import { NextRequest, NextResponse } from "next/server";
import type { ContentMonitorPlatform } from "@/lib/v5/content-monitor-contracts";
import { syncContentMonitorMetrics } from "@/lib/v5/content-monitor-service";

const platforms = new Set<ContentMonitorPlatform>(["wechat", "csdn", "juejin", "zhihu"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { platform?: string; platforms?: string[] };
    const platform = body.platform && platforms.has(body.platform as ContentMonitorPlatform) ? body.platform as ContentMonitorPlatform : undefined;
    const selectedPlatforms = body.platforms?.filter((item): item is ContentMonitorPlatform => platforms.has(item as ContentMonitorPlatform));
    const data = await syncContentMonitorMetrics(selectedPlatforms?.length ? selectedPlatforms : platform);
    return NextResponse.json({ ok: data.status !== "failed", data, message: data.message }, { status: data.status === "failed" ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "CONTENT_MONITOR_SYNC_FAILED", message: error instanceof Error ? error.message : "内容指标更新失败。" } }, { status: 500 });
  }
}
