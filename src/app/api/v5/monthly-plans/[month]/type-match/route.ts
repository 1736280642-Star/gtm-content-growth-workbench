import { NextRequest, NextResponse } from "next/server";
import { ArticleTypeServiceError, parseQuestionTypeMatchRequest, runQuestionTypeMatch } from "@/lib/v5/article-type-service";

export async function POST(request: NextRequest, { params }: { params: { month: string } }) {
  try {
    const data = await runQuestionTypeMatch(params.month, parseQuestionTypeMatchRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "TYPE_MATCH_FAILED", "内容类型语义匹配失败，请保留当前选择并重试。" );
    return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
  }
}
