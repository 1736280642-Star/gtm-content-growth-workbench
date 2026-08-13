import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import { readTrustedServerActor } from "@/lib/v5/knowledge-governance-api";
import { decideProductGeoStrategyPack } from "@/lib/v5/product-strategy-pack-service";
import type { ProductGeoStrategyDecision } from "@/lib/v5/product-strategy-pack-contracts";
import { getSingleArticleActor } from "@/lib/v5/single-article-api";
import { generateProductSampleArticle } from "@/lib/v5/product-sample-article-service";
import { SingleArticleProductionError } from "@/lib/v5/single-article-production-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function reconcileGraphShadow(productId: string) {
  try {
    const { reconcileProductGeoDomainShadowWorkflow } = await import("@/lib/v5/graph/product-geo-workflow-service");
    const run = await reconcileProductGeoDomainShadowWorkflow(productId);
    return { status: "observed", workflowId: run.id, workflowStatus: run.status };
  } catch (error) {
    // Shadow is deliberately non-authoritative: a Graph failure must never roll
    // back or mask the formal strategy decision and sample generation result.
    return {
      status: "degraded",
      errorCode: error instanceof Error ? error.message : "graph_shadow_reconciliation_failed"
    };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const product = await getActiveProduct(routeParams.productId);
    const body = await request.json().catch(() => ({}));
    const decision: ProductGeoStrategyDecision | undefined = body.decision === "approve" || body.decision === "reject"
      ? body.decision
      : typeof body.approved === "boolean"
        ? body.approved ? "approve" : "reject"
        : undefined;
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || body.idempotencyKey || "").trim();
    if (!decision || typeof body.strategyPackId !== "string" || !body.strategyPackId.trim()
      || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || !idempotencyKey) {
      return NextResponse.json(
        { ok: false, message: "strategyPackId、decision、expectedVersion 和 x-idempotency-key 为必填项。" },
        { status: 400 }
      );
    }
    const selectedPortfolioItemIds = Array.isArray(body.selectedPortfolioItemIds)
      ? body.selectedPortfolioItemIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;
    const fixedExpression = body.fixedExpression && typeof body.fixedExpression === "object"
      ? {
          text: typeof body.fixedExpression.text === "string" ? body.fixedExpression.text.trim() : "",
          positions: Array.isArray(body.fixedExpression.positions) ? body.fixedExpression.positions : [],
          channels: Array.isArray(body.fixedExpression.channels) ? body.fixedExpression.channels : []
        }
      : undefined;
    const auditReason = typeof body.auditReason === "string" && body.auditReason.trim()
      ? body.auditReason.trim()
      : decision === "approve" ? "用户确认产品 GEO 策略包" : "用户拒绝产品 GEO 策略包";
    const trustedActor = readTrustedServerActor("product_owner");
    const actor = trustedActor ? { ...trustedActor, auditReason } : {
      actorId: "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason
    };
    const result = await decideProductGeoStrategyPack({
      productId: product.productId,
      strategyPackId: body.strategyPackId.trim(),
      decision,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
      selectedPortfolioItemIds,
      fixedExpression: decision === "approve" && fixedExpression?.text ? fixedExpression : undefined,
      actor
    });
    let sample: Record<string, unknown> | undefined;
    if (decision === "approve") {
      try {
        const generated = await generateProductSampleArticle({
          productId: product.productId,
          strategyPackId: result.strategyPackId,
          idempotencyKey: `product-sample:${result.strategyPackId}:v1`,
          actor: getSingleArticleActor()
        });
        sample = {
          status: "generated",
          taskId: generated.taskId,
          draftVersionId: generated.result.draftVersion.draftVersionId,
          title: generated.result.draftVersion.title
        };
      } catch (sampleError) {
        sample = {
          status: "failed",
          error: sampleError instanceof SingleArticleProductionError ? {
            code: sampleError.code,
            message: sampleError.message,
            nextAction: sampleError.nextAction,
            details: sampleError.details
          } : {
            code: "product_sample_generation_failed",
            message: sampleError instanceof Error ? sampleError.message : "策略已确认，但示例正文生成失败。",
            nextAction: "检查样稿生产前置条件后，在策略页重试生成。"
          }
        };
      }
    }
    const graphShadow = await reconcileGraphShadow(product.productId);
    return NextResponse.json({
      ok: true,
      ...result,
      sample,
      graphShadow,
      message: decision === "approve"
        ? sample?.status === "generated" ? "产品 GEO 策略已确认，示例正文已生成" : "产品 GEO 策略已确认，示例正文等待恢复"
        : "产品 GEO 策略已拒绝"
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
