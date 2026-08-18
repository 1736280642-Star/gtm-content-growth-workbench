import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import { getProductGeoStrategyPackView } from "@/lib/v5/product-strategy-pack-service";
import {
  enqueueProductSampleArticles,
  readProductSampleArticles
} from "@/lib/v5/product-sample-article-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  try {
    await getActiveProduct(productId);
    return NextResponse.json({
      ok: true,
      data: await readProductSampleArticles(productId) || null
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  try {
    await getActiveProduct(productId);
    const view = await getProductGeoStrategyPackView(productId);
    const strategy = view.currentStrategyPack;
    if (!strategy || !["strategy_approved", "pending_sample_review"].includes(strategy.status)) {
      return NextResponse.json({
        ok: false,
        error: {
          code: "product_strategy_not_ready",
          message: "产品策略尚未确认，不能生成质量验收样稿。",
          nextAction: "先在当前页面确认 GEO 策略和文章类型。"
        }
      }, { status: 409 });
    }
    const requestedKey = String(request.headers.get("x-idempotency-key") || "").trim();
    const queued = await enqueueProductSampleArticles({
      productId,
      strategyPackId: strategy.id,
      idempotencyKey: requestedKey || `product-samples:${strategy.id}:v2`,
      actor: getSingleArticleActor()
    });
    return NextResponse.json({
      ok: true,
      data: queued.map((item) => ({
        taskId: item.taskId,
        operationId: item.operation.operationId,
        status: item.operation.status,
        progressStage: item.operation.progressStage,
        title: item.title,
        articleTypeVersionId: item.articleTypeVersionId,
        articleTypeName: item.articleTypeName
      }))
    }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
