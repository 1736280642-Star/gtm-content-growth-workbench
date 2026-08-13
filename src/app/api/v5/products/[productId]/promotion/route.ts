import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { readTrustedServerActor } from "@/lib/v5/knowledge-governance-api";
import { updateProductPromotion } from "@/lib/v5/product-registry-service";
import { reconcilePromotedProductAutomation } from "@/lib/v5/product-automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const body = await _request.json().catch(() => ({}));
    if (typeof body.isPromoting !== "boolean") {
      return NextResponse.json({ ok: false, message: "isPromoting 必须是布尔值。" }, { status: 400 });
    }
    const actor = readTrustedServerActor("product_owner") || {
      actorId: "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason: body.isPromoting ? "用户在产品页开始推广" : "用户在产品页暂停推广"
    };
    const product = await updateProductPromotion({
      productId: routeParams.productId,
      isPromoting: body.isPromoting,
      actor
    });
    const automation = body.isPromoting
      ? await reconcilePromotedProductAutomation({ actor: { ...actor, actorType: "system", actorRole: "product_automation", auditReason: "产品开始推广后自动编译策略并创建复测任务" } })
      : undefined;
    return NextResponse.json({
      ok: true,
      productId: product.productId,
      isPromoting: product.isPromoting,
      promotionStatus: product.promotionStatus,
      automation,
      message: product.isPromoting ? "产品已开始推广" : "产品已暂停推广"
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
