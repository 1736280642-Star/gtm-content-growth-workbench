import { NextResponse } from "next/server";
import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { confirmProductPublishAccountBinding } from "@/lib/v5/product-rollout-readiness-service";
import type { DirectPublishPlatformKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const supportedPlatforms = new Set<DirectPublishPlatformKey>(["wechat", "zhihu", "juejin", "csdn"]);

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const platform = String(body.platform || "") as DirectPublishPlatformKey;
    const accountLabel = String(body.accountLabel || "").trim();
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || body.idempotencyKey || "").trim();
    if (!supportedPlatforms.has(platform) || !accountLabel || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || !idempotencyKey) {
      return NextResponse.json({ ok: false, message: "platform、accountLabel、expectedVersion 和 idempotencyKey 为必填项。" }, { status: 400 });
    }
    const actor = readTrustedServerActor("product_owner") || {
      actorId: "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason: "用户确认当前产品使用指定平台发布账号"
    };
    const data = await confirmProductPublishAccountBinding({
      productId,
      platform,
      accountLabel,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
      actor: { ...actor, auditReason: "用户确认当前产品使用指定平台发布账号" }
    });
    return NextResponse.json({ ok: true, data, message: "产品发布账号已确认。" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
