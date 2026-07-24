import { NextResponse } from "next/server";
import { singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { getWechatTemplateWorkspace } from "@/lib/v5/wechat-presentation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const data = await getWechatTemplateWorkspace(params.id);
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
