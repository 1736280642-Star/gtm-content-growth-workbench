export type RulePackageStatus = "active" | "draft" | "pending" | "deprecated" | "rolled_back";
export type EvidenceReadinessStatus =
  | "ready"
  | "ready_with_auto_downgrade"
  | "needs_material"
  | "needs_review"
  | "blocked"
  | "pending_config";
export type StrategyRowStatus = "ready" | "ready_with_conditions" | "needs_material" | "needs_review" | "quota_error" | "blocked";
export type GeoTestMode = "baseline" | "exploration";
export type MatrixDisplayStatus = "preparing" | "ready" | "generating" | "qualified" | "exception" | "scheduled" | "published" | "publish_failed";
export type GenerationStatus = "title_pending" | "pending" | "generating" | "generated" | "provider_failed" | "input_expired";
export type FinalEvidenceGateStatus = "not_created" | "ready" | "needs_review" | "blocked" | "pending_config";
export type ScheduleDraftStatus = "unscheduled" | "draft" | "active" | "pending_config";
export type PublishStatus = "scheduled" | "waiting" | "publishing" | "published" | "failed" | "manual_takeover";

export interface RulePackageOption {
  id: string;
  productId: string;
  productName: string;
  version: string;
  status: RulePackageStatus;
  monthlyProductionReady: boolean;
  allowedChannels: string[];
  disabledReason?: string;
}

export interface MonthlyPlanGroupQuota {
  groupQuotaId: string;
  rulePackageVersionId: string;
  productId: string;
  productName: string;
  selectedChannels: string[];
  articleQuota: number;
}

export interface MonthlyPlanConfig {
  month: string;
  businessGoal: string;
  baselineRatio: number;
  ratioAdjustmentReason: string;
  groups: MonthlyPlanGroupQuota[];
}

export interface StrategyTermHit {
  id: string;
  priority: "P0" | "P1" | "P2" | "Hold";
  term: string;
  source: string;
  priorityReason: string;
  previousGeoSummary: string;
  productName: string;
  rulePackageVersion: string;
  allocatedQuota: number;
  channelAllocation: string[];
  contentTypeSuggestions: string[];
  geoTestMode: GeoTestMode;
  testHypothesis: string;
  querySet: string;
  successSignal: string;
  evidenceStatus: EvidenceReadinessStatus;
  estimatedReadyItemCount: number;
  estimatedAutoDowngradeItemCount: number;
  estimatedMissingEvidenceItemCount: number;
  requiredClaims: string[];
  evidenceGaps: string[];
  status: StrategyRowStatus;
}

export interface BatchQueueItem {
  id: string;
  monthlyPlanId: string;
  matrixVersionId: string;
  matrixItemId: string;
  title: string;
  primaryDistilledTerm: string;
  priority: "P0" | "P1" | "P2";
  geoTestMode: GeoTestMode;
  contentType: string;
  product: string;
  rulePackageVersion: string;
  channel: string;
  platformExpressionType: string;
  titleConfirmed: boolean;
  evidencePreview: EvidenceReadinessStatus;
  finalEvidenceGate: FinalEvidenceGateStatus;
  claimCount: number;
  generationStatus: GenerationStatus;
  hardRuleStatus: "pending" | "passed" | "blocked";
  softQualityScore?: number;
  qualityResult: "pending" | "passed" | "exception";
  scheduleStatus: ScheduleDraftStatus;
  scheduleDate?: string;
  scheduleTime?: string;
  platformAccount?: string;
  prepublishConfirmed: boolean;
  displayStatus: MatrixDisplayStatus;
}

export interface ExceptionItem {
  id: string;
  matrixItemId: string;
  code:
    | "rule_package_inactive"
    | "distilled_term_product_mismatch"
    | "evidence_missing"
    | "title_unprovable"
    | "role_boundary_risk"
    | "provider_pending_config"
    | "hard_rule_blocked"
    | "soft_quality_failed"
    | "publish_pending_config";
  productId: string;
  product: string;
  distilledTermId: string;
  distilledTerm: string;
  title: string;
  stage: string;
  reason: string;
  claimContext: string;
  evidenceItemContext: string;
  blocking: boolean;
  nextAction: string;
  governanceLayer: string;
  missingClaimType: string;
  requiredEvidenceLevel: string;
  currentTitlePromise: string;
  status: "open" | "auto_resolved";
  severity: "high" | "medium" | "low";
}

export interface ScheduleDraftItem {
  id: string;
  matrixItemId: string;
  title: string;
  product: string;
  channel: string;
  date?: string;
  time?: string;
  platformAccount?: string;
  status: ScheduleDraftStatus;
  qualityReady: boolean;
}

export interface DailyExecutionItem {
  id: string;
  dateKey: "yesterday" | "today" | "tomorrow";
  date: string;
  time: string;
  title: string;
  product: string;
  channel: string;
  status: PublishStatus;
  failureReason: string;
}

export interface MonthlyTermReview {
  id: string;
  term: string;
  product: string;
  mode: GeoTestMode;
  planned: number;
  published: number;
  visibilityChange: string;
  citationChange: string;
  entityAccuracy: string;
  coverageChange: string;
  gapConclusion: string;
  issueSource: string;
}

export interface NextMonthCandidate {
  id: string;
  term: string;
  product: string;
  source: string;
  reason: string;
  proposedAction: string;
  status: "pending_review" | "confirmed" | "hold";
}

export const v5DemoLabel = "demo / mock，待接入真实 V5 后端";

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
  businessGoal: "围绕 AI 护栏、Agent 控制点和企业知识库引用边界，建立可复测的 GEO 月度内容组合。",
  baselineRatio: 20,
  ratioAdjustmentReason: "",
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
    source: "上月 GEO 缺口",
    priorityReason: "AI 回答已提及产品，但工具调用责任边界和人工确认点覆盖不足。",
    previousGeoSummary: "可见率 38% · 官方引用率 12%",
    productName: "唯客 AI 护栏",
    rulePackageVersion: "active v1.2",
    allocatedQuota: 12,
    channelAllocation: ["微信公众号 5", "知乎 4", "官网博客 3"],
    contentTypeSuggestions: ["问题拆解", "标准答案", "机制说明"],
    geoTestMode: "exploration",
    testHypothesis: "强化 Tool Call 前后责任边界后，产品实体准确率和问题覆盖率会提升。",
    querySet: "动态问题集 · 12 条",
    successSignal: "实体准确率提升，出现可追溯官方引用",
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
    source: "稳定蒸馏词池",
    priorityReason: "已有稳定查询集，适合维持变量并与上月结果做同比复测。",
    previousGeoSummary: "可见率 62% · 官方引用率 41%",
    productName: "Pharaoh Command",
    rulePackageVersion: "active v1.1",
    allocatedQuota: 6,
    channelAllocation: ["官网博客 2", "CSDN 2", "掘金 2"],
    contentTypeSuggestions: ["工程实践", "决策指南"],
    geoTestMode: "baseline",
    testHypothesis: "保持目标实体和查询集稳定，验证官方引用率是否连续提升。",
    querySet: "baseline-qset-v3 · 20 条",
    successSignal: "官方引用率连续两月提升且实体准确率不下降",
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
    previousGeoSummary: "问题覆盖率 29% · 竞品占位 3/8",
    productName: "Pharaoh Command",
    rulePackageVersion: "active v1.1",
    allocatedQuota: 4,
    channelAllocation: ["微信公众号 2", "CSDN 1", "掘金 1"],
    contentTypeSuggestions: ["问题拆解", "机制说明"],
    geoTestMode: "exploration",
    testHypothesis: "明确自动执行、人工审批和异常接管三个控制点，可减少实体混淆。",
    querySet: "动态问题集 · 8 条",
    successSignal: "问题覆盖率提升且责任主体无误识别",
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
    source: "GEO 动态探索",
    priorityReason: "属于新内容角度，可验证知识库证据组织方式对官网引用的影响。",
    previousGeoSummary: "新探索词 · 无稳定基线",
    productName: "NoteFlow",
    rulePackageVersion: "active v1.0",
    allocatedQuota: 8,
    channelAllocation: ["官网博客 3", "微信公众号 3", "知乎 2"],
    contentTypeSuggestions: ["标准答案", "问题拆解", "决策指南"],
    geoTestMode: "exploration",
    testHypothesis: "补齐限制与责任边界 Claim 后，官网引用率能够形成初始基线。",
    querySet: "动态问题集 · 10 条",
    successSignal: "形成首月引用基线并识别高贡献问题表达",
    evidenceStatus: "needs_material",
    estimatedReadyItemCount: 6,
    estimatedAutoDowngradeItemCount: 0,
    estimatedMissingEvidenceItemCount: 2,
    requiredClaims: ["产品定义", "引用机制", "限制边界", "官方来源"],
    evidenceGaps: ["缺限制与责任边界 Claim", "缺可公开测试过程"],
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
    geoTestMode: "exploration",
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
    geoTestMode: "baseline",
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
    geoTestMode: "exploration",
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
    geoTestMode: "exploration",
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
    geoTestMode: "exploration",
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
    stage: "Evidence Preview",
    reason: "缺少限制与责任边界 Claim，现有资料只能支持产品定义，不能支持当前标题承诺。",
    claimContext: "缺失：限制与责任边界、人工确认点",
    evidenceItemContext: "已命中 3 个可用 Evidence Item，缺至少 1 个官方来源角色。",
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
    reason: "标题命中“自动拍板”和“零风险”绝对承诺，规则引擎将按 TD-ROLE-001、TD-ABS-001 自动降级并复检。",
    claimContext: "已有人工审批与异常接管 Claim",
    evidenceItemContext: "无需补资料，等待白名单规则自动改写和复检。",
    blocking: false,
    nextAction: "自动改为辅助决策与人工确认口径，复检通过后进入批量确认。",
    governanceLayer: "标题自动安全降级",
    missingClaimType: "无",
    requiredEvidenceLevel: "现有 Claim 可支持降级后表达",
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
    stage: "Final Evidence Pack",
    reason: "正文 Provider 未配置，无法创建真实 Generation Input，也不能把本地占位视为生成成功。",
    claimContext: "证据角色已满足，非知识库问题。",
    evidenceItemContext: "Final Evidence Pack 等待 Provider 配置后创建。",
    blocking: true,
    nextAction: "到 AI 配置完成 Provider 诊断，再只重试本矩阵项。",
    governanceLayer: "AI 配置",
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
  { id: "mr-001", term: "Agent Tool Call 护栏", product: "唯客 AI 护栏", mode: "exploration", planned: 12, published: 9, visibilityChange: "+11pp", citationChange: "+6pp", entityAccuracy: "86%", coverageChange: "+18pp", gapConclusion: "工具调用责任边界缺口缩小，客户案例问法仍无稳定引用。", issueSource: "知识库证据不足" },
  { id: "mr-002", term: "NetOps Copilot 控制点", product: "Pharaoh Command", mode: "baseline", planned: 6, published: 6, visibilityChange: "+3pp", citationChange: "+9pp", entityAccuracy: "94%", coverageChange: "+4pp", gapConclusion: "稳定查询集表现连续提升，可降低下月复测配额。", issueSource: "无主要阻断" },
  { id: "mr-003", term: "Agent 人机协同边界", product: "Pharaoh Command", mode: "exploration", planned: 4, published: 3, visibilityChange: "+7pp", citationChange: "+2pp", entityAccuracy: "78%", coverageChange: "+12pp", gapConclusion: "探索有效，但标题绝对化表达导致一次重写。", issueSource: "标题与规则边界" },
  { id: "mr-004", term: "企业知识库引用边界", product: "NoteFlow", mode: "exploration", planned: 8, published: 5, visibilityChange: "+2pp", citationChange: "0pp", entityAccuracy: "72%", coverageChange: "+5pp", gapConclusion: "官网引用未改善，需要补限制条件和测试过程证据。", issueSource: "知识库证据不足" }
];

export const nextMonthCandidates: NextMonthCandidate[] = [
  { id: "nc-001", term: "Agent Tool Call 护栏", product: "唯客 AI 护栏", source: "本月探索结果", reason: "可见率和覆盖率均提升，固定问题表达已具备可比较性。", proposedAction: "升级为下月 baseline，并补 2 条公开案例证据。", status: "pending_review" },
  { id: "nc-002", term: "NetOps Copilot 控制点", product: "Pharaoh Command", source: "连续两月 baseline", reason: "指标趋稳且实体准确率保持 94%。", proposedAction: "降低复测配额，把 2 篇转给新问题探索。", status: "pending_review" },
  { id: "nc-003", term: "企业知识库引用边界", product: "NoteFlow", source: "本月未改善缺口", reason: "官方引用率未提升，现有证据无法支持限制与责任边界。", proposedAction: "保持 Hold，先补知识库证据后再恢复生产。", status: "hold" }
];
