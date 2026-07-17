import { NextResponse } from "next/server";
import { singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { readFormalDraftVersion } from "@/lib/v5/single-article-production-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const data = await readFormalDraftVersion(params.id);
    if (!data) {
      return NextResponse.json(
        { ok: false, error: { code: "formal_draft_not_found", message: "正式 DraftVersion 不存在。", nextAction: "返回批量生成中心刷新任务状态。" } },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
