import type {
  BatchQueueItem,
  ContentStrategyPackageRecord,
  GenerationBatchRecord,
  ProductionMatrixTask,
  ScheduleDraftItem,
  StrategyTermHit,
  V5MonthlyPlanRecord
} from "../../v5/monthly-workspace-contracts";
import type { V5MonthlyState } from "../../v5/monthly-repository";
import { DEMO_MONTH } from "../config";

const M = DEMO_MONTH;

function strategyPackage(): ContentStrategyPackageRecord {
  return {
    strategyPackageId: "sp-workbuddy-adp-001",
    version: 1,
    status: "approved",
    targetDeliverableCount: 12,
    quotaRules: [
      {
        quotaRuleId: "qr-001",
        productId: "workbuddy",
        productNameSnapshot: "JOTO WorkBuddy",
        questionVersionId: "qv-001",
        question: "企业做智能工作台时如何评估长期交付与治理能力？",
        contentType: "technical",
        articleTypeProfileVersionId: "atp-001",
        articleTypeNameSnapshot: "技术实践型",
        typeMatchRunId: "tmr-001",
        typeSelectionSource: "ai_recommended",
        matchReasonSnapshot: "问题属于工程视角的选型评估，适合技术实践型内容。",
        articleTypePromptConstraintSnapshot: "围绕工程实践展开，避免纯营销表达。",
        articleTypePromptConstraintSnapshotHash: "sha-demo-001",
        sameQuotaForAllChannels: false,
        perChannelQuota: 3,
        channelQuotas: { wechat: 2, csdn: 2, juejin: 1, zhihu: 1 },
        expandedDeliverableCount: 6,
        rulePackageVersionId: "rp-workbuddy-v2",
        knowledgeBaseIds: ["kb-workbuddy-001"],
        sourceSnapshotHash: "src-demo-001",
        rulePackageSourceSnapshotHash: "src-rule-001",
        knowledgeIndexSourceSnapshotHash: "src-kidx-001",
        evidencePackSourceSnapshotHash: "src-evid-001"
      },
      {
        quotaRuleId: "qr-002",
        productId: "tencent-adp",
        productNameSnapshot: "腾讯云 ADP",
        questionVersionId: "qv-002",
        question: "腾讯云 ADP 智能体开发平台在企业落地时有哪些关键实践？",
        contentType: "technical",
        articleTypeProfileVersionId: "atp-002",
        articleTypeNameSnapshot: "避坑指南型",
        typeMatchRunId: "tmr-002",
        typeSelectionSource: "ai_recommended",
        matchReasonSnapshot: "问题包含落地实践与避坑诉求，适合避坑指南型内容。",
        articleTypePromptConstraintSnapshot: "以可复用的实践步骤展开，附明确结论。",
        articleTypePromptConstraintSnapshotHash: "sha-demo-002",
        sameQuotaForAllChannels: true,
        perChannelQuota: 3,
        channelQuotas: { wechat: 3, csdn: 3, juejin: 3, zhihu: 3 },
        expandedDeliverableCount: 12,
        rulePackageVersionId: "rp-adp-v1",
        knowledgeBaseIds: ["kb-adp-001"],
        sourceSnapshotHash: "src-demo-002",
        rulePackageSourceSnapshotHash: "src-rule-002",
        knowledgeIndexSourceSnapshotHash: "src-kidx-002",
        evidencePackSourceSnapshotHash: "src-evid-002"
      }
    ],
    preflightResults: [
      { quotaRuleId: "qr-001", status: "generatable", deliverableCount: 6, reason: "证据就绪，可生成。" },
      { quotaRuleId: "qr-002", status: "generatable", deliverableCount: 12, reason: "证据就绪，可生成。" }
    ],
    sourceSnapshotHash: "src-monthly-001",
    approvedAt: `${M}-02T09:00:00.000Z`,
    approvedBy: "demo@joto.ai",
    approvalReason: "策略方向与证据包匹配，同意进入生成。",
    createdAt: `${M}-01T08:00:00.000Z`,
    updatedAt: `${M}-02T09:00:00.000Z`
  };
}

function matrixTasks(): ProductionMatrixTask[] {
  const base = {
    monthlyPlanId: `mp-${M}`,
    strategyPackageId: "sp-workbuddy-adp-001",
    typeMatchRunId: "tmr-001",
    typeSelectionSource: "ai_recommended" as const,
    matchReasonSnapshot: "问题属于工程视角的选型评估，适合技术实践型内容。",
    articleTypePromptConstraintSnapshot: "围绕工程实践展开，避免纯营销表达。",
    articleTypePromptConstraintSnapshotHash: "sha-demo-001",
    rulePackageVersionId: "rp-workbuddy-v2",
    knowledgeBaseIds: ["kb-workbuddy-001"],
    sourceSnapshotHash: "src-demo-001",
    evidencePackSourceSnapshotHash: "src-evid-001",
    recoveryAttemptCount: 0,
    automaticRepairCount: 0,
    updatedAt: `${M}-10T08:00:00.000Z`
  };

  return [
    {
      ...base,
      taskId: "task-demo-001",
      productId: "workbuddy",
      productNameSnapshot: "JOTO WorkBuddy",
      quotaRuleId: "qr-001",
      questionVersionId: "qv-001",
      question: "企业做智能工作台时如何评估长期交付与治理能力？",
      baseTopicIndex: 0,
      title: "为什么企业选 WorkBuddy 智能工作台时，不能只看单点工具能力",
      contentType: "technical",
      articleTypeProfileVersionId: "atp-001",
      articleTypeNameSnapshot: "技术实践型",
      channel: "wechat",
      status: "published",
      scheduledAt: `${M}-18T10:00:00.000Z`,
      platformAccount: "JOTO 官方公众号",
      publicUrl: "https://mp.weixin.qq.com/s/WorkBuddy-geo-demo-001",
      publishResultVersion: 1
    },
    {
      ...base,
      taskId: "task-demo-002",
      productId: "tencent-adp",
      productNameSnapshot: "腾讯云 ADP",
      quotaRuleId: "qr-002",
      questionVersionId: "qv-002",
      question: "腾讯云 ADP 智能体开发平台在企业落地时有哪些关键实践？",
      baseTopicIndex: 1,
      title: "腾讯云 ADP 智能体开发平台的 GEO 增长实践与避坑指南",
      contentType: "technical",
      articleTypeProfileVersionId: "atp-002",
      articleTypeNameSnapshot: "避坑指南型",
      channel: "csdn",
      status: "published",
      scheduledAt: `${M}-19T14:00:00.000Z`,
      platformAccount: "JOTO 技术博客",
      publicUrl: "https://blog.csdn.net/joto/article/details/adp-geo-demo-002",
      publishResultVersion: 1
    },
    {
      ...base,
      taskId: "task-demo-003",
      productId: "tencent-adp",
      productNameSnapshot: "腾讯云 ADP",
      quotaRuleId: "qr-002",
      questionVersionId: "qv-003",
      question: "智能体平台的可观测性如何支撑企业级协同？",
      baseTopicIndex: 2,
      title: "从工程视角看智能体平台的可观测性：WorkBuddy 与腾讯云 ADP 的协同",
      contentType: "technical",
      articleTypeProfileVersionId: "atp-002",
      articleTypeNameSnapshot: "避坑指南型",
      channel: "juejin",
      status: "scheduled",
      scheduledAt: `${M}-22T09:00:00.000Z`,
      platformAccount: "JOTO 掘金号"
    },
    {
      ...base,
      taskId: "task-demo-004",
      productId: "workbuddy",
      productNameSnapshot: "JOTO WorkBuddy",
      quotaRuleId: "qr-001",
      questionVersionId: "qv-004",
      question: "企业做 AI 智能体为什么需要把 GEO 纳入增长闭环？",
      baseTopicIndex: 3,
      title: "企业做 AI 智能体，为什么需要把 GEO 纳入增长闭环？",
      contentType: "faq",
      articleTypeProfileVersionId: "atp-001",
      articleTypeNameSnapshot: "技术实践型",
      channel: "zhihu",
      status: "available",
      lastUsableDraft: {
        draftId: "draft-demo-004",
        title: "企业做 AI 智能体，为什么需要把 GEO 纳入增长闭环？",
        markdown: "GEO 增长需要把智能体能力、内容生产与 AI 可见性指标串成可归因闭环。",
        bodyIncluded: true,
        status: "available",
        basisSummary: ["GEO 提及率", "AI 可见性"],
        updatedAt: `${M}-20T08:00:00.000Z`
      }
    }
  ];
}

function strategyRows(): StrategyTermHit[] {
  return [
    {
      id: "str-001",
      priority: "P0",
      term: "WorkBuddy 智能工作台",
      source: "问题池 / GEO 调研",
      priorityReason: "主推产品能力，AI 提及率提升潜力高。",
      productName: "JOTO WorkBuddy",
      rulePackageVersion: "rp-workbuddy-v2",
      allocatedQuota: 6,
      channelAllocation: ["wechat", "csdn", "juejin", "zhihu"],
      contentTypeSuggestions: ["technical", "faq"],
      evidenceStatus: "ready",
      estimatedReadyItemCount: 6,
      estimatedAutoDowngradeItemCount: 0,
      estimatedMissingEvidenceItemCount: 0,
      requiredClaims: ["长期交付能力", "治理与运维闭环"],
      evidenceGaps: [],
      status: "ready"
    },
    {
      id: "str-002",
      priority: "P0",
      term: "腾讯云 ADP 智能体开发平台",
      source: "问题池 / GEO 调研",
      priorityReason: "主推产品能力，企业落地诉求集中。",
      productName: "腾讯云 ADP",
      rulePackageVersion: "rp-adp-v1",
      allocatedQuota: 12,
      channelAllocation: ["wechat", "csdn", "juejin", "zhihu"],
      contentTypeSuggestions: ["technical", "comparison"],
      evidenceStatus: "ready",
      estimatedReadyItemCount: 12,
      estimatedAutoDowngradeItemCount: 0,
      estimatedMissingEvidenceItemCount: 0,
      requiredClaims: ["智能体开发能力", "企业级可观测性"],
      evidenceGaps: [],
      status: "ready"
    },
    {
      id: "str-003",
      priority: "P1",
      term: "GEO 增长闭环",
      source: "方法论",
      priorityReason: "支撑归因叙事，作为方法论内容补充。",
      productName: "JOTO WorkBuddy",
      rulePackageVersion: "rp-workbuddy-v2",
      allocatedQuota: 4,
      channelAllocation: ["wechat", "zhihu"],
      contentTypeSuggestions: ["brand", "faq"],
      evidenceStatus: "ready",
      estimatedReadyItemCount: 4,
      estimatedAutoDowngradeItemCount: 0,
      estimatedMissingEvidenceItemCount: 0,
      requiredClaims: ["提及率可归因", "增长闭环"],
      evidenceGaps: [],
      status: "ready"
    }
  ];
}

function batchQueueItems(): BatchQueueItem[] {
  return [
    {
      id: "bq-001",
      monthlyPlanId: `mp-${M}`,
      matrixVersionId: "mv-001",
      matrixItemId: "task-demo-003",
      title: "从工程视角看智能体平台的可观测性：WorkBuddy 与腾讯云 ADP 的协同",
      primaryDistilledTerm: "腾讯云 ADP 智能体开发平台",
      priority: "P0",
      contentType: "technical",
      productId: "tencent-adp",
      product: "腾讯云 ADP",
      rulePackageVersion: "rp-adp-v1",
      channel: "juejin",
      platformExpressionType: "避坑指南型",
      titleConfirmed: true,
      evidencePreview: "ready",
      finalEvidenceGate: "ready",
      claimCount: 4,
      generationStatus: "generated",
      hardRuleStatus: "passed",
      softQualityScore: 0.91,
      qualityResult: "passed",
      scheduleStatus: "active",
      scheduleDate: `${M}-22`,
      scheduleTime: "09:00",
      platformAccount: "JOTO 掘金号",
      prepublishConfirmed: true,
      displayStatus: "scheduled"
    },
    {
      id: "bq-002",
      monthlyPlanId: `mp-${M}`,
      matrixVersionId: "mv-001",
      matrixItemId: "task-demo-004",
      title: "企业做 AI 智能体，为什么需要把 GEO 纳入增长闭环？",
      primaryDistilledTerm: "GEO 增长闭环",
      priority: "P1",
      contentType: "faq",
      productId: "workbuddy",
      product: "JOTO WorkBuddy",
      rulePackageVersion: "rp-workbuddy-v2",
      channel: "zhihu",
      platformExpressionType: "技术实践型",
      titleConfirmed: true,
      evidencePreview: "ready",
      finalEvidenceGate: "ready",
      claimCount: 3,
      generationStatus: "generated",
      hardRuleStatus: "passed",
      softQualityScore: 0.87,
      qualityResult: "passed",
      scheduleStatus: "draft",
      platformAccount: "JOTO 知乎号",
      prepublishConfirmed: false,
      displayStatus: "qualified"
    }
  ];
}

function scheduleDraftItems(): ScheduleDraftItem[] {
  return [
    {
      id: "sched-draft-001",
      matrixItemId: "task-demo-003",
      title: "从工程视角看智能体平台的可观测性：WorkBuddy 与腾讯云 ADP 的协同",
      product: "腾讯云 ADP",
      channel: "juejin",
      date: `${M}-22`,
      time: "09:00",
      platformAccount: "JOTO 掘金号",
      status: "active",
      qualityReady: true
    },
    {
      id: "sched-draft-002",
      matrixItemId: "task-demo-004",
      title: "企业做 AI 智能体，为什么需要把 GEO 纳入增长闭环？",
      product: "JOTO WorkBuddy",
      channel: "zhihu",
      date: `${M}-23`,
      time: "10:00",
      platformAccount: "JOTO 知乎号",
      status: "draft",
      qualityReady: true
    }
  ];
}

function generationBatches(): GenerationBatchRecord[] {
  return [
    {
      batchId: "gb-001",
      month: M,
      taskIds: ["task-demo-001", "task-demo-002", "task-demo-003", "task-demo-004"],
      pendingTaskIds: [],
      completedTaskIds: ["task-demo-001", "task-demo-002", "task-demo-003", "task-demo-004"],
      failedTaskIds: [],
      status: "completed",
      createdAt: `${M}-03T08:00:00.000Z`,
      updatedAt: `${M}-12T08:00:00.000Z`
    }
  ];
}

function plan(): V5MonthlyPlanRecord {
  return {
    id: `mp-${M}`,
    version: 3,
    status: "running",
    config: {
      month: M,
      businessGoal: "通过 GEO 内容矩阵提升 JOTO WorkBuddy 与腾讯云 ADP 在 AI 平台中的可见性与提及率。",
      targetDeliverableCount: 12,
      questionVersionIds: ["qv-001", "qv-002", "qv-003", "qv-004"],
      quotaRules: strategyPackage().quotaRules,
      groups: [
        { groupQuotaId: "gq-001", rulePackageVersionId: "rp-workbuddy-v2", productId: "workbuddy", productName: "JOTO WorkBuddy", selectedChannels: ["wechat", "csdn", "juejin", "zhihu"], articleQuota: 6 },
        { groupQuotaId: "gq-002", rulePackageVersionId: "rp-adp-v1", productId: "tencent-adp", productName: "腾讯云 ADP", selectedChannels: ["wechat", "csdn", "juejin", "zhihu"], articleQuota: 12 }
      ]
    },
    createdAt: `${M}-01T08:00:00.000Z`,
    createdBy: "demo@joto.ai",
    updatedAt: `${M}-18T10:30:00.000Z`,
    updatedBy: "demo@joto.ai",
    strategyPackage: strategyPackage(),
    matrixTasks: matrixTasks()
  };
}

export const demoMonthlySeed: V5MonthlyState = {
  schemaVersion: 1,
  plans: { [M]: plan() },
  strategyRows: { [M]: strategyRows() },
  batchQueueItems: { [M]: batchQueueItems() },
  exceptionItems: { [M]: [] },
  scheduleDraftItems: { [M]: scheduleDraftItems() },
  generationBatches: { [M]: generationBatches() },
  strategyHistory: { [M]: [strategyPackage()] },
  removedTasks: { [M]: [] },
  auditLog: [
    {
      id: "audit-monthly-001",
      event: "strategy_approved",
      month: M,
      actor: "demo@joto.ai",
      version: 1,
      createdAt: `${M}-02T09:00:00.000Z`,
      auditReason: "演示数据：策略已确认"
    },
    {
      id: "audit-monthly-002",
      event: "batch_generation_requested",
      month: M,
      actor: "demo@joto.ai",
      version: 2,
      createdAt: `${M}-03T08:00:00.000Z`,
      auditReason: "演示数据：生成批次已请求"
    }
  ],
  idempotency: {}
};
