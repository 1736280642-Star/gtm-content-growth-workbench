import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { selectWechatTemplate } from "@/lib/v5/wechat-presentation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { templateId?: unknown; selectionReason?: unknown; idempotencyKey?: unknown };
    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    const selectionReason = typeof body.selectionReason === "string" ? body.selectionReason.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!templateId || !idempotencyKey) {
      return NextResponse.json({ ok: false, error: { code: "invalid_template_selection", message: "请选择模板后再确认。", nextAction: "刷新模板列表并重新选择。" } }, { status: 422 });
    }
    const actor = { ...getSingleArticleActor(), auditReason: "人工确认公众号排版模板" };
    const data = await selectWechatTemplate({ draftVersionId: params.id, templateId, selectionReason, idempotencyKey, actor });
    return NextResponse.json({ ok: true, data, message: "公众号排版模板已确认。" });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
