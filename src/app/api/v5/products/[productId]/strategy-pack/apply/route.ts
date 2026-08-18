import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import { readTrustedServerActor } from "@/lib/v5/knowledge-governance-api";
import { decideProductGeoStrategyPack } from "@/lib/v5/product-strategy-pack-service";
import type { ProductGeoStrategyDecision } from "@/lib/v5/product-strategy-pack-contracts";
import { getSingleArticleActor } from "@/lib/v5/single-article-api";
import { enqueueProductSampleArticles } from "@/lib/v5/product-sample-article-service";

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
    let samples: Array<Record<string, unknown>> | undefined;
    if (decision === "approve") {
      try {
        const queued = await enqueueProductSampleArticles({
          productId: product.productId,
          strategyPackId: result.strategyPackId,
          idempotencyKey: `product-samples:${result.strategyPackId}:v2`,
          actor: getSingleArticleActor()
        });
        samples = queued.map((item) => ({
          status: item.operation.status,
          taskId: item.taskId,
          operationId: item.operation.operationId,
          progressStage: item.operation.progressStage,
          title: item.title,
          articleTypeVersionId: item.articleTypeVersionId,
          articleTypeName: item.articleTypeName
        }));
      } catch (sampleError) {
        samples = [{
          status: "failed",
          error: {
            code: "product_sample_queue_failed",
            message: sampleError instanceof Error ? sampleError.message : "策略已确认，但样文任务创建失败。",
            nextAction: "检查样文生产前置条件后，在样文验收页重新提交任务。"
          }
        }];
      }
    }
    const graphShadow = await reconcileGraphShadow(product.productId);
    return NextResponse.json({
      ok: true,
      ...result,
      samples,
      graphShadow,
      message: decision === "approve"
        ? samples?.some((item) => item.status === "queued" || item.status === "running")
          ? `产品 GEO 策略已确认，${samples.length} 篇代表样文已提交`
          : "产品 GEO 策略已确认，样文任务等待恢复"
        : "产品 GEO 策略已拒绝"
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
