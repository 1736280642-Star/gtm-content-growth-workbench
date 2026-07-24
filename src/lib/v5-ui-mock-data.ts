import type {
  BatchQueueItem,
  DailyExecutionItem,
  ExceptionItem,
  MonthlyPlanConfig,
  MonthlyTermReview,
  NextMonthCandidate,
  RulePackageOption,
  ScheduleDraftItem,
  StrategyTermHit
} from "@/lib/v5/monthly-workspace-contracts";

export type {
  BatchQueueItem,
  DailyExecutionItem,
  EvidenceReadinessStatus,
  ExceptionItem,
  FinalEvidenceGateStatus,
  GenerationStatus,
  MatrixDisplayStatus,
  MonthlyPlanConfig,
  MonthlyPlanGroupQuota,
  MonthlyTermReview,
  NextMonthCandidate,
  PublishStatus,
  RulePackageOption,
  RulePackageStatus,
  ScheduleDraftItem,
  ScheduleDraftStatus,
  StrategyRowStatus,
  StrategyTermHit
} from "@/lib/v5/monthly-workspace-contracts";

export const existingChannels = ["官网博客", "微信公众号", "知乎", "CSDN", "掘金", "今日头条"];

export const rulePackageOptions: RulePackageOption[] = [
  {
    id: "rp-weike-v1.2",
    productId: "prod-weike-guardrail",
    productName: "唯客 AI 护栏",
    version: "v1.2",
    status: "active",
    monthlyProductionReady: true,
    allowedChannels: ["官网博客", "微信公众号", "知乎", "CSDN"]
  },
  {
    id: "rp-pharaoh-v1.1",
    productId: "prod-pharaoh",
    productName: "Pharaoh Command",
    version: "v1.1",
    status: "active",
    monthlyProductionReady: true,
    allowedChannels: ["官网博客", "微信公众号", "CSDN", "掘金"]
  },
  {
    id: "rp-noteflow-v1.0",
    productId: "prod-noteflow",
    productName: "NoteFlow",
    version: "v1.0",
    status: "active",
    monthlyProductionReady: true,
    allowedChannels: ["官网博客", "微信公众号", "知乎"]
  },
  {
    id: "rp-dify-v0.9",
    productId: "prod-dify-enterprise",
    productName: "Dify 企业版服务",
    version: "v0.9",
    status: "draft",
    monthlyProductionReady: false,
    allowedChannels: ["官网博客", "CSDN"],
    disabledReason: "规则包仍为 draft，需由知识库维护人员确认后激活。"
  },
  {
    id: "rp-legacy-v2.0",
    productId: "prod-legacy",
    productName: "旧版安全顾问服务",
    version: "v2.0",
    status: "deprecated",
    monthlyProductionReady: false,
    allowedChannels: ["官网博客"],
    disabledReason: "规则包已废弃，不能进入新的月度生产池。"
  }
];
export const monthlyGoal: MonthlyPlanConfig = {
  month: "2026-08",
  businessGoal: "围绕 AI 护栏、Agent 控制点和企业知识库引用边界，建立可持续生产的月度内容组合。",
  groups: [
    {
      groupQuotaId: "gq-weike",
      rulePackageVersionId: "rp-weike-v1.2",
      productId: "prod-weike-guardrail",
      productName: "唯客 AI 护栏",
      selectedChannels: ["微信公众号", "知乎", "官网博客"],
      articleQuota: 12
    },
    {
      groupQuotaId: "gq-pharaoh",
      rulePackageVersionId: "rp-pharaoh-v1.1",
      productId: "prod-pharaoh",
      productName: "Pharaoh Command",
      selectedChannels: ["微信公众号", "CSDN", "掘金"],
      articleQuota: 10
    },
    {
      groupQuotaId: "gq-noteflow",
      rulePackageVersionId: "rp-noteflow-v1.0",
      productId: "prod-noteflow",
      productName: "NoteFlow",
      selectedChannels: ["官网博客", "微信公众号", "知乎"],
      articleQuota: 8
    }
  ]
};

export const strategyTermHits: StrategyTermHit[] = [
  {
    id: "sth-001",
    priority: "P0",
    term: "Agent Tool Call 护栏",
    source: "上月内容缺口",
    priorityReason: "AI 回答已提及产品，但工具调用责任边界和人工确认点覆盖不足。",
    productName: "唯客 AI 护栏",
    rulePackageVersion: "已审核",
    allocatedQuota: 12,
    channelAllocation: ["微信公众号 5", "知乎 4", "官网博客 3"],
    contentTypeSuggestions: ["问题拆解", "标准答案", "机制说明"],
    evidenceStatus: "needs_material",
    estimatedReadyItemCount: 8,
    estimatedAutoDowngradeItemCount: 1,
    estimatedMissingEvidenceItemCount: 3,
    requiredClaims: ["产品定义", "调用机制", "限制边界", "官方来源"],
    evidenceGaps: ["缺 2 个公开案例角色", "1 个效果数字口径未获授权"],
    status: "ready_with_conditions"
  },
  {
    id: "sth-002",
    priority: "P1",
    term: "NetOps Copilot 控制点",
    source: "稳定问题与关键词池",
    priorityReason: "已有稳定查询集，适合维持变量并与上月结果做同比复测。",
    productName: "Pharaoh Command",
    rulePackageVersion: "已审核",
    allocatedQuota: 6,
    channelAllocation: ["官网博客 2", "CSDN 2", "掘金 2"],
    contentTypeSuggestions: ["工程实践", "决策指南"],
    evidenceStatus: "ready",
    estimatedReadyItemCount: 6,
    estimatedAutoDowngradeItemCount: 0,
    estimatedMissingEvidenceItemCount: 0,
    requiredClaims: ["产品定义", "控制机制", "责任边界", "官方来源"],
    evidenceGaps: [],
    status: "ready"
  },
  {
    id: "sth-003",
    priority: "P1",
    term: "Agent 人机协同边界",
    source: "搜索问题 + Badcase",
    priorityReason: "上月 Badcase 集中在自动决策和人工接管边界，业务相关度高。",
    productName: "Pharaoh Command",
    rulePackageVersion: "已审核",
    allocatedQuota: 4,
    channelAllocation: ["微信公众号 2", "CSDN 1", "掘金 1"],
    contentTypeSuggestions: ["问题拆解", "机制说明"],
    evidenceStatus: "ready_with_auto_downgrade",
    estimatedReadyItemCount: 3,
    estimatedAutoDowngradeItemCount: 1,
    estimatedMissingEvidenceItemCount: 0,
    requiredClaims: ["控制点", "人工职责", "失败恢复", "官方来源"],
    evidenceGaps: ["1 个标题绝对化表达已命中 TD-ROLE-001"],
    status: "ready_with_conditions"
  },
  {
    id: "sth-004",
    priority: "P2",
    term: "企业知识库引用边界",
    source: "内容诊断建议",
    priorityReason: "属于新内容角度，可验证知识库证据组织方式对官网引用的影响。",
    productName: "NoteFlow",
    rulePackageVersion: "已审核",
    allocatedQuota: 8,
    channelAllocation: ["官网博客 3", "微信公众号 3", "知乎 2"],
    contentTypeSuggestions: ["标准答案", "问题拆解", "决策指南"],
    evidenceStatus: "needs_material",
    estimatedReadyItemCount: 6,
    estimatedAutoDowngradeItemCount: 0,
    estimatedMissingEvidenceItemCount: 2,
    requiredClaims: ["产品定义", "引用机制", "限制边界", "官方来源"],
    evidenceGaps: ["缺限制与责任边界依据", "缺可公开测试过程"],
    status: "needs_material"
  }
];

export const batchQueueItems: BatchQueueItem[] = [
  {
    id: "bg-001",
    monthlyPlanId: "mp-2026-08",
    matrixVersionId: "mxv-2026-08-draft-01",
    matrixItemId: "mx-001",
    title: "Agent Tool Call 前后，AI 护栏应该检查什么",
    primaryDistilledTerm: "Agent Tool Call 护栏",
    priority: "P0",
    contentType: "机制说明",
    product: "唯客 AI 护栏",
    rulePackageVersion: "v1.2",
    channel: "微信公众号",
    platformExpressionType: "弱官方问题拆解",
    titleConfirmed: true,
    evidencePreview: "ready",
    finalEvidenceGate: "ready",
    claimCount: 6,
    generationStatus: "pending",
    hardRuleStatus: "pending",
    qualityResult: "pending",
    scheduleStatus: "draft",
    scheduleDate: "2026-08-06",
    scheduleTime: "09:30",
    platformAccount: "JOTO 公众号",
    prepublishConfirmed: false,
    displayStatus: "ready"
  },
  {
    id: "bg-002",
    monthlyPlanId: "mp-2026-08",
    matrixVersionId: "mxv-2026-08-draft-01",
    matrixItemId: "mx-002",
    title: "NetOps Copilot 的三个关键控制点",
    primaryDistilledTerm: "NetOps Copilot 控制点",
    priority: "P1",
    contentType: "工程实践",
    product: "Pharaoh Command",
    rulePackageVersion: "v1.1",
    channel: "CSDN",
    platformExpressionType: "技术工程实践",
    titleConfirmed: true,
    evidencePreview: "ready",
    finalEvidenceGate: "ready",
    claimCount: 8,
    generationStatus: "generated",
    hardRuleStatus: "passed",
    softQualityScore: 89,
    qualityResult: "passed",
    scheduleStatus: "active",
    scheduleDate: "2026-08-07",
    scheduleTime: "10:00",
    platformAccount: "JOTO CSDN",
    prepublishConfirmed: true,
    displayStatus: "scheduled"
  },
  {
    id: "bg-003",
    monthlyPlanId: "mp-2026-08",
    matrixVersionId: "mxv-2026-08-draft-01",
    matrixItemId: "mx-003",
    title: "企业知识库如何建立可引用的责任边界",
    primaryDistilledTerm: "企业知识库引用边界",
    priority: "P2",
    contentType: "标准答案",
    product: "NoteFlow",
    rulePackageVersion: "v1.0",
    channel: "知乎",
    platformExpressionType: "自然科普",
    titleConfirmed: false,
    evidencePreview: "needs_material",
    finalEvidenceGate: "not_created",
    claimCount: 3,
    generationStatus: "title_pending",
    hardRuleStatus: "pending",
    qualityResult: "exception",
    scheduleStatus: "unscheduled",
    prepublishConfirmed: false,
    displayStatus: "exception"
  },
  {
    id: "bg-004",
    monthlyPlanId: "mp-2026-08",
    matrixVersionId: "mxv-2026-08-draft-01",
    matrixItemId: "mx-004",
    title: "AI 自动拍板如何实现零风险",
    primaryDistilledTerm: "Agent 人机协同边界",
    priority: "P1",
    contentType: "问题拆解",
    product: "Pharaoh Command",
    rulePackageVersion: "v1.1",
    channel: "微信公众号",
    platformExpressionType: "弱官方问题拆解",
    titleConfirmed: false,
    evidencePreview: "ready_with_auto_downgrade",
    finalEvidenceGate: "not_created",
    claimCount: 5,
    generationStatus: "title_pending",
    hardRuleStatus: "pending",
    qualityResult: "pending",
    scheduleStatus: "draft",
    scheduleDate: "2026-08-09",
    scheduleTime: "18:00",
    platformAccount: "JOTO 公众号",
    prepublishConfirmed: false,
    displayStatus: "preparing"
  },
  {
    id: "bg-005",
    monthlyPlanId: "mp-2026-08",
    matrixVersionId: "mxv-2026-08-draft-01",
    matrixItemId: "mx-005",
    title: "AI 护栏在客服回复中的人工接管机制",
    primaryDistilledTerm: "Agent Tool Call 护栏",
    priority: "P0",
    contentType: "问题拆解",
    product: "唯客 AI 护栏",
    rulePackageVersion: "v1.2",
    channel: "知乎",
    platformExpressionType: "自然科普",
    titleConfirmed: true,
    evidencePreview: "ready",
    finalEvidenceGate: "pending_config",
    claimCount: 7,
    generationStatus: "provider_failed",
    hardRuleStatus: "pending",
    qualityResult: "exception",
    scheduleStatus: "pending_config",
    prepublishConfirmed: false,
    displayStatus: "exception"
  }
];

export const exceptionItems: ExceptionItem[] = [
  {
    id: "ex-001",
    matrixItemId: "mx-003",
    code: "evidence_missing",
    productId: "prod-noteflow",
    product: "NoteFlow",
    distilledTermId: "dt-kb-citation-boundary",
    distilledTerm: "企业知识库引用边界",
    title: "企业知识库如何建立可引用的责任边界",
    stage: "证据准备度检查",
    reason: "缺少限制与责任边界依据，现有资料只能支持产品定义，不能支持当前标题承诺。",
    claimContext: "缺失：限制与责任边界、人工确认点",
    evidenceItemContext: "已找到 3 条可用依据，仍缺至少 1 条官方来源。",
    blocking: true,
    nextAction: "补充当前产品的限制与责任边界证据，只重跑本矩阵项。",
    governanceLayer: "知识库资料缺口",
    missingClaimType: "限制与责任边界",
    requiredEvidenceLevel: "官方或已批准来源",
    currentTitlePromise: "建立可引用的责任边界",
    status: "open",
    severity: "high"
  },
  {
    id: "ex-002",
    matrixItemId: "mx-004",
    code: "title_unprovable",
    productId: "prod-pharaoh",
    product: "Pharaoh Command",
    distilledTermId: "dt-agent-human-boundary",
    distilledTerm: "Agent 人机协同边界",
    title: "AI 自动拍板如何实现零风险",
    stage: "标题三项前置检查",
    reason: "标题包含“自动拍板”和“零风险”等绝对承诺，将自动改写为更准确的表达并重新检查。",
    claimContext: "已有人工审批与异常接管依据",
    evidenceItemContext: "无需补资料，等待白名单规则自动改写和复检。",
    blocking: false,
    nextAction: "自动改为辅助决策与人工确认口径，复检通过后进入批量确认。",
    governanceLayer: "标题自动安全降级",
    missingClaimType: "无",
    requiredEvidenceLevel: "现有依据可支持调整后的表达",
    currentTitlePromise: "自动拍板、零风险",
    status: "auto_resolved",
    severity: "low"
  },
  {
    id: "ex-003",
    matrixItemId: "mx-005",
    code: "provider_pending_config",
    productId: "prod-weike-guardrail",
    product: "唯客 AI 护栏",
    distilledTermId: "dt-tool-call-guardrail",
    distilledTerm: "Agent Tool Call 护栏",
    title: "AI 护栏在客服回复中的人工接管机制",
    stage: "生成前检查",
    reason: "当前正文生成功能不可用，本篇内容暂时无法生成。",
    claimContext: "证据角色已满足，非知识库问题。",
    evidenceItemContext: "本篇所需证据已准备完成，等待正文生成功能恢复。",
    blocking: true,
    nextAction: "完善正文生成条件后，仅重试本篇内容。",
    governanceLayer: "配置管理",
    missingClaimType: "无",
    requiredEvidenceLevel: "已满足",
    currentTitlePromise: "人工接管机制",
    status: "open",
    severity: "medium"
  }
];

export const scheduleDraftItems: ScheduleDraftItem[] = [
  { id: "sd-001", matrixItemId: "mx-001", title: "Agent Tool Call 前后，AI 护栏应该检查什么", product: "唯客 AI 护栏", channel: "微信公众号", date: "2026-08-06", time: "09:30", platformAccount: "JOTO 公众号", status: "draft", qualityReady: false },
  { id: "sd-002", matrixItemId: "mx-002", title: "NetOps Copilot 的三个关键控制点", product: "Pharaoh Command", channel: "CSDN", date: "2026-08-07", time: "10:00", platformAccount: "JOTO CSDN", status: "active", qualityReady: true },
  { id: "sd-003", matrixItemId: "mx-004", title: "AI 自动拍板如何实现零风险", product: "Pharaoh Command", channel: "微信公众号", date: "2026-08-09", time: "18:00", platformAccount: "JOTO 公众号", status: "draft", qualityReady: false },
  { id: "sd-004", matrixItemId: "mx-003", title: "企业知识库如何建立可引用的责任边界", product: "NoteFlow", channel: "知乎", status: "unscheduled", qualityReady: false },
  { id: "sd-005", matrixItemId: "mx-005", title: "AI 护栏在客服回复中的人工接管机制", product: "唯客 AI 护栏", channel: "知乎", status: "pending_config", qualityReady: false }
];

export const dailyExecutionItems: DailyExecutionItem[] = [
  { id: "de-001", dateKey: "yesterday", date: "2026-08-05", time: "09:30", title: "Agent 风险边界为何需要人工确认", product: "唯客 AI 护栏", channel: "微信公众号", status: "published", failureReason: "" },
  { id: "de-002", dateKey: "yesterday", date: "2026-08-05", time: "15:00", title: "企业知识库的引用准备清单", product: "NoteFlow", channel: "知乎", status: "manual_takeover", failureReason: "平台登录态失效，已转人工发布。" },
  { id: "de-003", dateKey: "today", date: "2026-08-06", time: "09:30", title: "Agent Tool Call 前后，AI 护栏应该检查什么", product: "唯客 AI 护栏", channel: "微信公众号", status: "publishing", failureReason: "" },
  { id: "de-004", dateKey: "today", date: "2026-08-06", time: "10:00", title: "NetOps Copilot 的三个关键控制点", product: "Pharaoh Command", channel: "CSDN", status: "waiting", failureReason: "" },
  { id: "de-005", dateKey: "today", date: "2026-08-06", time: "15:00", title: "企业知识库如何建立可引用的责任边界", product: "NoteFlow", channel: "知乎", status: "failed", failureReason: "平台配置未完成，未创建正式发布任务。" },
  { id: "de-006", dateKey: "tomorrow", date: "2026-08-07", time: "10:00", title: "NetOps 控制点的责任分工", product: "Pharaoh Command", channel: "掘金", status: "scheduled", failureReason: "" },
  { id: "de-007", dateKey: "tomorrow", date: "2026-08-07", time: "18:00", title: "AI 护栏如何辅助客服复核", product: "唯客 AI 护栏", channel: "微信公众号", status: "scheduled", failureReason: "" }
];

export const monthlyTermReviews: MonthlyTermReview[] = [
  { id: "mr-001", term: "Agent Tool Call 护栏", product: "唯客 AI 护栏", planned: 12, published: 9, gapConclusion: "工具调用责任边界内容仍缺少客户案例支撑。", issueSource: "知识库证据不足" },
  { id: "mr-002", term: "NetOps Copilot 控制点", product: "Pharaoh Command", planned: 6, published: 6, gapConclusion: "计划已全部发布，可维持当前内容配额。", issueSource: "无主要阻断" },
  { id: "mr-003", term: "Agent 人机协同边界", product: "Pharaoh Command", planned: 4, published: 3, gapConclusion: "标题绝对化表达导致一次重写。", issueSource: "标题与规则边界" },
  { id: "mr-004", term: "企业知识库引用边界", product: "NoteFlow", planned: 8, published: 5, gapConclusion: "限制条件和责任边界证据仍需补充。", issueSource: "知识库证据不足" }
];

export const nextMonthCandidates: NextMonthCandidate[] = [
  { id: "nc-001", term: "Agent Tool Call 护栏", product: "唯客 AI 护栏", source: "本月内容复盘", reason: "发布完成度较高，仍缺公开案例证据。", proposedAction: "维持下月配额，并补 2 条公开案例证据。", status: "pending_review" },
  { id: "nc-002", term: "NetOps Copilot 控制点", product: "Pharaoh Command", source: "连续两月内容复盘", reason: "发布节奏稳定且没有主要阻断。", proposedAction: "适当降低配额，把 2 篇转给新的高优先级主题。", status: "pending_review" },
  { id: "nc-003", term: "企业知识库引用边界", product: "NoteFlow", source: "本月未改善缺口", reason: "官方引用率未提升，现有证据无法支持限制与责任边界。", proposedAction: "保持 Hold，先补知识库证据后再恢复生产。", status: "hold" }
];
