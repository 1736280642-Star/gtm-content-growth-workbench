import type { FreeProductionBatch, FreeProductionTask } from "../../v5/free-production-contracts";
import type { FreeProductionState } from "../../v5/free-production-repository";
import { DEMO_MONTH } from "../config";

const now = `${DEMO_MONTH}-15T08:00:00.000Z`;

function batches(): Record<string, FreeProductionBatch> {
  const batch: FreeProductionBatch = {
    id: "fp-batch-001",
    monthlyPlanId: `mp-${DEMO_MONTH}`,
    monthStart: `${DEMO_MONTH}-01`,
    monthEnd: `${DEMO_MONTH}-31`,
    productId: "workbuddy",
    productName: "JOTO WorkBuddy",
    productExpressionRulePackageVersionId: "rp-workbuddy-v2",
    knowledgeSnapshotIds: ["kb-workbuddy-001"],
    freeContentExpressionTypeVersionId: "free-type-product_release-v1",
    sourceMode: "knowledge",
    expressionFocus: "WorkBuddy 智能工作台的企业级交付与治理能力",
    factItems: [],
    sourceExcerpts: [
      {
        id: "ex-001",
        sourceType: "knowledge",
        excerpt: "WorkBuddy 的价值应放在企业级交付、长期运维与 AI 应用治理的完整链路里理解。",
        sourceSnapshotId: "kb-workbuddy-001",
        sourceName: "WorkBuddy 产品知识库"
      }
    ],
    supplementalMaterialRefs: [],
    riskAndGapSummary: { ready: 0, needsInput: 0, needsApproval: 0, warning: 0, blocked: 0 },
    channelConfig: {
      channel: "wechat_official_account",
      channelRuleVersionId: "crv-wechat-v1",
      ctaType: "了解 WorkBuddy 企业级方案",
      requiredPublishAssetKeys: []
    },
    publishPolicy: "automatic_after_confirmation",
    status: "published",
    repairCount: 0,
    risks: [],
    expressionPlans: [],
    inputSnapshots: [],
    draftArtifacts: [],
    publishedAt: `${DEMO_MONTH}-17 11:00`,
    publishedUrl: "https://mp.weixin.qq.com/s/WorkBuddy-free-demo-001",
    idempotencyKey: "fp-idem-001",
    createdBy: "demo@joto.ai",
    createdAt: now,
    updatedAt: now,
    version: 2
  };
  return { [batch.id]: batch };
}

function tasks(): Record<string, FreeProductionTask> {
  const task: FreeProductionTask = {
    id: "fp-task-001",
    batchId: "fp-batch-001",
    monthlyPlanId: `mp-${DEMO_MONTH}`,
    planningSource: "free_production",
    freeContentExpressionTypeVersionId: "free-type-product_release-v1",
    channel: "wechat_official_account",
    status: "published",
    title: "WorkBuddy 智能工作台：把企业 AI 落地的最后一公里走通",
    publishedAt: `${DEMO_MONTH}-17 11:00`,
    publishedUrl: "https://mp.weixin.qq.com/s/WorkBuddy-free-demo-001",
    createdAt: now,
    updatedAt: now
  };
  return { [task.id]: task };
}

export const demoFreeProductionSeed: FreeProductionState = {
  schemaVersion: 1,
  batches: batches(),
  tasks: tasks(),
  audits: [],
  idempotency: {}
};
