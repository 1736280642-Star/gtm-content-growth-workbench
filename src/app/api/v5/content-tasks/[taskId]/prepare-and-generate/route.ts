import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { prepareAndGenerateSingleArticle } from "@/lib/v5/single-article-production-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const idempotencyKey = String(request.headers.get("x-idempotency-key") || "").trim();
    const data = await prepareAndGenerateSingleArticle({ taskId: params.taskId, idempotencyKey, actor: getSingleArticleActor() });
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
