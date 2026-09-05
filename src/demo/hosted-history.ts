import { publishingResultContent, sampleResultContent, strategyResultContent } from "@/lib/v5/hosted-history-projection";
import type { HostedHistoryStep, HostedResultContent, HostedResultSnapshot } from "@/lib/v5/hosted-history-contracts";
import type { DemoState, DemoOrder } from "./model";
import { orderBatches } from "./hosted-results";

export function demoStepContent(state: DemoState, order: DemoOrder, step: HostedHistoryStep): HostedResultContent {
  const pack = state.strategies[order.productId], plan = pack.contentPlan;
  if (step === "publishing") return publishingResultContent(orderBatches(state, order)[0]);
  if (step === "research" || step === "strategy") return strategyResultContent({
    sourceId: pack.id || `strategy-${order.productId}`, sourceVersion: `策略 V${pack.strategyVersion || 1} · 修订 ${pack.rowVersion}`,
    materials: step === "research" ? order.materialSummary : undefined,
    summary: { coreExpressions: plan.coreExpressions, automaticStrategy: { ...plan.productPositioning, keyMessages: plan.expressionDirection.keyMessages, channels: order.channels.map(c => c.channel), articleDirections: plan.articleTypePortfolio.map((item: { name: string; definition: string }) => ({ name: item.name, direction: item.definition })) } }
  });
  const task = state.tasks.find(item => state.taskOrders[item.taskId] === order.orderId);
  const draft = task?.formalDraftId ? state.drafts[task.formalDraftId] : undefined;
  return sampleResultContent({ sourceId: task?.formalDraftId || task!.taskId, sourceVersion: `样文 V${draft?.version || 1}`,
    title: task!.title, markdown: task!.currentDraft?.markdown || draft?.markdown || "", articleTypeName: task!.articleTypeNameSnapshot || "场景解读", channel: task!.channel });
}
export function archiveDemoStep(state: DemoState, order: DemoOrder, step: HostedHistoryStep, key: string, extra: Pick<HostedResultSnapshot, "decision" | "comment"> = {}, baseline = false) {
  const history = state.hostedHistory ||= [];
  const resultId = `${order.orderId}:${key}`;
  if (history.some(item => item.resultId === resultId)) return;
  const content = demoStepContent(state, order, step);
  if (step === "publishing") content.sourceVersion = `批次 V${history.filter(item => item.orderId === order.orderId && item.step === step).length + 1}`;
  history.unshift(structuredClone({ ...content, ...extra, resultId, orderId: order.orderId, step,
    createdAt: baseline ? new Date().toISOString() : new Date(new Date(state.now).getTime() + history.length * 1000).toISOString(),
    summary: baseline ? `旧演示数据升级时补存的当前可见版本；此前历史未保存。${content.summary}` : content.summary }));
}
export function captureDemoPublishing(state: DemoState) {
  for (const order of state.orders) {
    if (!["running", "completed", "action_required", "paused"].includes(order.status)) continue;
    const content = demoStepContent(state, order, "publishing");
    const previous = state.hostedHistory?.find(item => item.orderId === order.orderId && item.step === "publishing");
    if (previous && JSON.stringify(previous.publications) === JSON.stringify(content.publications)) continue;
    archiveDemoStep(state, order, "publishing", `batch-${state.revision}-${state.hostedHistory?.length || 0}`);
  }
}
/** Additive migration: retain existing edits; never reset the user's browser state. */
export function initializeDemoHistory(state: DemoState, baseline = false) {
  if (state.hostedHistory) return state;
  state.hostedHistory = [];
  for (const order of state.orders) {
    archiveDemoStep(state, order, "research", "initial-research", {}, baseline);
    const afterStrategy = ["generating_sample", "pending_sample_review", "running", "completed", "paused"].includes(order.status) || (order.status === "action_required" && order.lastError?.code === "evidence_missing");
    if (!afterStrategy) continue;
    // Legacy upgrades cannot reconstruct a past confirmation: only authored scenarios seed decisions.
    archiveDemoStep(state, order, "strategy", "initial-strategy", baseline ? {} : { decision: "approve", comment: "虚拟场景中已确认核心表达及推广方向。" }, baseline);
    if (order.status === "generating_sample") continue;
    archiveDemoStep(state, order, "sample-generation", "initial-sample", {}, baseline);
    if (order.status === "pending_sample_review") continue;
    archiveDemoStep(state, order, "sample-review", "initial-sample-review", baseline ? {} : { decision: "approve", comment: "虚拟场景中已确认正文、事实边界与渠道格式。" }, baseline);
    archiveDemoStep(state, order, "publishing", "initial-publishing", {}, baseline);
  }
  return state;
}
