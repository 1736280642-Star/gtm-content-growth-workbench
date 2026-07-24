import { NextRequest, NextResponse } from "next/server";
import { ArticleTypeServiceError, parseArticleTypeSupplementRequest, supplementArticleTypeProfile } from "@/lib/v5/article-type-service";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const data = await supplementArticleTypeProfile(params.id, parseArticleTypeSupplementRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "ARTICLE_TYPE_SUPPLEMENT_FAILED", "AI 补充失败，请保留当前输入并重试。" );
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
