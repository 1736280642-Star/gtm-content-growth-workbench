import { randomUUID } from "node:crypto";
import type { ExpressionPlan, FreeContentExpressionTypeVersion, VisualMaterialSuggestion } from "./free-production-contracts";

const positioning: Record<FreeContentExpressionTypeVersion["presetKey"], { angle: string; positioning: string; pain: string; claim: string }> = {
  product_release: { angle: "真实工作流中的产品价值", positioning: "从业务痛点进入产品定位与流程变化", pain: "重复动作消耗专业人员时间且难以稳定交付", claim: "AI 接手重复动作后，人可以把判断力放回关键决策" },
  scenario_solution: { angle: "具体任务的前后变化", positioning: "从高压现场展开解决方案与结果证据", pain: "复杂任务依赖大量机械操作，时间紧且容易遗漏", claim: "可控的 AI 助手能够接手重复步骤，同时保留人工确认" },
  strategic_partnership: { angle: "可核验的合作事实与长期价值", positioning: "以合作动作、范围和互补能力建立可信叙事", pain: "企业需要清晰理解合作边界与可交付价值", claim: "明确分工与能力互补是合作产生长期价值的前提" },
  event_recap: { angle: "活动观点的业务含义", positioning: "从活动事实提炼可复用判断与案例证据", pain: "活动信息容易停留在现场，难以沉淀为行动依据", claim: "观点只有连接真实案例和工作流才具备复用价值" },
  industry_insight: { angle: "行业变化背后的工作流命题", positioning: "先建立行业判断，再引出产品回应", pain: "企业容易追逐技术概念，却没有识别真正需要改变的流程", claim: "技术价值取决于它能否进入真实工作流并接受人的控制" }
};

function visualPlan(expression: FreeContentExpressionTypeVersion): VisualMaterialSuggestion[] {
  if (expression.visualSuggestionMode === "off") return [];
  const assetType = expression.presetKey === "event_recap" ? "event_photo" : expression.presetKey === "product_release" ? "product_screenshot" : "workflow_comparison";
  return [{
    id: `visual-${randomUUID()}`,
    placementAnchor: expression.structureModules[Math.min(3, expression.structureModules.length - 1)],
    assetType,
    recommendation: expression.presetKey === "event_recap" ? "使用可公开的活动现场照片" : "展示旧流程与新流程的关键动作对比",
    captionSuggestion: expression.presetKey === "event_recap" ? "活动现场与核心议题" : "AI 接手重复动作前后的工作流变化",
    purpose: "帮助读者快速理解文章中的流程或场景变化",
    optional: true
  }];
}

export function compileExpressionPlan(input: { batchId: string; expression: FreeContentExpressionTypeVersion; knowledgeSnapshots: Array<Record<string, unknown>>; supplementalFacts?: Record<string, string>; previousPlan?: ExpressionPlan }): ExpressionPlan {
  const basis = positioning[input.expression.presetKey];
  const version = (input.previousPlan?.version || 0) + 1;
  const supplements = Object.values(input.supplementalFacts || {}).filter(Boolean);
  return {
    id: `expression-plan-${randomUUID()}`,
    batchId: input.batchId,
    channel: input.expression.channelBinding.channel,
    contentAngle: basis.angle,
    contentPositioning: basis.positioning,
    audienceLensKey: input.expression.audienceLensPolicy,
    corePain: basis.pain,
    articleClaim: supplements.length ? `${basis.claim}。本次补充依据：${supplements.join("；")}` : basis.claim,
    titleStrategyKey: input.expression.defaultTitleStrategyKey,
    titleCandidates: [],
    outline: input.expression.structureModules.map((sectionKey) => ({ sectionKey, purpose: `完成 ${sectionKey} 模块的表达职责` })),
    evidenceMap: input.expression.structureModules.map((sectionKey, index) => ({ sectionKey, knowledgeSnapshotId: input.expression.knowledgeSnapshotIds[index % Math.max(1, input.expression.knowledgeSnapshotIds.length)] || "", evidenceSummary: String(input.knowledgeSnapshots[index % Math.max(1, input.knowledgeSnapshots.length)]?.name || "产品知识快照") })),
    missingClaims: input.expression.requiredInputSchema.map((item) => item.key).filter((key) => !input.supplementalFacts?.[key]),
    visualMaterialPlan: visualPlan(input.expression),
    expectedCta: input.expression.channelBinding.ctaType,
    status: input.expression.requiredInputSchema.some((item) => !input.supplementalFacts?.[item.key]) ? "needs_input" : "compiled",
    createdAt: new Date().toISOString(),
    version
  };
}
