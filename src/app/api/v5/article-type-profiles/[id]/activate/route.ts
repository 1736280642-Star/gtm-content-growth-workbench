import { NextRequest, NextResponse } from "next/server";
import { activateArticleTypeProfile, ArticleTypeServiceError, parseArticleTypeActivateRequest } from "@/lib/v5/article-type-service";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const data = await activateArticleTypeProfile(params.id, parseArticleTypeActivateRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "ARTICLE_TYPE_ACTIVATE_FAILED", "内容类型版本发布失败，请稍后重试。" );
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
