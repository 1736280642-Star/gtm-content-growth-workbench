import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { WechatVisualPlanView, WechatVisualStyleRoute } from "@/lib/v5/wechat-visual-contracts";
import { CC2IMAGE_BASELINE_COMMIT, WECHAT_VISUAL_PLAN_VERSION, WECHAT_VISUAL_PROMPT_VERSION } from "@/lib/v5/wechat-visual-contracts";
export function makeVisualPlan(batch: FreeProductionBatch, now: string): WechatVisualPlanView {
    const artifact = batch.draftArtifacts.find(item => item.id === batch.currentDraftArtifactId)!;
    const routes: WechatVisualStyleRoute[] = [
        { routeKey: "brand", routeName: "产品与结果", styleId: "demo-brand", styleName: "产品信息卡", recommendation: "把产品身份和可检查结果放在首屏。", visualIntent: "品牌识别" },
        { routeKey: "system", routeName: "完整操作流程", styleId: "demo-system", styleName: "流程示意图", recommendation: "显示输入、确认、生成和结果之间的关系。", visualIntent: "解释工作过程" },
        { routeKey: "hook", routeName: "从问题切入", styleId: "demo-hook", styleName: "问题标题卡", recommendation: "用用户问题引入正文，保留人工确认点。", visualIntent: "引导阅读" },
    ];
    const planId = `visual-${batch.id}-${artifact.id}`;
    return {
        schemaVersion: WECHAT_VISUAL_PLAN_VERSION, planId, batchId: batch.id, productId: batch.productId,
        artifactId: artifact.id, sourceContentHash: artifact.contentDigest, articleTitle: artifact.selectedTitle,
        articleSummary: artifact.summary, targetAudience: "运营与内容团队", coreJudgment: "用可追溯的流程连接输入与结果。",
        routes, anchors: [{ anchorId: "demo-anchor", sectionKey: "section-1", sectionHeading: "从输入到结果", coreIdea: "关键节点保留人工确认", visualType: "workflow", placementReason: "帮助读者理解先后关系" }],
        candidates: routes.map((route, index) => ({ candidateId: `${planId}-${index}`, planId, role: "cover", variantIndex: (index + 1) as 1 | 2 | 3, route, status: "ready", promptHash: "synthetic-visual", provider: "demo", model: "locally-authored-assets", contentUrl: `/demo-assets/${["cover", "workflow", "question"][index]}.svg`, createdAt: now, updatedAt: now })),
        status: "cover_selection", promptVersion: WECHAT_VISUAL_PROMPT_VERSION, cc2imageCommit: CC2IMAGE_BASELINE_COMMIT,
        providerStatus: "ready", providerMissingConfig: [], createdBy: "demo-user", createdAt: now, updatedAt: now, version: 1,
    };
}
