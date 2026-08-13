import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import { getProductGeoStrategyPackView, amendApprovedProductStrategyFixedExpression } from "@/lib/v5/product-strategy-pack-service";
import { readTrustedServerActor } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const product = await getActiveProduct(routeParams.productId);
    const view = await getProductGeoStrategyPackView(product.productId);
    return NextResponse.json({
      ok: true,
      productId: product.productId,
      latestStrategyPack: view.latestStrategyPack || null,
      currentStrategyPack: view.currentStrategyPack || null,
      latestArticleTypeVersions: view.latestArticleTypeVersions,
      currentArticleTypeVersions: view.currentArticleTypeVersions,
      strategyPack: view.currentStrategyPack || null
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const product = await getActiveProduct(routeParams.productId);
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    if (typeof body.strategyPackId !== "string" || !body.strategyPackId.trim()
      || !Number.isInteger(body.expectedVersion) || !idempotencyKey
      || !body.fixedExpression || typeof body.fixedExpression !== "object") {
      return NextResponse.json({ ok: false, message: "strategyPackId、expectedVersion、fixedExpression 和 x-idempotency-key 为必填项。" }, { status: 400 });
    }
    const trustedActor = readTrustedServerActor("product_owner");
    const actor = trustedActor ? { ...trustedActor, auditReason: "用户在样稿生成前补录逐字固定表达" } : {
      actorId: "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason: "用户在样稿生成前补录逐字固定表达"
    };
    const result = await amendApprovedProductStrategyFixedExpression({
      productId: product.productId,
      strategyPackId: body.strategyPackId.trim(),
      expectedVersion: body.expectedVersion,
      idempotencyKey,
      fixedExpression: {
        text: typeof body.fixedExpression.text === "string" ? body.fixedExpression.text.trim() : "",
        positions: Array.isArray(body.fixedExpression.positions) ? body.fixedExpression.positions : [],
        channels: Array.isArray(body.fixedExpression.channels) ? body.fixedExpression.channels : []
      },
      actor
    });
    return NextResponse.json({ ok: true, strategyPack: result.pack, replayed: result.replayed, message: "固定文案已保存，可以生成示例正文。" });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
