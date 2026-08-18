import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { decideSampleArticle, readSampleArticleReviewState } from "@/lib/v5/sample-calibration-repository";
import type { SampleArticleFeedbackInput } from "@/lib/v5/sample-calibration-contracts";
import { enqueueProductSampleRevision } from "@/lib/v5/product-sample-article-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function reconcileGraphShadow(productId?: string) {
  if (!productId) return { status: "not_applicable" };
  try {
    const { reconcileProductGeoDomainShadowWorkflow } = await import("@/lib/v5/graph/product-geo-workflow-service");
    const run = await reconcileProductGeoDomainShadowWorkflow(productId);
    return { status: "observed", workflowId: run.id, workflowStatus: run.status };
  } catch (error) {
    // Sample approval remains committed even when the optional Shadow observer
    // is unavailable; deterministic production therefore has a clean bypass.
    return {
      status: "degraded",
      errorCode: error instanceof Error ? error.message : "graph_shadow_reconciliation_failed"
    };
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, data: await readSampleArticleReviewState(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return singleArticleErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const idempotencyKey = request.headers.get("x-idempotency-key") || "";
    const body = await request.json() as SampleArticleFeedbackInput;
    const actor = {
      ...getSingleArticleActor(),
      auditReason: body.decision === "changes_requested" ? "用户提交样文修改要求" : "用户确认样文内容质量"
    };
    const data = await decideSampleArticle({ draftVersionId: id, idempotencyKey, feedback: body, actor });
    let revision: Record<string, unknown> | undefined;
    if (body.decision === "changes_requested" && data.taskId) {
      try {
        const queued = await enqueueProductSampleRevision({
          taskId: data.taskId,
          feedbackId: data.feedbackId,
          actor
        });
        revision = {
          status: queued.operation.status,
          taskId: data.taskId,
          operationId: queued.operation.operationId,
          progressStage: queued.operation.progressStage
        };
      } catch (error) {
        revision = {
          status: "failed",
          message: error instanceof Error ? error.message : "修订稿生成失败。",
          nextAction: "修改要求已保存；处理生成前置条件后，在样文详情页重试。"
        };
      }
    }
    const graphShadow = await reconcileGraphShadow(data.productId);
    return NextResponse.json({ ok: true, data: { ...data, revision, graphShadow } });
  } catch (error) { return singleArticleErrorResponse(error); }
}
