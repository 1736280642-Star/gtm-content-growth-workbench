import { NextRequest, NextResponse } from "next/server";
import { ArticleTypeServiceError, confirmQuestionTypeMatch, parseQuestionTypeMatchConfirmRequest } from "@/lib/v5/article-type-service";

export async function POST(request: NextRequest, { params }: { params: { month: string } }) {
  try {
    const data = await confirmQuestionTypeMatch(params.month, parseQuestionTypeMatchConfirmRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "TYPE_MATCH_CONFIRM_FAILED", "内容类型匹配确认失败，请稍后重试。" );
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
