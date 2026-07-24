import { NextRequest, NextResponse } from "next/server";
import {
  ArticleTypeServiceError,
  createArticleTypeProfile,
  listArticleTypeProfiles,
  parseArticleTypeWriteRequest
} from "@/lib/v5/article-type-service";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const detail = error instanceof ArticleTypeServiceError ? error : new ArticleTypeServiceError(500, "ARTICLE_TYPE_REQUEST_FAILED", "内容类型请求失败，请稍后重试。" );
  return NextResponse.json({ ok: false, error: { code: detail.code, message: detail.message, details: detail.details } }, { status: detail.status });
}
export async function GET(request: NextRequest) {
  try {
    const data = await listArticleTypeProfiles({ status: request.nextUrl.searchParams.get("status") || undefined, search: request.nextUrl.searchParams.get("search") || undefined });
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await createArticleTypeProfile(parseArticleTypeWriteRequest(await request.json()), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
