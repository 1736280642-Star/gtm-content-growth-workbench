import { NextRequest, NextResponse } from "next/server";
import {
  ArticleTypeServiceError,
  getArticleTypeProfile,
  parseArticleTypePatchRequest,
  patchArticleTypeProfile
} from "@/lib/v5/article-type-service";

function errorResponse(error: unknown) {
  const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "ARTICLE_TYPE_REQUEST_FAILED", "内容类型请求失败，请稍后重试。" );
  return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
}
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ ok: true, data: await getArticleTypeProfile(params.id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const data = await patchArticleTypeProfile(params.id, parseArticleTypePatchRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
