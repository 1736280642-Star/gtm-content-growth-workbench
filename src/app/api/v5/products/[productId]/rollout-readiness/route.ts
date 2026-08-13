import { NextResponse } from "next/server";
import type { DirectPublishPlatformKey } from "@/lib/types";
import { getProductRolloutReadiness } from "@/lib/v5/product-rollout-readiness-service";

const platforms = new Set<DirectPublishPlatformKey>(["wechat", "juejin", "csdn", "zhihu"]);

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const platform = new URL(request.url).searchParams.get("platform") as DirectPublishPlatformKey | null;
    if (!platform || !platforms.has(platform)) {
      return NextResponse.json({ ok: false, code: "invalid_platform", message: "platform 必须是 wechat、juejin、csdn 或 zhihu。" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, data: await getProductRolloutReadiness(productId, platform) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "rollout_readiness_failed", message: error instanceof Error ? error.message : "发布准入检查失败。" }, { status: 500 });
  }
}
