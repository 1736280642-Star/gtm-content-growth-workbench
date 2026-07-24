import { NextRequest, NextResponse } from "next/server";
import { ArticleTypeServiceError, parseArticleTypeWriteRequest, supplementArticleTypeDraft } from "@/lib/v5/article-type-service";

export async function POST(request: NextRequest) {
  try {
    const data = await supplementArticleTypeDraft(parseArticleTypeWriteRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "ARTICLE_TYPE_SUPPLEMENT_FAILED", "AI 补充失败，请保留当前输入并重试。" );
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
