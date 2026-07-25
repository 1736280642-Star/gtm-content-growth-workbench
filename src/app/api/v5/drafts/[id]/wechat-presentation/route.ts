import { NextResponse } from "next/server";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import {
  decideWechatPresentation,
  generateWechatPresentation,
  getWechatPresentationState
} from "@/lib/v5/wechat-presentation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const data = await getWechatPresentationState(params.id);
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({})) as { approvedImageRoles?: unknown; coverImageRef?: unknown; auditReason?: unknown };
    const actor = {
      ...getSingleArticleActor(),
      auditReason: typeof body.auditReason === "string" && body.auditReason.trim() ? body.auditReason.trim().slice(0, 200) : "基于人工所选模板生成公众号图文预览"
    };
    const data = await generateWechatPresentation({ draftVersionId: params.id, approvedImageRoles: body.approvedImageRoles, coverImageRef: body.coverImageRef, actor });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { artifactId?: unknown; decision?: unknown; reason?: unknown };
    const artifactId = typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!artifactId || !decision || (decision === "rejected" && !reason)) {
      return NextResponse.json({ ok: false, error: { code: "invalid_review", message: "审核决定无效；退回时必须填写问题。", nextAction: "确认最终呈现可发布，或填写具体问题后退回。" } }, { status: 422 });
    }
    const actor = { ...getSingleArticleActor(), auditReason: reason || "人工确认公众号最终呈现可发布" };
    const data = await decideWechatPresentation({ draftVersionId: params.id, artifactId, decision, reason, actor });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
