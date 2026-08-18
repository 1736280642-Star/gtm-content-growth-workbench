import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { getActiveProduct } from "@/lib/v5/product-registry-service";
import {
  enqueueProductSampleRevision,
  readProductSampleArticleDetail
} from "@/lib/v5/product-sample-article-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string; taskId: string }> }
) {
  const { productId, taskId } = await params;
  try {
    await getActiveProduct(productId);
    const data = await readProductSampleArticleDetail(productId, taskId);
    if (!data) {
      return NextResponse.json({ ok: false, error: { code: "sample_not_found", message: "没有找到这篇样文。" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; taskId: string }> }
) {
  const { productId, taskId } = await params;
  try {
    await getActiveProduct(productId);
    const current = await readProductSampleArticleDetail(productId, taskId);
    if (!current) {
      return NextResponse.json({ ok: false, error: { code: "sample_not_found", message: "没有找到这篇样文。" } }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const feedbackId = String(body.feedbackId || "").trim();
    if (!feedbackId) {
      return NextResponse.json({ ok: false, error: { code: "feedback_required", message: "缺少已保存的修改要求。" } }, { status: 400 });
    }
    const queued = await enqueueProductSampleRevision({ taskId, feedbackId, actor: getSingleArticleActor() });
    return NextResponse.json({ ok: true, data: queued.operation }, { status: 202 });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
