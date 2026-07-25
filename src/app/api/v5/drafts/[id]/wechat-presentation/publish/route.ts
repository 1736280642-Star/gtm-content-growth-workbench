import { NextResponse } from "next/server";
import { sendWechatsyncDraft } from "@/lib/wechatsync-client";
import { readFormalDraftVersion } from "@/lib/v5/single-article-production-repository";
import { getSingleArticleActor, singleArticleErrorResponse } from "@/lib/v5/single-article-api";
import { getPublishableWechatPresentation } from "@/lib/v5/wechat-presentation-service";
import { V5GovernanceRepositoryError } from "@/lib/v5/knowledge-governance-repository";
import { claimWechatPresentationPublish, completeWechatPresentationPublish } from "@/lib/v5/wechat-presentation-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const [draft, artifact] = await Promise.all([
      readFormalDraftVersion(params.id),
      getPublishableWechatPresentation(params.id)
    ]);
    if (!draft) throw new V5GovernanceRepositoryError("formal_draft_not_found", "正式正文不存在。", 404, "刷新批量生成中心后重试。");
    const actor = { ...getSingleArticleActor(), auditReason: "将已批准的公众号 HTML 写入公众号草稿箱" };
    const claim = await claimWechatPresentationPublish({ artifactId: artifact.artifactId, actor });
    if (!claim.claimed) {
      return NextResponse.json({ ok: true, replayed: true, data: { status: "draft_created", externalDraftId: claim.artifact.externalDraftId, draftUrl: claim.artifact.draftUrl }, message: "该版本已写入微信公众号草稿箱，本次未重复创建。" });
    }
    const result = await sendWechatsyncDraft({
      platform: "weixin",
      title: draft.title,
      contentFormat: "wechat_html",
      html: artifact.html!,
      coverUrl: artifact.coverImageRef
    });
    if (result.status !== "draft_created") {
      await completeWechatPresentationPublish({ artifactId: artifact.artifactId, status: "failed", error: result.message, actor });
      return NextResponse.json({ ok: false, error: { code: result.errorCode || "sync_failed", message: result.message, nextAction: "检查 bridge、公众号授权和封面素材配置后重试。" } }, { status: 502 });
    }
    await completeWechatPresentationPublish({ artifactId: artifact.artifactId, status: "draft_created", externalDraftId: result.externalDraftId, draftUrl: result.draftUrl, actor });
    return NextResponse.json({ ok: true, data: result, message: "已写入微信公众号草稿箱，请在公众号后台完成最终预览与发布。" });
  } catch (error) {
    return singleArticleErrorResponse(error);
  }
}
