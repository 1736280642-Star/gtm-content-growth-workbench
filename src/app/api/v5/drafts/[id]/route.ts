import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { createEditedFormalDraftVersion, readFormalDraftVersion } from "@/lib/v5/single-article-production-repository";
import { readWechatPresentationDraftContext } from "@/lib/v5/wechat-presentation-repository";
import { resolveWechatPlatformKey } from "@/lib/v5/wechat-presentation-contracts";

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
    const presentationContext = await readWechatPresentationDraftContext(params.id);
    return NextResponse.json({
      ok: true,
      data: { ...data, platformKey: resolveWechatPlatformKey(presentationContext.channel) }
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { markdown?: unknown; auditReason?: unknown };
    const markdown = typeof body.markdown === "string" ? body.markdown.trim() : "";
    const auditReason = typeof body.auditReason === "string" ? body.auditReason.trim() : "";
    if (markdown.length < 100 || markdown.length > 200000) {
      return NextResponse.json({ ok: false, error: { code: "invalid_draft_markdown", message: "正文长度必须在 100 到 200000 个字符之间。", nextAction: "补充正文或缩短后再保存。" } }, { status: 422 });
    }
    if (!auditReason || auditReason.length > 200) {
      return NextResponse.json({ ok: false, error: { code: "invalid_audit_reason", message: "请填写 200 个字符以内的编辑原因。", nextAction: "填写编辑原因后重新保存。" } }, { status: 422 });
    }
    const actor = { ...getSingleArticleActor(), auditReason };
    const data = await createEditedFormalDraftVersion({ draftVersionId: params.id, markdown, actor });
    return NextResponse.json({ ok: true, data, status: "checking", message: "编辑已保存，系统将在后台自动复检；最后一份可用正文保持不变。" });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
