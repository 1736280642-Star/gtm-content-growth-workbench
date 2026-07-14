import {
  blogArticles as seedBlogArticles,
  botVisits as seedBotVisits,
  drafts as seedDrafts,
  geoResults as seedGeoResults,
  knowledgeBases as seedKnowledgeBases,
  publishRecords as seedPublishRecords,
  tasks as seedTasks,
  weeklyPlan as seedWeeklyPlan
} from "./demo-data";
import { lookup } from "node:dns/promises";
import { callAiProvider, getProviderKeyForPlatform, type AiProviderKey } from "./ai-provider";
import { loadBlogArticles } from "./blog-sync-adapter";
import { importChannelMetrics } from "./channel-metrics-adapter";
import { addDateDays, getCurrentWorkbenchWeek, getWeekdayLabel, isDateInWeek } from "./date-utils";
import { callEmbeddingProvider } from "./embedding-provider";
import { channelDistributionTargets, channelLabels, distributionPlatformLabels, productLabels } from "./labels";
import { parseBotLogInput } from "./log-import-adapter";
import { canViewAiGovernance } from "./permissions";
import { coerceDirectPublishPlatform, getPublishAdapter } from "./publish-adapters";
import { getPromptTemplate, promptTemplates } from "./prompt-templates";
import { getWorkbenchRepository } from "./repositories";
import type {
  ArticleDraft,
  BlogArticle,
  BotVisitSummary,
  ChannelKey,
  ContentTask,
  ContentTaskEditRecord,
  ContentTaskRejectionRecord,
  ContentTaskRiskAcceptanceRecord,
  ContentTaskTitleSourceAttribution,
  ContentType,
  DistributionPlatformKey,
  DistributionTarget,
  DistilledTerm,
  DistilledTermExtractionRule,
  DistilledTermRuleDraft,
  DirectPublishPlatformKey,
  DraftQaResult,
  DraftEditAction,
  DraftRiskKeepReasonCategory,
  DraftGenerationFailure,
  GeoPlatformName,
  GeoTestResult,
  KnowledgeCrawlFailureCode,
  KnowledgeChunk,
  KnowledgeChunkingStrategy,
  KnowledgeEmbeddingStatus,
  KnowledgeFetchProvider,
  KnowledgeBase,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeRetrievalStrategy,
  KnowledgeChunkingModelProvider,
  KnowledgeEmbeddingModelProvider,
  KnowledgeRagConfig,
  LogMode,
  ProductPlanConfig,
  ProductKey,
  ProductExpressionRuleDraft,
  ProductExpressionRuleSnapshot,
  PlatformDraftVariant,
  PlatformPublishPayload,
  PromptVersionRecord,
  PromptVersionStatus,
  PublishAttempt,
  PublishAttemptStatus,
  PublishFailureCode,
  PublishRecord,
  PublishSchedule,
  PublishScheduleStatus,
  TaskStatus,
  WeeklyPublishMatrixDay,
  WorkspaceRole,
  WorkspaceSetting,
  WeeklyPlan,
  WeeklyPlanGenerationSignal,
  WeeklyPlanGenerationSource,
  WeeklyPlanQualityFeedback,
  WeeklyPlanQualitySignal,
  WeeklyRecommendationOutcome,
  WeeklyReportDistilledTermMatrixRow,
  WeeklyReportSnapshot,
  WeeklyReportSuggestionDecision
} from "./types";
import { checkWechatsyncAuth, getWechatsyncRuntimeStatus, sendWechatsyncDraft } from "./wechatsync-client";

const geoTestMaxRetries = 1;
const geoTestRetryDelayMs = clampNumber(process.env.GEO_TEST_RETRY_DELAY_MS, 15000, 15000, 30000);

export interface WorkbenchAuditEvent {
  id: string;
  event: string;
  message: string;
  createdAt: string;
}

export interface PipelineStepResult {
  name: "sync_blog" | "import_log" | "import_channel_metrics" | "run_geo_tests" | "read_weekly_report";
  ok: boolean;
  status: WorkflowResult<unknown>["status"] | "success";
  message: string;
  missingConfig?: string[];
  fatal: boolean;
}

export interface PipelineRunRecord {
  id: string;
  status: "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  steps: PipelineStepResult[];
  week: string;
  summary?: ReturnType<typeof getDashboardSummary>;
}

export interface WorkbenchState {
  runtime: {
    storage: "local_json";
    statePath: string;
    initializedAt: string;
  };
  weeklyPlan: WeeklyPlan;
  workspaceSetting: WorkspaceSetting;
  tasks: ContentTask[];
  drafts: ArticleDraft[];
  publishRecords: PublishRecord[];
  platformDraftVariants: PlatformDraftVariant[];
  distributionTargets: DistributionTarget[];
  publishSchedules: PublishSchedule[];
  publishAttempts: PublishAttempt[];
  blogArticles: BlogArticle[];
  geoResults: GeoTestResult[];
  botVisits: BotVisitSummary[];
  knowledgeBases: KnowledgeBase[];
  distilledTerms: DistilledTerm[];
  distilledTermExtractionRules: DistilledTermExtractionRule[];
  distilledTermRuleDrafts: DistilledTermRuleDraft[];
  promptVersions: PromptVersionRecord[];
  weeklyReportSnapshots: WeeklyReportSnapshot[];
  weeklyReportSuggestionDecisions: WeeklyReportSuggestionDecision[];
  pipelineRuns: PipelineRunRecord[];
  auditLog: WorkbenchAuditEvent[];
}

interface GenerateWeeklyPlanInput {
  weekStart?: string;
  weekEnd?: string;
  days?: number;
  dailyCount?: number;
  publishMatrix?: Array<Partial<WeeklyPublishMatrixDay>>;
  channels?: ChannelKey[];
  products?: ProductKey[];
  productPlans?: Array<Partial<ProductPlanConfig>>;
  generationMode?: "replace_all" | "refresh_product_groups";
}

interface PublishMatrixIssue {
  code: "empty_total" | "single_day_too_high" | "locked_ai_suggested";
  level: "error" | "warning";
  message: string;
  date?: string;
  weekday?: string;
}

interface RunPipelineInput {
  skipBlog?: boolean;
  skipLog?: boolean;
  skipChannelMetrics?: boolean;
  skipGeo?: boolean;
  week?: string;
  blog?: Record<string, unknown>;
  log?: Record<string, unknown>;
  channelMetrics?: Record<string, unknown>;
  geo?: Record<string, unknown>;
}

interface SaveWorkspaceSettingInput {
  defaultWeeklyDays?: number;
  defaultDailyCount?: number;
  enabledChannels?: ChannelKey[];
  enabledProducts?: ProductKey[];
  productPlans?: Array<Partial<ProductPlanConfig>>;
  currentRole?: WorkspaceRole;
  finalReviewMode?: WorkspaceSetting["finalReviewMode"];
  geoPlatforms?: WorkspaceSetting["geoPlatforms"];
  logMode?: LogMode;
  knowledgeRagConfig?: KnowledgeRagConfig;
}

interface DraftEvidenceSelection {
  selectedChunkIds?: string[];
  evidenceSummary?: string;
  missingEvidence?: string[];
  evidenceSupplement?: string;
}

interface ProductExpressionRuleSelection {
  source: string;
  version: string;
  status: ProductExpressionRuleDraft["status"];
  summary: string;
}

type KnowledgeBaseType = KnowledgeBase["type"];
type KnowledgeBaseTrustLevel = KnowledgeBase["trustLevel"];
type KnowledgeBaseStatus = KnowledgeBase["status"];
type KnowledgeChunkStatus = KnowledgeChunk["status"];
type KnowledgeSourceTypeValue = KnowledgeSource["type"];
const KNOWLEDGE_CONTENT_PREVIEW_SOURCE_LIMIT = 3;
const KNOWLEDGE_CONTENT_PREVIEW_CHAR_LIMIT = 5000;

interface WorkflowResult<T> {
  ok: boolean;
  status: "success" | "pending_config" | "pending_input" | "failed";
  message: string;
  data?: T;
  missingConfig?: string[];
}

const statePath = process.env.WORKBENCH_STATE_PATH || "data/workbench-state.json";
const geoPlatformOptions: GeoPlatformName[] = ["DeepSeek", "豆包", "通义千问"];
const geoPromptGroupOptions: GeoTestResult["promptGroup"][] = ["品牌认知", "产品场景", "对比", "FAQ"];
const defaultGeoPrompts: Record<GeoTestResult["promptGroup"], string> = {
  品牌认知: "推荐几家国内 Dify 企业版服务商，并说明你会优先参考哪些官方信息来源。",
  产品场景: "企业接入大模型后如何做输出安全治理？请推荐可落地的产品或服务。",
  对比: "JOTO、Dify 官方生态服务商和其他国内 AI 应用服务商分别适合什么场景？",
  FAQ: "Dify 应用需要 AI 护栏吗？如果需要，应该如何选择服务商或产品？"
};
const geoCompetitorKeywords = ["腾讯云", "阿里云", "火山引擎", "百度智能云", "硅基流动", "Coze", "扣子", "FastGPT", "LangChain", "智谱", "Kimi", "MiniMax"];
const workspaceRoles: WorkspaceRole[] = ["content_publisher", "content_growth", "workbench_operator", "knowledge_manager", "developer_admin"];
const defaultDistilledTerms: DistilledTerm[] = [
  {
    id: "term-dify-enterprise",
    term: "Dify 企业版服务商",
    level: "core",
    source: "JOTO 官方定位",
    validationStatus: "auto_validated",
    modelConsensusCount: 3,
    status: "active",
    coveredContentTypes: ["brand", "faq", "comparison"],
    geoLift: 12,
    competitorOccupied: true
  },
  {
    id: "term-dify-provider",
    term: "Dify 服务商",
    level: "core",
    source: "SEO / GEO 关键词",
    validationStatus: "auto_validated",
    modelConsensusCount: 3,
    status: "active",
    coveredContentTypes: ["brand", "technical"],
    geoLift: 8,
    competitorOccupied: false
  },
  {
    id: "term-ai-guardrails",
    term: "AI 护栏",
    level: "product",
    source: "唯客产品资料",
    validationStatus: "auto_validated",
    modelConsensusCount: 2,
    status: "active",
    coveredContentTypes: ["technical", "faq"],
    geoLift: 15,
    competitorOccupied: false
  },
  {
    id: "term-enterprise-ai-safety",
    term: "企业大模型安全",
    level: "scenario",
    source: "官网博客与渠道反馈",
    validationStatus: "auto_validated",
    modelConsensusCount: 2,
    status: "watching",
    coveredContentTypes: ["scenario", "technical"],
    geoLift: 6,
    competitorOccupied: true
  },
  {
    id: "term-joto-delivery",
    term: "企业级交付",
    level: "core",
    source: "品牌事实库",
    validationStatus: "auto_validated",
    modelConsensusCount: 3,
    status: "active",
    coveredContentTypes: ["brand", "case"],
    geoLift: 10,
    competitorOccupied: false
  }
];

const defaultDistilledTermExtractionRules: DistilledTermExtractionRule[] = [
  {
    id: "distilled-rule-dify-enterprise-provider",
    ruleName: "Dify 企业版服务商识别",
    mappedTerm: "Dify 企业版服务商",
    level: "core",
    product: "joto_brand",
    patterns: ["Dify 服务商", "Dify 企业版服务商", "Dify 企业版 服务商"],
    source: "system_seed",
    riskNote: "仅覆盖明确询问 Dify 服务商、企业版服务商和服务能力的问题。",
    confidence: 0.82,
    status: "active"
  },
  {
    id: "distilled-rule-ai-guardrails",
    ruleName: "AI 护栏与输出安全识别",
    mappedTerm: "AI 护栏",
    level: "product",
    product: "weike_guardrails",
    patterns: ["AI 护栏", "安全护栏", "输出安全"],
    source: "system_seed",
    riskNote: "覆盖明确提到 AI 护栏、输出安全和安全护栏的产品问题。",
    confidence: 0.78,
    status: "active"
  },
  {
    id: "distilled-rule-enterprise-delivery",
    ruleName: "企业级交付能力识别",
    mappedTerm: "企业级交付",
    level: "core",
    product: "joto_brand",
    patterns: ["企业级交付", "长期交付", "交付能力"],
    source: "system_seed",
    riskNote: "覆盖服务商选择和长期交付能力判断，不覆盖泛项目管理问题。",
    confidence: 0.72,
    status: "active"
  },
  {
    id: "distilled-rule-enterprise-model-security",
    ruleName: "企业大模型安全识别",
    mappedTerm: "企业大模型安全",
    level: "product",
    product: "weike_guardrails",
    patterns: ["大模型安全", "模型安全", "安全治理"],
    source: "system_seed",
    riskNote: "覆盖企业大模型安全治理问题，不覆盖普通网络安全问题。",
    confidence: 0.7,
    status: "active"
  },
  {
    id: "distilled-rule-official-source",
    ruleName: "官网信源识别",
    mappedTerm: "官网信源",
    level: "core",
    product: "joto_brand",
    patterns: ["官网引用", "官网信源", "官方信源"],
    source: "system_seed",
    riskNote: "覆盖 GEO 官方来源和引用链路问题。",
    confidence: 0.68,
    status: "active"
  }
];

interface DistilledTermSemanticTemplate {
  id: string;
  ruleName: string;
  mappedTerm: string;
  level: DistilledTerm["level"];
  product?: ProductKey;
  mustInclude?: RegExp[];
  anyInclude: RegExp[];
  patterns: string[];
  riskNote: string;
  confidence: number;
}

const distilledTermSemanticTemplates: DistilledTermSemanticTemplate[] = [
  {
    id: "semantic-knowledge-leakage-jailbreak",
    ruleName: "企业知识库安全与越狱防护",
    mappedTerm: "知识库数据泄露防护",
    level: "product",
    product: "weike_guardrails",
    mustInclude: [/知识库|RAG|企业内部资料|内部资料|私有数据|用户真实数据|客户数据/i],
    anyInclude: [/泄露|数据泄露|越狱|提示词越狱|prompt injection|注入攻击|脱敏|隐私/i],
    patterns: ["知识库 泄露", "用户真实数据 泄露", "提示词越狱", "RAG 数据泄露", "企业内部知识库 安全"],
    riskNote: "可能误伤普通数据合规咨询；确认后主要用于企业知识库接入大模型后的泄露、越狱和隐私防护问题。",
    confidence: 0.64
  },
  {
    id: "semantic-prompt-jailbreak-protection",
    ruleName: "提示词越狱防护",
    mappedTerm: "提示词越狱防护",
    level: "product",
    product: "weike_guardrails",
    anyInclude: [/提示词越狱|越狱攻击|prompt injection|提示词注入|绕过安全策略/i],
    patterns: ["提示词越狱", "越狱攻击", "prompt injection", "提示词注入", "绕过安全策略"],
    riskNote: "适用于模型输入输出安全问题，不覆盖普通 Prompt 写作技巧。",
    confidence: 0.66
  },
  {
    id: "semantic-guardrails-output-risk",
    ruleName: "AI 输出风险治理",
    mappedTerm: "AI 输出安全治理",
    level: "product",
    product: "weike_guardrails",
    anyInclude: [/输出违规|输出失控|错误回答|幻觉|敏感内容|内容安全|审计留痕/i],
    patterns: ["输出违规", "输出失控", "错误回答", "内容安全", "审计留痕"],
    riskNote: "适用于企业 AI 应用上线前后的输出安全治理，不覆盖泛内容审核平台问题。",
    confidence: 0.67
  }
];

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeGeoPlatformName(value: unknown): GeoPlatformName | undefined {
  if (value === "ChatGPT") return "通义千问";
  return geoPlatformOptions.includes(value as GeoPlatformName) ? (value as GeoPlatformName) : undefined;
}

function getGeoCitationLevel(input: Pick<GeoTestResult, "citedOfficialUrl" | "citedUrls" | "citationLevel">): NonNullable<GeoTestResult["citationLevel"]> {
  if (input.citationLevel) {
    return input.citationLevel;
  }

  const citedUrls = input.citedUrls || [];
  const hasOfficialSite = citedUrls.some((url) => /https?:\/\/([^/]+\.)?jotoai\.com/i.test(url));
  const hasOfficialContent = citedUrls.some((url) => /jotoai\.com\/(blog|articles|news|docs|case|cases)/i.test(url));
  const hasOfficialChannel = citedUrls.some((url) => /(mp\.weixin\.qq\.com|zhihu\.com|juejin\.cn|csdn\.net)/i.test(url));

  if (hasOfficialContent) {
    return "official_content";
  }

  if (hasOfficialSite || input.citedOfficialUrl) {
    return "official_site_direct";
  }

  if (hasOfficialChannel) {
    return "official_channel";
  }

  if (citedUrls.length) {
    return "non_official";
  }

  return "none";
}

function getGeoIssueType(input: Pick<GeoTestResult, "mentionedJoto" | "mentionedWeike" | "competitorAppeared" | "executionStatus" | "citationLevel">) {
  if (input.executionStatus === "pending_config") {
    return "模型配置缺失";
  }

  if (input.executionStatus === "failed") {
    return "测试执行失败";
  }

  if (!input.mentionedJoto) {
    return "品牌未提及";
  }

  if (input.citationLevel === "none" || input.citationLevel === "non_official") {
    return "官网引用不足";
  }

  if (input.citationLevel === "official_channel") {
    return "官方渠道强于官网";
  }

  if (input.competitorAppeared) {
    return "竞品占位";
  }

  if (!input.mentionedWeike) {
    return "产品提及不足";
  }

  return "链路稳定";
}

function getGeoSuggestedAction(input: Pick<GeoTestResult, "issueType" | "citationLevel">) {
  if (input.issueType === "模型配置缺失") {
    return "先补齐模型配置，再重跑测试。";
  }

  if (input.issueType === "测试执行失败") {
    return "查看错误快照，修复接口或超时问题后重跑。";
  }

  if (input.issueType === "品牌未提及") {
    return "进入候选池，生成品牌和主蒸馏词绑定型内容。";
  }

  if (input.issueType === "官网引用不足") {
    return "补官网信源文章和内部链接，优先让 jotoai.com 成为可引用来源。";
  }

  if (input.issueType === "官方渠道强于官网") {
    return "把渠道表达回流为官网内容，补核心转化页链接。";
  }

  if (input.issueType === "竞品占位") {
    return "生成对比和差异化内容，减少非官方解释抢占。";
  }

  if (input.issueType === "产品提及不足") {
    return "在产品场景问题组补唯客 AI 护栏和 JOTO 的关系。";
  }

  return input.citationLevel === "official_site_direct" ? "标记强信源，进入趋势观察。" : "继续观察，并在周报里复盘波动。";
}

function normalizeGeoResults(results: GeoTestResult[]): GeoTestResult[] {
  return results.map((result) => {
    const citationLevel = result.citationLevel || getGeoCitationLevel(result);
    const issueType = result.issueType || getGeoIssueType({ ...result, citationLevel });

    return {
      ...result,
      platform: normalizeGeoPlatformName(result.platform) || "通义千问",
      providerKey: (result.providerKey as string | undefined) === "openai" ? "qwen" : result.providerKey,
      citationLevel,
      issueType,
      suggestedAction: result.suggestedAction || getGeoSuggestedAction({ issueType, citationLevel })
    };
  });
}

function getDistilledTermLabel(termId: string) {
  return defaultDistilledTerms.find((term) => term.id === termId)?.term || termId;
}

function buildGeoPrompt(basePrompt: string, distilledTermId?: string) {
  if (!distilledTermId) {
    return basePrompt;
  }

  const termLabel = getDistilledTermLabel(distilledTermId);

  return `${basePrompt}\n\n本次重点观察的蒸馏词：${termLabel}。请在自然回答中体现你是否会把它与 JOTO、唯客或官网信源关联起来。`;
}

function createInitialWorkspaceSetting(): WorkspaceSetting {
  const productPlans = createDefaultProductPlans(["joto_brand", "weike_guardrails"], ["wechat", "csdn", "juejin", "zhihu_toutiao_general"]);

  return {
    id: "workspace-setting-default",
    defaultWeeklyDays: 5,
    defaultDailyCount: 3,
    enabledChannels: ["wechat", "csdn", "juejin", "zhihu_toutiao_general"],
    enabledProducts: ["joto_brand", "weike_guardrails"],
    productPlans,
    currentRole: "workbench_operator",
    finalReviewMode: "default_final",
    geoPlatforms: ["DeepSeek", "豆包", "通义千问"],
    logMode: "demo_csv",
    updatedAt: nowIso()
  };
}

function createPromptVersionRecord(template: (typeof promptTemplates)[number], overrides: Partial<PromptVersionRecord> = {}): PromptVersionRecord {
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    previousVersion: "v2.9.0",
    usedAt: template.usedAt,
    inputContract: [...template.inputContract],
    outputContract: [...template.outputContract],
    failureRules: [...template.failureRules],
    status: "active",
    releaseNote: `${template.name} 当前用于 V4 可控 AI 工作流，只展示输入输出契约和失败规则，不展示 Prompt 原文。`,
    rollbackPolicy: "仅工作台运营或产品 owner 可发起回滚；回滚会写入审计记录，并影响后续生成来源版本。",
    updatedAt: nowIso(),
    ...overrides
  };
}

function createInitialPromptVersions(): PromptVersionRecord[] {
  return promptTemplates.map((template) => createPromptVersionRecord(template));
}

function normalizePromptVersions(value?: PromptVersionRecord[]): PromptVersionRecord[] {
  const incoming = Array.isArray(value) ? value : [];
  const byId = new Map(incoming.map((item) => [item.id, item]));

  return promptTemplates.map((template) => {
    const current = byId.get(template.id);
    const status: PromptVersionStatus = current?.status === "rolled_back" ? "rolled_back" : "active";

    return createPromptVersionRecord(template, {
      ...current,
      id: template.id,
      name: current?.name || template.name,
      version: current?.version || template.version,
      previousVersion: current?.previousVersion || "v2.9.0",
      usedAt: current?.usedAt || template.usedAt,
      inputContract: current?.inputContract?.length ? current.inputContract : template.inputContract,
      outputContract: current?.outputContract?.length ? current.outputContract : template.outputContract,
      failureRules: current?.failureRules?.length ? current.failureRules : template.failureRules,
      status,
      releaseNote:
        current?.releaseNote ||
        `${template.name} 当前用于 V4 可控 AI 工作流，只展示输入输出契约和失败规则，不展示 Prompt 原文。`,
      rollbackPolicy:
        current?.rollbackPolicy ||
        "仅工作台运营或产品 owner 可发起回滚；回滚会写入审计记录，并影响后续生成来源版本。",
      updatedAt: current?.updatedAt || nowIso()
    });
  });
}

function getActivePromptVersion(state: Pick<WorkbenchState, "promptVersions">, id: (typeof promptTemplates)[number]["id"]) {
  return state.promptVersions.find((item) => item.id === id) || createPromptVersionRecord(promptTemplates.find((item) => item.id === id) || promptTemplates[0]);
}

export function createInitialWorkbenchState(): WorkbenchState {
  const createdAt = nowIso();

  return {
    runtime: {
      storage: "local_json",
      statePath,
      initializedAt: createdAt
    },
    weeklyPlan: clone(seedWeeklyPlan),
    workspaceSetting: createInitialWorkspaceSetting(),
    tasks: clone(seedTasks),
    drafts: clone(seedDrafts),
    publishRecords: clone(seedPublishRecords),
    platformDraftVariants: [],
    distributionTargets: [],
    publishSchedules: [],
    publishAttempts: [],
    blogArticles: clone(seedBlogArticles),
    geoResults: normalizeGeoResults(clone(seedGeoResults)),
    botVisits: clone(seedBotVisits),
    knowledgeBases: clone(seedKnowledgeBases).map(normalizeKnowledgeBase),
    distilledTerms: normalizeDistilledTerms(),
    distilledTermExtractionRules: normalizeDistilledTermExtractionRules(),
    distilledTermRuleDrafts: [],
    promptVersions: createInitialPromptVersions(),
    weeklyReportSnapshots: [],
    weeklyReportSuggestionDecisions: [],
    pipelineRuns: [],
    auditLog: [
      {
        id: createId("event"),
        event: "state_initialized",
        message: "Initialized local JSON workbench state from seed data.",
        createdAt
      }
    ]
  };
}

export function normalizeWorkbenchState(value: Partial<WorkbenchState>): WorkbenchState {
  const base = createInitialWorkbenchState();
  const rawTasks = value.tasks || base.tasks;
  const rawWeeklyPlan = value.weeklyPlan || base.weeklyPlan;
  const rawWorkspaceSetting = value.workspaceSetting || base.workspaceSetting;
  const normalizedChannels = coerceChannels(rawWorkspaceSetting.enabledChannels) || base.workspaceSetting.enabledChannels;
  const normalizedProducts = coerceProducts(rawWorkspaceSetting.enabledProducts) || base.workspaceSetting.enabledProducts;
  const normalizedProductPlans = normalizeProductPlans(rawWorkspaceSetting.productPlans, normalizedProducts, normalizedChannels);
  const fallbackDailyCount = rawWeeklyPlan.targetTotalCount ? Math.max(1, Math.ceil(rawWeeklyPlan.targetTotalCount / 5)) : 0;
  const publishMatrix =
    rawWeeklyPlan.publishMatrix?.length
      ? normalizePublishMatrix({ publishMatrix: rawWeeklyPlan.publishMatrix, days: 7, dailyCount: fallbackDailyCount }, rawWeeklyPlan.weekStart)
      : createDefaultPublishMatrix(rawWeeklyPlan.weekStart, 5, fallbackDailyCount).map((item) => {
          const plannedCount = rawTasks.filter((task) => task.publishDate === item.date).length;

          return plannedCount ? { ...item, plannedCount, paused: false } : item;
        });

  const normalizedDrafts = value.drafts || base.drafts;
  const normalizedPublishRecords = value.publishRecords || base.publishRecords;
  const normalizedPlatformDraftVariants = normalizePlatformDraftVariants(value.platformDraftVariants || base.platformDraftVariants);
  const normalizedDistributionTargets = normalizeDistributionTargets(value.distributionTargets || base.distributionTargets);
  const normalizedPublishSchedules = normalizePublishSchedules(value.publishSchedules || base.publishSchedules);
  const normalizedPublishAttempts = normalizePublishAttempts(value.publishAttempts || base.publishAttempts);

  return {
    ...base,
    ...value,
    runtime: {
      ...base.runtime,
      ...(value.runtime || {}),
      storage: "local_json",
      statePath
    },
    weeklyPlan: {
      ...rawWeeklyPlan,
      targetTotalCount: publishMatrix.reduce((sum, item) => sum + item.plannedCount, 0) || rawWeeklyPlan.targetTotalCount,
      publishMatrix,
      productPlans: normalizeProductPlans(rawWeeklyPlan.productPlans || normalizedProductPlans, normalizedProducts, normalizedChannels)
    },
    workspaceSetting: value.workspaceSetting
      ? {
          ...base.workspaceSetting,
          ...value.workspaceSetting,
          enabledChannels: normalizedChannels,
          enabledProducts: normalizedProducts,
          productPlans: normalizedProductPlans,
          currentRole: coerceWorkspaceRole(value.workspaceSetting.currentRole, base.workspaceSetting.currentRole),
          geoPlatforms: coerceGeoPlatforms(value.workspaceSetting.geoPlatforms) || base.workspaceSetting.geoPlatforms,
          knowledgeRagConfig: normalizeKnowledgeRagConfig(value.workspaceSetting.knowledgeRagConfig)
        }
      : base.workspaceSetting,
    tasks: rawTasks.map((task) => ({
      ...task,
      titleReason: task.titleReason || task.qaSummary || "由周计划生成规则给出，用于补强本周内容增长入口。",
      riskNote: task.riskNote || "暂无高风险；确认前仍需检查标题是否过泛、证据是否充足。",
      evidenceNeed:
        task.evidenceNeed ||
        (task.product === "joto_brand"
          ? "需要 JOTO 企业级交付能力、Dify 企业版服务经验、长期运维流程或官网可信资料。"
          : "需要唯客 AI 护栏的风险识别、输出安全、审计留痕或落地流程资料。"),
      confidence: typeof task.confidence === "number" ? task.confidence : 0.76,
      locked: Boolean(task.locked)
    })),
    drafts: normalizedDrafts,
    publishRecords: normalizedPublishRecords,
    platformDraftVariants: normalizedPlatformDraftVariants,
    distributionTargets: normalizedDistributionTargets,
    publishSchedules: normalizedPublishSchedules,
    publishAttempts: normalizedPublishAttempts,
    blogArticles: value.blogArticles || base.blogArticles,
    geoResults: normalizeGeoResults(value.geoResults || base.geoResults),
    botVisits: value.botVisits || base.botVisits,
    knowledgeBases: (value.knowledgeBases || base.knowledgeBases).map(normalizeKnowledgeBase),
    distilledTerms: normalizeDistilledTerms(value.distilledTerms || base.distilledTerms),
    distilledTermExtractionRules: normalizeDistilledTermExtractionRules(value.distilledTermExtractionRules || base.distilledTermExtractionRules),
    distilledTermRuleDrafts: normalizeDistilledTermRuleDrafts(value.distilledTermRuleDrafts || base.distilledTermRuleDrafts),
    promptVersions: normalizePromptVersions(value.promptVersions || base.promptVersions),
    weeklyReportSnapshots: value.weeklyReportSnapshots || base.weeklyReportSnapshots,
    weeklyReportSuggestionDecisions: value.weeklyReportSuggestionDecisions || base.weeklyReportSuggestionDecisions,
    pipelineRuns: value.pipelineRuns || base.pipelineRuns,
    auditLog: value.auditLog || base.auditLog
  };
}

function isTaskInWeeklyPlan(task: Pick<ContentTask, "weeklyPlanId" | "publishDate">, weeklyPlan: WeeklyPlan) {
  return task.weeklyPlanId === weeklyPlan.id || isDateInWeek(task.publishDate, weeklyPlan.weekStart);
}

export function getCurrentWeeklyTasks(state: Pick<WorkbenchState, "tasks" | "weeklyPlan">) {
  return state.tasks.filter((task) => isTaskInWeeklyPlan(task, state.weeklyPlan));
}

function createRolledWeeklyPlan(state: WorkbenchState, weekStart: string): WeeklyPlan {
  const productPlans = normalizeProductPlans(
    state.workspaceSetting.productPlans,
    state.workspaceSetting.enabledProducts,
    state.workspaceSetting.enabledChannels
  );
  const productQuotaTotal = productPlans.filter((plan) => plan.enabled).reduce((sum, plan) => sum + plan.weeklyQuota, 0);
  const publishMatrix = createDefaultPublishMatrix(weekStart, state.workspaceSetting.defaultWeeklyDays, state.workspaceSetting.defaultDailyCount);
  const matrixTotal = publishMatrix.reduce((sum, item) => sum + item.plannedCount, 0);

  return {
    id: `wp-${weekStart}`,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    targetTotalCount: productQuotaTotal || matrixTotal,
    status: "draft",
    publishMatrix,
    productPlans
  };
}

function ensureCurrentWeeklyPlan(state: WorkbenchState): { state: WorkbenchState; changed: boolean } {
  const { today, weekStart } = getCurrentWorkbenchWeek();
  const furthestPreparedWeekStart = addDays(weekStart, 7);
  const hasExpiredPlan = today > state.weeklyPlan.weekEnd;
  const hasInvalidFuturePlan = state.weeklyPlan.weekStart > furthestPreparedWeekStart;

  if (!hasExpiredPlan && !hasInvalidFuturePlan) {
    return { state, changed: false };
  }

  const previousWeekStart = state.weeklyPlan.weekStart;
  const nextState: WorkbenchState = {
    ...state,
    weeklyPlan: createRolledWeeklyPlan(state, weekStart)
  };

  appendAuditEvent(
    nextState,
    "weekly_plan_auto_rolled",
    `Auto rolled active weekly plan from ${previousWeekStart} to ${weekStart}; reason=${hasInvalidFuturePlan ? "invalid_future_week" : "expired_week"}; historical tasks and publish records were preserved.`
  );

  return { state: nextState, changed: true };
}

export function readWorkbenchState(): WorkbenchState {
  const repository = getWorkbenchRepository(createInitialWorkbenchState, normalizeWorkbenchState);
  const state = repository.read();
  const current = ensureCurrentWeeklyPlan(state);

  if (current.changed) {
    return repository.write(current.state);
  }

  return state;
}

export function writeWorkbenchState(state: WorkbenchState): WorkbenchState {
  return getWorkbenchRepository(createInitialWorkbenchState, normalizeWorkbenchState).write(state);
}

function appendAuditEvent(state: WorkbenchState, event: string, message: string) {
  state.auditLog = [
    {
      id: createId("event"),
      event,
      message,
      createdAt: nowIso()
    },
    ...state.auditLog
  ].slice(0, 100);
}

function saveWithEvent(state: WorkbenchState, event: string, message: string) {
  appendAuditEvent(state, event, message);
  return writeWorkbenchState(state);
}

export function getPromptVersionDetail(id: string): WorkflowResult<{ promptVersion: PromptVersionRecord }> {
  const state = readWorkbenchState();
  const promptVersion = state.promptVersions.find((item) => item.id === id);

  if (!promptVersion) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 Prompt 版本：${id}`
    };
  }

  return {
    ok: true,
    status: "success",
    message: "Prompt 版本详情已读取；不会返回 Prompt 原文或 trace。",
    data: { promptVersion }
  };
}

export function rollbackPromptVersion(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ promptVersion: PromptVersionRecord }> {
  const state = readWorkbenchState();
  const index = state.promptVersions.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 Prompt 版本：${id}`
    };
  }

  const current = state.promptVersions[index];

  if (!current.previousVersion) {
    return {
      ok: false,
      status: "failed",
      message: "当前 Prompt 版本没有可回滚的上一版本。"
    };
  }

  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim()
      : "工作台运营在 AI 配置页发起回滚，用于恢复上一版稳定口径。";
  const promptVersion: PromptVersionRecord = {
    ...current,
    version: current.previousVersion,
    previousVersion: current.version,
    status: "rolled_back",
    rollbackReason: reason,
    rolledBackAt: nowIso(),
    updatedAt: nowIso(),
    releaseNote: `${current.name} 已回滚到 ${current.previousVersion}；后续生成记录会使用该版本号。`
  };

  state.promptVersions[index] = promptVersion;
  saveWithEvent(state, "prompt_version_rolled_back", `Rolled back prompt ${id} from ${current.version} to ${promptVersion.version}.`);

  return {
    ok: true,
    status: "success",
    message: `Prompt「${promptVersion.name}」已回滚到 ${promptVersion.version}。`,
    data: { promptVersion }
  };
}

function shouldTreatPipelineStepAsFatal(result: Pick<WorkflowResult<unknown>, "ok" | "status">) {
  return !result.ok && result.status !== "pending_config" && result.status !== "pending_input";
}

function summarizePipelineStep(name: PipelineStepResult["name"], result: WorkflowResult<unknown>): PipelineStepResult {
  return {
    name,
    ok: result.ok,
    status: result.status,
    message: result.message,
    missingConfig: result.missingConfig,
    fatal: shouldTreatPipelineStepAsFatal(result)
  };
}

function addDays(dateText: string, offset: number) {
  return addDateDays(dateText, offset);
}

function normalizeReportWeek(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : fallback;
}

function getWeekFromWeeklyPlanId(weeklyPlanId: string | undefined) {
  const match = /^wp-(\d{4}-\d{2}-\d{2})/.exec(weeklyPlanId || "");
  return match?.[1];
}

function getTaskSourceWeek(task: Pick<ContentTask, "weeklyPlanId" | "publishDate"> | undefined, fallbackWeek: string) {
  return getWeekFromWeeklyPlanId(task?.weeklyPlanId) || fallbackWeek;
}

function buildPublishRecordWeekFields(state: WorkbenchState, draft: Pick<ArticleDraft, "taskId">) {
  const task = state.tasks.find((item) => item.id === draft.taskId);

  return {
    plannedPublishDate: task?.publishDate,
    sourceWeek: getTaskSourceWeek(task, state.weeklyPlan.weekStart)
  };
}

function createDefaultPublishMatrix(weekStart: string, days: number, dailyCount: number): WeeklyPublishMatrixDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const active = index < days;

    return {
      date,
      weekday: getWeekdayLabel(date),
      plannedCount: active ? dailyCount : 0,
      paused: !active,
      locked: false,
      source: "system_default"
    };
  });
}

function normalizePublishMatrix(input: GenerateWeeklyPlanInput, weekStart: string) {
  const days = clampNumber(input.days, 5, 1, 7);
  const dailyCount = clampNumber(input.dailyCount, 3, 0, 10);
  const matrixInput = Array.isArray(input.publishMatrix) ? input.publishMatrix : undefined;
  const defaultMatrix = createDefaultPublishMatrix(weekStart, days, dailyCount);

  if (!matrixInput?.length) {
    return defaultMatrix;
  }

  return defaultMatrix.map((fallback, index) => {
    const sourceItem = matrixInput.find((item) => item.date === fallback.date) || matrixInput[index] || {};
    const plannedCount = clampNumber(sourceItem.plannedCount, fallback.plannedCount, 0, 10);
    const paused = typeof sourceItem.paused === "boolean" ? sourceItem.paused : plannedCount === 0;
    const locked = typeof sourceItem.locked === "boolean" ? sourceItem.locked : false;
    const source = sourceItem.source === "manual" || sourceItem.source === "ai_suggested" ? sourceItem.source : fallback.source;

    return {
      date: typeof sourceItem.date === "string" && sourceItem.date.trim() ? sourceItem.date.trim() : fallback.date,
      weekday: typeof sourceItem.weekday === "string" && sourceItem.weekday.trim() ? sourceItem.weekday.trim() : fallback.weekday,
      plannedCount: paused ? 0 : plannedCount,
      paused,
      locked,
      source
    };
  });
}

function getPublishMatrixIssues(matrix: WeeklyPublishMatrixDay[]): PublishMatrixIssue[] {
  const issues: PublishMatrixIssue[] = [];
  const activeTotal = matrix.reduce((sum, item) => sum + item.plannedCount, 0);

  if (activeTotal <= 0) {
    issues.push({
      code: "empty_total",
      level: "error",
      message: "全周发布量不能为 0，请至少保留 1 篇计划。"
    });
  }

  for (const item of matrix) {
    if (!item.paused && item.plannedCount > 5) {
      issues.push({
        code: "single_day_too_high",
        level: "warning",
        message: `${item.weekday} 单日发布量超过 5 篇，建议确认是否为特殊活动排期。`,
        date: item.date,
        weekday: item.weekday
      });
    }

    if (item.locked && item.source === "ai_suggested") {
      issues.push({
        code: "locked_ai_suggested",
        level: "warning",
        message: `${item.weekday} 已锁定但仍显示 AI 建议来源，建议人工确认后再生成。`,
        date: item.date,
        weekday: item.weekday
      });
    }
  }

  return issues;
}

function createWeeklyPlanSignal(
  key: WeeklyPlanGenerationSignal["key"],
  label: string,
  count: number,
  usedSummary: string,
  missingSummary: string,
  status: WeeklyPlanGenerationSignal["status"] = count > 0 ? "used" : "missing"
): WeeklyPlanGenerationSignal {
  return {
    key,
    label,
    status,
    count,
    summary: count > 0 ? usedSummary : missingSummary
  };
}

function buildWeeklyPlanGenerationSource(
  state: WorkbenchState,
  template: Pick<PromptVersionRecord, "version">,
  matrixIssues: PublishMatrixIssue[],
  mode: WeeklyPlanGenerationSource["mode"] = "local_rule"
): WeeklyPlanGenerationSource {
  const enabledKnowledgeCount = state.knowledgeBases.filter((item) => item.status === "enabled").length;
  const activeRulePackageCount = state.knowledgeBases.filter((item) => item.productExpressionRuleDraft?.status === "active").length;
  const activeDistilledTermCount = state.distilledTerms.filter((item) => item.status === "active" && item.validationStatus !== "disabled").length;
  const geoGapCount = state.geoResults.filter((item) => item.executionStatus !== "failed" && (!item.mentionedJoto || !item.citedOfficialUrl)).length;
  const blogDiagnosisCount = state.blogArticles.filter((item) => item.seoIssueCount > 0 || item.geoResult !== "hit" || item.candidateStatus === "candidate").length;
  const weeklyReportSuggestionCount = state.weeklyReportSuggestionDecisions.filter((item) => item.status === "adopted" || item.status === "partially_adopted").length;

  return {
    mode,
    promptVersion: template.version,
    generatedAt: nowIso(),
    matrixIssueCount: matrixIssues.length,
    signals: [
      createWeeklyPlanSignal(
        "knowledge_base",
        "知识库资料",
        enabledKnowledgeCount,
        `已参考 ${enabledKnowledgeCount} 个启用资料，用于补充选题背景和证据方向。`,
        "暂无启用资料，本次计划主要依赖默认规则和已有配置。"
      ),
      createWeeklyPlanSignal(
        "product_expression",
        "产品表达规则包",
        activeRulePackageCount,
        `已参考 ${activeRulePackageCount} 个生效规则包，用于约束产品表达边界。`,
        "暂无生效规则包，建议先在知识库详情页确认产品表达规则。"
      ),
      createWeeklyPlanSignal(
        "distilled_terms",
        "蒸馏词池",
        activeDistilledTermCount,
        `已参考 ${activeDistilledTermCount} 个可用蒸馏词，用于分配主蒸馏词和来源问题。`,
        "暂无可用蒸馏词，标题语义会更依赖默认问题模板。"
      ),
      createWeeklyPlanSignal(
        "geo_gap",
        "GEO 问题缺口",
        geoGapCount,
        `发现 ${geoGapCount} 个 GEO 缺口，可用于补强品牌提及或官网引用。`,
        "本次没有明显 GEO 缺口信号。"
      ),
      createWeeklyPlanSignal(
        "blog_diagnosis",
        "官网博客诊断",
        blogDiagnosisCount,
        `发现 ${blogDiagnosisCount} 个博客诊断或候选信号，可用于补内容入口。`,
        "本次没有可用博客诊断信号。",
        blogDiagnosisCount > 0 ? "available" : "missing"
      ),
      createWeeklyPlanSignal(
        "weekly_report",
        "周报建议",
        weeklyReportSuggestionCount,
        `已读取 ${weeklyReportSuggestionCount} 条已采纳或部分采纳的周报建议。`,
        "暂无已采纳的周报建议，本次不使用周报动作信号。",
        weeklyReportSuggestionCount > 0 ? "available" : "missing"
      )
    ]
  };
}

interface WeeklyPlanTaskSignal {
  key: WeeklyPlanGenerationSignal["key"];
  label: string;
  sourceProblem: string;
  summary: string;
  referenceId?: string;
  primaryDistilledTerm?: string;
  product?: ProductKey;
  contentType?: ContentType;
}

function getWeeklyPlanTaskSignals(state: WorkbenchState): WeeklyPlanTaskSignal[] {
  const distilledTermSignals = state.distilledTerms
    .filter((item) => item.status === "active" && item.validationStatus === "auto_validated" && !item.archivedAt)
    .sort((left, right) => (right.generatedAt || "").localeCompare(left.generatedAt || ""))
    .slice(0, 8)
    .map((item): WeeklyPlanTaskSignal => ({
      key: "distilled_terms",
      label: "蒸馏词池",
      sourceProblem: item.sourceQuestion || `围绕蒸馏词「${item.term}」补强用户问题入口。`,
      summary: item.sourceQuestion
        ? `来自搜索问题或知识库自动入池：${item.sourceQuestion}`
        : `来自已入池蒸馏词「${item.term}」，用于分配主蒸馏词和来源问题。`,
      referenceId: item.id,
      primaryDistilledTerm: item.term,
      product: item.product,
      contentType: item.coveredContentTypes?.[0]
    }));
  const weeklyReportSignals = state.weeklyReportSuggestionDecisions
    .filter((item) => item.status === "adopted" || item.status === "partially_adopted")
    .slice(0, 6)
    .map((item): WeeklyPlanTaskSignal => ({
      key: "weekly_report",
      label: "周报建议",
      sourceProblem: item.suggestion,
      summary: `来自周报建议：${item.suggestion}`,
      referenceId: item.id
    }));
  const geoSignals = state.geoResults
    .filter((item) => item.executionStatus !== "failed" && (!item.mentionedJoto || !item.citedOfficialUrl))
    .slice(0, 6)
    .map((item): WeeklyPlanTaskSignal => ({
      key: "geo_gap",
      label: "GEO 问题缺口",
      sourceProblem: `GEO 缺口：${item.prompt}`,
      summary: `${item.platform} 下未形成稳定品牌提及或官网引用。`,
      referenceId: item.id
    }));
  const blogSignals = state.blogArticles
    .filter((item) => item.seoIssueCount > 0 || item.geoResult !== "hit" || item.candidateStatus === "candidate")
    .slice(0, 6)
    .map((item): WeeklyPlanTaskSignal => ({
      key: "blog_diagnosis",
      label: "官网博客诊断",
      sourceProblem: `官网博客问题：${item.title || item.url}`,
      summary: item.candidateReason || `官网博客存在 ${item.seoIssueCount} 个 SEO/GEO 问题。`,
      referenceId: item.id
    }));
  const knowledgeSignals = state.knowledgeBases
    .filter((item) => item.status === "enabled")
    .slice(0, 4)
    .map((item): WeeklyPlanTaskSignal => ({
      key: "knowledge_base",
      label: "知识库资料",
      sourceProblem: `知识库资料补强：${item.usageScope || item.name}`,
      summary: `来自知识库「${item.name}」的资料用途：${item.usageScope || "未填写"}。`,
      referenceId: item.id
    }));

  return [...distilledTermSignals, ...weeklyReportSignals, ...geoSignals, ...blogSignals, ...knowledgeSignals];
}

function pickWeeklyPlanTaskSignal(state: WorkbenchState, index: number) {
  const signals = getWeeklyPlanTaskSignals(state);
  return signals.length ? signals[index % signals.length] : undefined;
}

function buildContentTaskTitleSourceAttributions(
  state: Pick<WorkbenchState, "knowledgeBases">,
  task: ContentTask,
  input: {
    matrixDay?: WeeklyPublishMatrixDay;
    businessSignal?: WeeklyPlanTaskSignal;
    promptVersion?: string;
  } = {}
): ContentTaskTitleSourceAttribution[] {
  const attributions: ContentTaskTitleSourceAttribution[] = [];

  if (input.businessSignal) {
    attributions.push({
      key: input.businessSignal.key,
      label: input.businessSignal.label,
      role: "primary",
      summary: input.businessSignal.summary,
      referenceId: input.businessSignal.referenceId
    });
  }

  if (input.matrixDay) {
    attributions.push({
      key: "publish_matrix",
      label: "发布矩阵",
      role: "primary",
      summary: `${input.matrixDay.weekday} ${input.matrixDay.date} 计划发布 ${input.matrixDay.plannedCount} 篇${input.matrixDay.locked ? "，该日期已人工锁定" : ""}。`
    });
  }

  const ruleSelection = getProductExpressionRuleSelection(state, task);

  if (ruleSelection) {
    attributions.push({
      key: "product_expression",
      label: "产品表达规则包",
      role: "supporting",
      summary: `使用「${ruleSelection.source}」${ruleSelection.version} 约束产品表达边界。`,
      referenceId: `${ruleSelection.source}@${ruleSelection.version}`
    });
  }

  if (task.primaryDistilledTerm) {
    attributions.push({
      key: "distilled_terms",
      label: "蒸馏词池",
      role: "supporting",
      summary: `围绕主蒸馏词「${task.primaryDistilledTerm}」生成标题和来源问题。`
    });
  }

  attributions.push({
    key: "system_rule",
    label: "系统规则",
    role: "supporting",
    summary: `渠道、产品、内容类型由当前启用配置和内容类型轮换规则决定${input.promptVersion ? `，生成规则版本 ${input.promptVersion}` : ""}。`
  });

  return attributions.slice(0, 6);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function coerceChannels(value: unknown): ChannelKey[] | undefined {
  const allowed: ChannelKey[] = ["wechat", "csdn", "juejin", "zhihu_toutiao_general"];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const channels = value.filter((item): item is ChannelKey => allowed.includes(item as ChannelKey));
  return channels.length ? channels : undefined;
}

function getDefaultProductWeeklyQuota(product: ProductKey) {
  return product === "joto_brand" ? 5 : 10;
}

function createDefaultProductPlans(products: ProductKey[], channels: ChannelKey[]): ProductPlanConfig[] {
  const fallbackChannels: ChannelKey[] = channels.length ? channels : ["wechat"];

  return products.map((product) => ({
    product,
    weeklyQuota: getDefaultProductWeeklyQuota(product),
    channels: fallbackChannels,
    enabled: true
  }));
}

function coerceProducts(value: unknown): ProductKey[] | undefined {
  const allowed: ProductKey[] = ["joto_brand", "weike_guardrails"];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const products = value.filter((item): item is ProductKey => allowed.includes(item as ProductKey));
  return products.length ? products : undefined;
}

function coerceStringIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)));
  return ids.length ? ids : undefined;
}

function getBoundKnowledgeBaseIds(value: { knowledgeBaseIds?: string[]; knowledgeBaseId?: string }): string[] {
  const ids = coerceStringIds(value.knowledgeBaseIds);

  if (ids?.length) {
    return ids;
  }

  return typeof value.knowledgeBaseId === "string" && value.knowledgeBaseId.trim() ? [value.knowledgeBaseId.trim()] : [];
}

function normalizeProductPlans(value: unknown, products: ProductKey[], channels: ChannelKey[]): ProductPlanConfig[] {
  const source = Array.isArray(value) ? value : [];
  const fallbackPlans = createDefaultProductPlans(products, channels);

  return products.map((product) => {
    const existing = source.find((item) => item && typeof item === "object" && (item as Partial<ProductPlanConfig>).product === product) as Partial<ProductPlanConfig> | undefined;
    const fallback = fallbackPlans.find((item) => item.product === product) || {
      product,
      weeklyQuota: getDefaultProductWeeklyQuota(product),
      channels,
      enabled: true
    };
    const planChannels = coerceChannels(existing?.channels) || fallback.channels || channels;
    const knowledgeBaseIds = getBoundKnowledgeBaseIds(existing || {});

    return {
      product,
      weeklyQuota: clampNumber(existing?.weeklyQuota, fallback.weeklyQuota, 0, 50),
      channels: planChannels.length ? planChannels : ["wechat"],
      knowledgeBaseIds: knowledgeBaseIds.length ? knowledgeBaseIds : undefined,
      knowledgeBaseId: knowledgeBaseIds[0],
      productExpressionRulePackageId:
        typeof existing?.productExpressionRulePackageId === "string" && existing.productExpressionRulePackageId.trim()
          ? existing.productExpressionRulePackageId.trim()
          : undefined,
      enabled: typeof existing?.enabled === "boolean" ? existing.enabled : fallback.enabled
    };
  });
}

function coerceWorkspaceRole(value: unknown, fallback: WorkspaceRole): WorkspaceRole {
  return workspaceRoles.includes(value as WorkspaceRole) ? (value as WorkspaceRole) : fallback;
}

function coerceGeoPlatforms(value: unknown): WorkspaceSetting["geoPlatforms"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const platforms = value.map(normalizeGeoPlatformName).filter((item): item is GeoPlatformName => Boolean(item));
  return platforms.length ? platforms : undefined;
}

function coerceKnowledgeBaseType(value: unknown, fallback: KnowledgeBaseType): KnowledgeBaseType {
  if (value === "source_site") {
    return "custom";
  }

  const allowed: KnowledgeBaseType[] = ["brand", "product", "official_blog", "channel_history", "competitor", "custom"];
  return allowed.includes(value as KnowledgeBaseType) ? (value as KnowledgeBaseType) : fallback;
}

function coerceKnowledgeBaseTrustLevel(value: unknown, fallback: KnowledgeBaseTrustLevel): KnowledgeBaseTrustLevel {
  const allowed: KnowledgeBaseTrustLevel[] = ["highest", "high", "medium", "reference"];
  return allowed.includes(value as KnowledgeBaseTrustLevel) ? (value as KnowledgeBaseTrustLevel) : fallback;
}

function coerceKnowledgeBaseStatus(value: unknown, fallback: KnowledgeBaseStatus): KnowledgeBaseStatus {
  const allowed: KnowledgeBaseStatus[] = ["enabled", "disabled"];
  return allowed.includes(value as KnowledgeBaseStatus) ? (value as KnowledgeBaseStatus) : fallback;
}

function coerceKnowledgeSourceType(value: unknown, fallback: KnowledgeSourceType): KnowledgeSourceType {
  const allowed: KnowledgeSourceType[] = ["url", "markdown", "pdf", "docx", "manual", "auto_crawl"];
  return allowed.includes(value as KnowledgeSourceType) ? (value as KnowledgeSourceType) : fallback;
}

function normalizeProductExpressionRuleSnapshot(snapshot: unknown): ProductExpressionRuleSnapshot | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }

  const value = snapshot as Partial<ProductExpressionRuleSnapshot>;

  if (typeof value.version !== "string" || !value.version.trim()) {
    return undefined;
  }

  return {
    version: value.version.trim(),
    status: value.status === "draft" || value.status === "archived" ? value.status : "active",
    sourceChunkCount: Number.isFinite(Number(value.sourceChunkCount)) ? Number(value.sourceChunkCount) : 0,
    generatedAt: typeof value.generatedAt === "string" && value.generatedAt.trim() ? value.generatedAt.trim() : undefined,
    activatedAt: typeof value.activatedAt === "string" && value.activatedAt.trim() ? value.activatedAt.trim() : undefined,
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : "上一版本未保存摘要。",
    doExpressions: Array.isArray(value.doExpressions) ? value.doExpressions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    dontExpressions: Array.isArray(value.dontExpressions) ? value.dontExpressions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    boundaryNotes: Array.isArray(value.boundaryNotes) ? value.boundaryNotes.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    distilledTermSuggestions: Array.isArray(value.distilledTermSuggestions) ? value.distilledTermSuggestions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
  };
}

function buildProductExpressionRuleSnapshot(draft?: ProductExpressionRuleDraft): ProductExpressionRuleSnapshot | undefined {
  if (!draft) {
    return undefined;
  }

  return {
    version: draft.version,
    status: draft.status,
    sourceChunkCount: draft.sourceChunkCount,
    generatedAt: draft.generatedAt,
    activatedAt: draft.activatedAt,
    summary: draft.summary,
    doExpressions: [...draft.doExpressions],
    dontExpressions: [...draft.dontExpressions],
    boundaryNotes: [...draft.boundaryNotes],
    distilledTermSuggestions: [...draft.distilledTermSuggestions]
  };
}

function normalizeProductExpressionRuleDraft(
  draft: unknown,
  knowledgeBaseId: string,
  knowledgeBaseName: string,
  chunkCount: number,
  contentPreview: string,
  usageScope: string
): ProductExpressionRuleDraft | undefined {
  if (!draft || typeof draft !== "object") {
    return undefined;
  }

  const value = draft as Partial<ProductExpressionRuleDraft>;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `prd-${knowledgeBaseId}`,
    version: typeof value.version === "string" && value.version.trim() ? value.version : "v1-draft",
    status: value.status === "active" || value.status === "archived" ? value.status : "draft",
    previousVersion: typeof value.previousVersion === "string" && value.previousVersion.trim() ? value.previousVersion.trim() : undefined,
    previousSnapshot: normalizeProductExpressionRuleSnapshot(value.previousSnapshot),
    activatedAt: typeof value.activatedAt === "string" && value.activatedAt.trim() ? value.activatedAt.trim() : undefined,
    archivedAt: typeof value.archivedAt === "string" && value.archivedAt.trim() ? value.archivedAt.trim() : undefined,
    sourceKnowledgeBaseId: typeof value.sourceKnowledgeBaseId === "string" && value.sourceKnowledgeBaseId.trim() ? value.sourceKnowledgeBaseId : knowledgeBaseId,
    sourceKnowledgeBaseName: typeof value.sourceKnowledgeBaseName === "string" && value.sourceKnowledgeBaseName.trim() ? value.sourceKnowledgeBaseName : knowledgeBaseName,
    sourceChunkCount: Number.isFinite(Number(value.sourceChunkCount)) ? Number(value.sourceChunkCount) : chunkCount,
    generatedAt: typeof value.generatedAt === "string" && value.generatedAt.trim() ? value.generatedAt.trim() : undefined,
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.trim()
        : `基于 ${knowledgeBaseName} 和资料用途「${usageScope || "未填写"}」生成的产品表达规则草稿。`,
    doExpressions: Array.isArray(value.doExpressions) ? value.doExpressions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    dontExpressions: Array.isArray(value.dontExpressions) ? value.dontExpressions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    boundaryNotes: Array.isArray(value.boundaryNotes) ? value.boundaryNotes.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    distilledTermSuggestions: Array.isArray(value.distilledTermSuggestions) ? value.distilledTermSuggestions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
  };
}

function buildDefaultProductExpressionRuleDraft(
  knowledgeBaseId: string,
  knowledgeBaseName: string,
  chunkCount: number,
  contentPreview: string,
  usageScope: string,
  previousVersion?: string,
  previousSnapshot?: ProductExpressionRuleSnapshot
): ProductExpressionRuleDraft {
  const text = `${knowledgeBaseName} ${usageScope} ${contentPreview}`.toLowerCase();
  const doExpressions = [
    `围绕 ${knowledgeBaseName} 的真实资料表达，不用空泛形容词。`,
    usageScope ? `优先服务「${usageScope}」里定义的任务。` : "优先服务资料用途中定义的任务。"
  ];
  const dontExpressions: string[] = [];
  const boundaryNotes = [
    "只作为内容生成、质检和诊断的表达依据，不直接替代人工判断。",
    "如果资料用途发生变化，需要重新生成规则草稿版本。"
  ];
  const distilledTermSuggestions: string[] = [];

  if (text.includes("dify")) {
    doExpressions.push("表达时优先围绕 Dify 企业版、服务商能力和交付边界展开。");
    distilledTermSuggestions.push("Dify 企业版服务商", "Dify 服务商");
  }

  if (text.includes("护栏") || text.includes("安全")) {
    doExpressions.push("表达时优先围绕风险识别、输出安全和审计留痕展开。");
    distilledTermSuggestions.push("AI 护栏", "企业大模型安全");
  }

  if (text.includes("竞品")) {
    doExpressions.push("竞品资料只用于对比和差异化表达，不直接当作品牌事实。", "先明确差异，再写结论。" );
    dontExpressions.push("不要把竞品资料写成品牌事实。", "不要直接用竞品表述覆盖自有能力边界。");
    distilledTermSuggestions.push("竞品对比", "差异化选题");
  }

  if (text.includes("官网") || text.includes("博客")) {
    doExpressions.push("优先引用官网、官方博客和可追踪链接。", "表达时自然带出官网信源。" );
    distilledTermSuggestions.push("官网信源", "官方博客");
  }

  return {
    id: `prd-${knowledgeBaseId}`,
    version: previousVersion ? `v${Date.now()}-draft` : "v1-draft",
    status: "draft",
    previousVersion,
    previousSnapshot,
    sourceKnowledgeBaseId: knowledgeBaseId,
    sourceKnowledgeBaseName: knowledgeBaseName,
    sourceChunkCount: chunkCount,
    generatedAt: nowIso(),
    summary: `基于 ${knowledgeBaseName} 和资料用途「${usageScope || "未填写"}」生成的产品表达规则草稿。`,
    doExpressions,
    dontExpressions,
    boundaryNotes,
    distilledTermSuggestions: Array.from(new Set(distilledTermSuggestions)).slice(0, 6)
  };
}

function coerceKnowledgeChunkStatus(value: unknown, fallback: KnowledgeChunkStatus): KnowledgeChunkStatus {
  const allowed: KnowledgeChunkStatus[] = ["enabled", "disabled", "needs_review"];
  return allowed.includes(value as KnowledgeChunkStatus) ? (value as KnowledgeChunkStatus) : fallback;
}

function coerceKnowledgeSourceStatus(value: unknown, fallback: KnowledgeSourceStatus): KnowledgeSourceStatus {
  const allowed: KnowledgeSourceStatus[] = ["pending", "fetching", "parsed", "failed"];
  return allowed.includes(value as KnowledgeSourceStatus) ? (value as KnowledgeSourceStatus) : fallback;
}

function coerceKnowledgeFetchProvider(value: unknown, fallback: KnowledgeFetchProvider): KnowledgeFetchProvider {
  const allowed: KnowledgeFetchProvider[] = ["cache", "xcrawl", "proxy_fetch", "local_fetch", "manual", "site_import"];
  return allowed.includes(value as KnowledgeFetchProvider) ? (value as KnowledgeFetchProvider) : fallback;
}

function coerceKnowledgeCrawlFailureCode(value: unknown): KnowledgeCrawlFailureCode | undefined {
  const allowed: KnowledgeCrawlFailureCode[] = ["pending_config", "blocked", "timeout", "http_error", "empty_content", "parser_failed", "invalid_url"];
  return allowed.includes(value as KnowledgeCrawlFailureCode) ? (value as KnowledgeCrawlFailureCode) : undefined;
}

function coerceKnowledgeChunkingStrategy(value: unknown, fallback: KnowledgeChunkingStrategy): KnowledgeChunkingStrategy {
  const allowed: KnowledgeChunkingStrategy[] = ["rule", "auto", "semantic_llm"];
  return allowed.includes(value as KnowledgeChunkingStrategy) ? (value as KnowledgeChunkingStrategy) : fallback;
}

function coerceOptionalKnowledgeChunkingStrategy(value: unknown): KnowledgeChunkingStrategy | undefined {
  const allowed: KnowledgeChunkingStrategy[] = ["rule", "auto", "semantic_llm"];
  return allowed.includes(value as KnowledgeChunkingStrategy) ? (value as KnowledgeChunkingStrategy) : undefined;
}

function coerceKnowledgeRetrievalStrategy(value: unknown, fallback: KnowledgeRetrievalStrategy): KnowledgeRetrievalStrategy {
  const allowed: KnowledgeRetrievalStrategy[] = ["keyword", "hybrid", "vector"];
  return allowed.includes(value as KnowledgeRetrievalStrategy) ? (value as KnowledgeRetrievalStrategy) : fallback;
}

function coerceOptionalKnowledgeRetrievalStrategy(value: unknown): KnowledgeRetrievalStrategy | undefined {
  const allowed: KnowledgeRetrievalStrategy[] = ["keyword", "hybrid", "vector"];
  return allowed.includes(value as KnowledgeRetrievalStrategy) ? (value as KnowledgeRetrievalStrategy) : undefined;
}

function coerceKnowledgeChunkingModelProvider(value: unknown): KnowledgeChunkingModelProvider | undefined {
  const allowed: KnowledgeChunkingModelProvider[] = ["qwen", "doubao", "deepseek"];
  return allowed.includes(value as KnowledgeChunkingModelProvider) ? (value as KnowledgeChunkingModelProvider) : undefined;
}

function coerceKnowledgeEmbeddingModelProvider(value: unknown): KnowledgeEmbeddingModelProvider | undefined {
  const allowed: KnowledgeEmbeddingModelProvider[] = ["qwen_embedding", "doubao_embedding"];
  return allowed.includes(value as KnowledgeEmbeddingModelProvider) ? (value as KnowledgeEmbeddingModelProvider) : undefined;
}

function normalizeKnowledgeRagConfig(value: unknown): KnowledgeRagConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Partial<KnowledgeRagConfig>;
  const config: KnowledgeRagConfig = {
    chunkingStrategy: coerceOptionalKnowledgeChunkingStrategy(input.chunkingStrategy),
    chunkingModelProvider: coerceKnowledgeChunkingModelProvider(input.chunkingModelProvider),
    embeddingModelProvider: coerceKnowledgeEmbeddingModelProvider(input.embeddingModelProvider),
    retrievalStrategy: coerceOptionalKnowledgeRetrievalStrategy(input.retrievalStrategy),
    chunkSize: typeof input.chunkSize === "number" && Number.isFinite(input.chunkSize) ? Math.min(Math.max(Math.round(input.chunkSize), 200), 2000) : undefined,
    chunkOverlap:
      typeof input.chunkOverlap === "number" && Number.isFinite(input.chunkOverlap) ? Math.min(Math.max(Math.round(input.chunkOverlap), 0), 500) : undefined,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt.trim() : undefined
  };

  const hasConfig = Boolean(
    config.chunkingModelProvider ||
      config.embeddingModelProvider ||
      config.retrievalStrategy ||
      config.chunkSize ||
      config.chunkOverlap ||
      input.chunkingStrategy
  );

  return hasConfig ? config : undefined;
}

function coerceKnowledgeEmbeddingStatus(value: unknown, fallback: KnowledgeEmbeddingStatus): KnowledgeEmbeddingStatus {
  const allowed: KnowledgeEmbeddingStatus[] = ["not_required", "pending_config", "fallback_hash", "real_embedding", "failed"];
  return allowed.includes(value as KnowledgeEmbeddingStatus) ? (value as KnowledgeEmbeddingStatus) : fallback;
}

function estimateTokenCount(text: string) {
  const normalized = normalizeKnowledgeText(text);
  const latinMatches = normalized.match(/[a-z0-9][a-z0-9._+#-]{1,}/gi) || [];
  const cjkMatches = normalized.match(/[\u4e00-\u9fa5]/g) || [];
  return Math.max(12, latinMatches.length + Math.ceil(cjkMatches.length / 1.8));
}

function createContentHash(text: string) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function normalizeKnowledgeText(text: string) {
  return text
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, value: string) => {
    const normalized = value.toLowerCase();
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return named[normalized] || entity;
  });
}

function stripHtmlToText(html: string) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside|form|button)[\s\S]*?<\/\1>/gi, " ");
  const withBreaks = withoutNoise
    .replace(/<\/(h[1-6]|p|li|section|article|div|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return normalizeKnowledgeText(
    text
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

function extractHtmlTitle(html: string, fallback: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")) : "";
  return normalizeKnowledgeText(rawTitle || fallback).slice(0, 120) || fallback;
}

function isLoadingOnlyKnowledgeText(text: string) {
  const normalized = normalizeKnowledgeText(text);

  if (!normalized) {
    return true;
  }

  const loadingSignals = ["正在加载文章", "AI 实时生成中", "AI正在实时", "Loading", "loading"];
  const hasLoadingSignal = loadingSignals.some((signal) => normalized.includes(signal));
  const hasArticleSignal = /引言|正文|结语|作者|发布时间|AI安全|大模型安全|企业AI治理|阅读/.test(normalized);

  return hasLoadingSignal && !hasArticleSignal;
}

function isBlockedKnowledgeText(text: string) {
  const normalized = normalizeKnowledgeText(text).toLowerCase();
  return (
    normalized.includes("captcha") ||
    normalized.includes("ip address") ||
    normalized.includes("has been blocked") ||
    normalized.includes("异常的行为") ||
    normalized.includes("请完成 captcha 验证") ||
    normalized.includes("请解决 captcha 验证")
  );
}

function buildFallbackVector(text: string, dimensions = 24) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = (normalizeKnowledgeText(text).toLowerCase().match(/[a-z0-9][a-z0-9._+#-]{1,}|[\u4e00-\u9fa5]{2,}/g) || []).slice(0, 400);

  for (const token of tokens) {
    const index = Math.abs(Number.parseInt(createContentHash(`i:${token}`), 16)) % dimensions;
    const sign = Math.abs(Number.parseInt(createContentHash(`s:${token}`), 16)) % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(1 + token.length));
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

function getKnowledgeEmbeddingStatus(embeddingModel?: string): KnowledgeEmbeddingStatus {
  if (embeddingModel === "disabled") {
    return "not_required";
  }

  return "pending_config";
}

function normalizeKnowledgeSource(value: unknown, knowledgeBaseId: string, fallbackTitle: string, index: number): KnowledgeSource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Partial<KnowledgeSource>;
  const title = typeof source.title === "string" && source.title.trim() ? source.title.trim() : `${fallbackTitle} 来源 ${index + 1}`;
  const extractedText = normalizeKnowledgeText(source.extractedText || source.markdown || source.rawText || "");
  const markdown = normalizeKnowledgeText(source.markdown || extractedText);
  const status = coerceKnowledgeSourceStatus(source.status, extractedText ? "parsed" : "pending");
  const fetchProvider = coerceKnowledgeFetchProvider(source.fetchProvider, source.type === "url" ? "local_fetch" : "manual");
  const type: KnowledgeSourceTypeValue =
    source.type === "url" || source.type === "manual_text" || source.type === "legacy" ? source.type : fetchProvider === "manual" ? "manual_text" : "legacy";

  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : `source-${knowledgeBaseId}-${index + 1}`,
    knowledgeBaseId,
    type,
    title,
    url: typeof source.url === "string" && source.url.trim() ? source.url.trim() : undefined,
    rawText: typeof source.rawText === "string" && source.rawText.trim() ? normalizeKnowledgeText(source.rawText) : undefined,
    extractedText,
    markdown,
    status,
    fetchProvider,
    errorCode: coerceKnowledgeCrawlFailureCode(source.errorCode),
    errorMessage: typeof source.errorMessage === "string" && source.errorMessage.trim() ? source.errorMessage.trim() : undefined,
    addedAt: typeof source.addedAt === "string" && source.addedAt.trim() ? source.addedAt.trim() : nowIso(),
    parsedAt: typeof source.parsedAt === "string" && source.parsedAt.trim() ? source.parsedAt.trim() : extractedText ? nowIso() : undefined,
    contentHash: source.contentHash || createContentHash(`${title}\n${source.url || ""}\n${markdown || extractedText}`)
  };
}

function createLegacyKnowledgeSource(knowledgeBaseId: string, title: string, content: string, sourceUrl?: string): KnowledgeSource {
  const normalizedContent = normalizeKnowledgeText(content);
  const sourceTitle = sourceUrl ? `${title} / ${sourceUrl}` : title;

  return {
    id: `source-${knowledgeBaseId}-legacy`,
    knowledgeBaseId,
    type: "legacy",
    title: sourceTitle,
    url: sourceUrl,
    rawText: normalizedContent,
    extractedText: normalizedContent,
    markdown: normalizedContent,
    status: normalizedContent ? "parsed" : "pending",
    fetchProvider: sourceUrl ? "local_fetch" : "manual",
    addedAt: nowIso(),
    parsedAt: normalizedContent ? nowIso() : undefined,
    contentHash: createContentHash(`${sourceTitle}\n${normalizedContent}`)
  };
}

function createManualKnowledgeSource(knowledgeBaseId: string, title: string, content: string, addedAt = nowIso()): KnowledgeSource {
  const normalizedContent = normalizeKnowledgeText(content);

  return {
    id: createId("source"),
    knowledgeBaseId,
    type: "manual_text",
    title: title || "手动追加文本",
    rawText: normalizedContent,
    extractedText: normalizedContent,
    markdown: normalizedContent,
    status: normalizedContent ? "parsed" : "pending",
    fetchProvider: "manual",
    addedAt,
    parsedAt: normalizedContent ? addedAt : undefined,
    contentHash: createContentHash(`${title}\n${normalizedContent}`)
  };
}

function getConfiguredKnowledgeCrawlerLabel() {
  return getConfiguredKnowledgeCrawlers()
    .map((provider) => (provider === "xcrawl" ? "XCrawl" : provider === "proxy_fetch" ? "代理抓取" : "本地兜底"))
    .join(" -> ");
}

function createSiteImportPlanSource(
  knowledgeBaseId: string,
  title: string,
  url: string,
  content: string,
  addedAt = nowIso()
): KnowledgeSource {
  const normalizedContent = normalizeKnowledgeText(content);

  return {
    id: createId("source"),
    knowledgeBaseId,
    type: "url",
    title,
    url,
    rawText: normalizedContent,
    extractedText: normalizedContent,
    markdown: normalizedContent,
    status: "parsed",
    fetchProvider: "site_import",
    errorMessage: `预览阶段只识别站点入口和 sitemap；保存后后台会逐页按 ${getConfiguredKnowledgeCrawlerLabel()} 抓取正文。`,
    addedAt,
    parsedAt: addedAt,
    contentHash: createContentHash(`${title}\n${url}\n${normalizedContent}`)
  };
}

function isKnowledgeSiteImportPlaceholder(source: KnowledgeSource) {
  const content = normalizeKnowledgeText(source.markdown || source.extractedText || source.rawText || "");
  return (
    (source.fetchProvider === "manual" || source.fetchProvider === "site_import") &&
    (((content.includes("已识别为博客聚合页") || content.includes("已识别为站点入口")) && content.includes("保存后将启动后台全量导入任务")) ||
      content.includes("暂无内容预览，请通过统一导入补充资料"))
  );
}

function pickBetterKnowledgeSource(current: KnowledgeSource, next: KnowledgeSource) {
  if (current.status !== "parsed" && next.status === "parsed") {
    return next;
  }

  if (current.status === next.status) {
    const currentLength = normalizeKnowledgeText(current.markdown || current.extractedText || current.rawText || "").length;
    const nextLength = normalizeKnowledgeText(next.markdown || next.extractedText || next.rawText || "").length;
    return nextLength > currentLength ? next : current;
  }

  return current;
}

function dedupeKnowledgeSources(sources: KnowledgeSource[]) {
  const deduped: KnowledgeSource[] = [];
  const indexByKey = new Map<string, number>();

  for (const source of sources) {
    if (isKnowledgeSiteImportPlaceholder(source)) {
      continue;
    }

    const key = source.url ? `url:${source.url}` : `id:${source.id}`;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(source);
      continue;
    }

    deduped[existingIndex] = pickBetterKnowledgeSource(deduped[existingIndex], source);
  }

  return deduped;
}

function countParsedUrlSources(sources: KnowledgeSource[]) {
  return sources.filter((source) => source.status === "parsed" && Boolean(source.url)).length;
}

function countFailedUrlSources(sources: KnowledgeSource[]) {
  return sources.filter((source) => source.status === "failed" && Boolean(source.url)).length;
}

function collectKnownKnowledgeSourceUrls(sources: KnowledgeSource[], importedUrls: string[] = []) {
  return Array.from(
    new Set(
      [
        ...sources.map((source) => source.url).filter((url): url is string => Boolean(url)),
        ...importedUrls.filter((url) => typeof url === "string" && url.trim().length > 0)
      ]
    )
  );
}

function cloneCachedKnowledgeSource(source: KnowledgeSource, knowledgeBaseId: string, addedAt = nowIso()): KnowledgeSource {
  const text = normalizeKnowledgeText(source.markdown || source.extractedText || source.rawText || "");

  return {
    ...source,
    id: createId("source"),
    knowledgeBaseId,
    rawText: text,
    extractedText: text,
    markdown: text,
    status: "parsed",
    fetchProvider: "cache",
    addedAt,
    parsedAt: addedAt,
    errorCode: undefined,
    errorMessage: undefined,
    contentHash: createContentHash(`${source.url || source.title}\n${text}`)
  };
}

function findCachedParsedKnowledgeSource(rawUrl: string, state = readWorkbenchState()) {
  let normalizedUrl: string;

  try {
    normalizedUrl = new URL(rawUrl).toString();
  } catch {
    return undefined;
  }

  let cachedSource: KnowledgeSource | undefined;

  for (const knowledgeBase of state.knowledgeBases || []) {
    const sources = Array.isArray(knowledgeBase.sources) ? knowledgeBase.sources : [];

    for (const source of sources) {
      if (source.url !== normalizedUrl || source.status !== "parsed") {
        continue;
      }

      const text = normalizeKnowledgeText(source.markdown || source.extractedText || source.rawText || "");

      if (!text) {
        continue;
      }

      cachedSource = cachedSource ? pickBetterKnowledgeSource(cachedSource, source) : source;
    }
  }

  return cachedSource;
}

function collectKnownSiteSourceUrls(sourceUrl: string, state = readWorkbenchState()) {
  let origin: string;

  try {
    origin = new URL(sourceUrl).origin;
  } catch {
    return [];
  }

  const urls: string[] = [];

  for (const knowledgeBase of state.knowledgeBases || []) {
    const sources = Array.isArray(knowledgeBase.sources) ? knowledgeBase.sources : [];
    urls.push(...collectKnownKnowledgeSourceUrls(sources, knowledgeBase.autoCrawl?.importedUrls || []));
  }

  return Array.from(
    new Set(
      urls.filter((url) => {
        try {
          return new URL(url).origin === origin;
        } catch {
          return false;
        }
      })
    )
  );
}

function truncateKnowledgeContentPreview(text: string) {
  const normalized = normalizeKnowledgeText(text);

  if (normalized.length <= KNOWLEDGE_CONTENT_PREVIEW_CHAR_LIMIT) {
    return normalized;
  }

  return normalizeKnowledgeText(
    `${normalized.slice(0, KNOWLEDGE_CONTENT_PREVIEW_CHAR_LIMIT)}\n\n[内容预览已截断，完整正文保留在来源资料和切片中。]`
  );
}

function buildKnowledgeContentPreview(sources: KnowledgeSource[]) {
  const parsedSources = sources.filter((source) => source.status === "parsed" && normalizeKnowledgeText(source.markdown || source.extractedText).length > 0);
  const previewSources = parsedSources.slice(0, KNOWLEDGE_CONTENT_PREVIEW_SOURCE_LIMIT);
  const sourceNote =
    parsedSources.length > previewSources.length
      ? `> 预览仅展示前 ${previewSources.length} 个来源；完整 ${parsedSources.length} 个来源已保留在来源资料和切片中。`
      : "";

  return normalizeKnowledgeText(
    [
      sourceNote,
      truncateKnowledgeContentPreview(
        previewSources
          .map((source) => {
            const meta = [source.url, source.addedAt ? `追加时间：${source.addedAt}` : undefined].filter(Boolean).join("\n");
            return [`## ${source.title}`, meta, source.markdown || source.extractedText].filter(Boolean).join("\n\n");
          })
          .join("\n\n---\n\n")
      )
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

function splitLongKnowledgeBlock(text: string, maxChars: number) {
  const normalized = normalizeKnowledgeText(text);

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentences = normalized
    .split(/(?<=[。！？.!?])\s+|(?<=。|！|？)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences.length ? sentences : normalized.match(new RegExp(`.{1,${maxChars}}`, "g")) || []) {
    if (buffer && `${buffer}${sentence}`.length > maxChars) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    buffer = buffer ? `${buffer}${sentence}` : sentence;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function splitStructuredBlocks(markdown: string, fallbackTitle: string) {
  const normalized = normalizeKnowledgeText(markdown);
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const blocks: Array<{ title: string; sectionPath: string; content: string }> = [];
  let sectionTitle = fallbackTitle;
  let sectionPath = fallbackTitle;

  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      sectionTitle = headingMatch[2].trim().slice(0, 80) || fallbackTitle;
      sectionPath = sectionTitle;
      continue;
    }

    for (const content of splitLongKnowledgeBlock(paragraph, 900)) {
      if (content.length >= 24) {
        blocks.push({ title: sectionTitle, sectionPath, content });
      }
    }
  }

  if (!blocks.length && normalized) {
    blocks.push({ title: fallbackTitle, sectionPath: fallbackTitle, content: normalized });
  }

  return blocks;
}

function mergeKnowledgeBlocks(blocks: Array<{ title: string; sectionPath: string; content: string }>) {
  const merged: Array<{ title: string; sectionPath: string; content: string }> = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    const sameSection = previous && previous.sectionPath === block.sectionPath;
    const combinedContent = previous ? `${previous.content}\n\n${block.content}` : block.content;

    if (previous && sameSection && estimateTokenCount(combinedContent) <= 520) {
      previous.content = combinedContent;
      continue;
    }

    merged.push({ ...block });
  }

  return merged;
}

function buildStructuredKnowledgeChunks(
  sources: KnowledgeSource[],
  knowledgeBaseId: string,
  strategy: KnowledgeChunkingStrategy,
  embeddingModel?: string
): KnowledgeChunk[] {
  const embeddingStatus = getKnowledgeEmbeddingStatus(embeddingModel);
  const chunks: KnowledgeChunk[] = [];

  for (const source of sources) {
    if (source.status !== "parsed") {
      continue;
    }

    const blocks = mergeKnowledgeBlocks(splitStructuredBlocks(source.markdown || source.extractedText, source.title));

    blocks.forEach((block, index) => {
      const content = normalizeKnowledgeText(block.content);

      if (!content) {
        return;
      }

      const chunkId = `chunk-${knowledgeBaseId}-${source.id}-${index + 1}`;
      chunks.push({
        id: chunkId,
        knowledgeBaseId,
        sourceId: source.id,
        sourceUrl: source.url,
        sourceTitle: source.title,
        sectionPath: block.sectionPath || source.title,
        chunkTitle: `${block.title || source.title} #${index + 1}`,
        content,
        tokenCount: estimateTokenCount(content),
        contentHash: createContentHash(`${source.id}\n${block.sectionPath}\n${content}`),
        chunkStrategy: strategy === "semantic_llm" ? "semantic_fallback" : "structured_rule",
        embeddingStatus,
        embeddingModel,
        embeddingVector: undefined,
        status: "enabled"
      });
    });
  }

  return chunks;
}

function normalizeKnowledgeChunks(
  value: KnowledgeChunk[] | undefined,
  knowledgeBaseId: string,
  sources: KnowledgeSource[],
  strategy: KnowledgeChunkingStrategy,
  embeddingModel?: string
) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const embeddingStatus = getKnowledgeEmbeddingStatus(embeddingModel);

  if (!Array.isArray(value) || !value.length) {
    return buildStructuredKnowledgeChunks(sources, knowledgeBaseId, strategy, embeddingModel);
  }

  return value.map((chunk, index) => {
    const source = chunk.sourceId ? sourceById.get(chunk.sourceId) : undefined;
    const content = normalizeKnowledgeText(chunk.content || "");

    return {
      ...chunk,
      id: chunk.id || `chunk-${knowledgeBaseId}-${index + 1}`,
      knowledgeBaseId,
      sourceId: chunk.sourceId || source?.id,
      sourceUrl: chunk.sourceUrl || source?.url,
      sourceTitle: chunk.sourceTitle || source?.title || `来源 ${index + 1}`,
      sectionPath: chunk.sectionPath || source?.title || `资料片段 / ${index + 1}`,
      chunkTitle: chunk.chunkTitle || `${source?.title || "资料片段"} #${index + 1}`,
      content,
      tokenCount: chunk.tokenCount || estimateTokenCount(content),
      contentHash: chunk.contentHash || createContentHash(content),
      chunkStrategy: chunk.chunkStrategy || (strategy === "semantic_llm" ? "semantic_fallback" : "structured_rule"),
      embeddingStatus: chunk.embeddingStatus === "fallback_hash" ? "pending_config" : chunk.embeddingStatus || embeddingStatus,
      embeddingModel: chunk.embeddingModel || embeddingModel,
      embeddingVector: chunk.embeddingStatus === "real_embedding" ? chunk.embeddingVector : undefined,
      status: coerceKnowledgeChunkStatus(chunk.status, "enabled")
    };
  });
}

function isPrivateIpAddress(address: string) {
  if (/^(10|127)\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return true;
  if (/^(0|169\.254|224|240)\./.test(address)) return true;
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function validateCrawlUrl(rawUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false as const, message: "URL 格式不正确。" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false as const, message: "仅支持 http / https URL。" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "0.0.0.0" || isPrivateIpAddress(hostname)) {
    return { ok: false as const, message: "出于安全原因，知识库不抓取本机或内网地址。" };
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some((item) => isPrivateIpAddress(item.address))) {
      return { ok: false as const, message: "该 URL 解析到内网地址，已阻止抓取。" };
    }
  } catch {
    return { ok: false as const, message: "URL 域名无法解析。" };
  }

  return { ok: true as const, url: parsed.toString() };
}

function findTextField(value: unknown, keyHint: RegExp, minLength = 80): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);

    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if (typeof nested === "string" && keyHint.test(key) && normalizeKnowledgeText(nested).length >= minLength) {
        return nested;
      }
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return undefined;
}

class KnowledgeCrawlError extends Error {
  code: KnowledgeCrawlFailureCode;

  constructor(code: KnowledgeCrawlFailureCode, message: string) {
    super(message);
    this.name = "KnowledgeCrawlError";
    this.code = code;
  }
}

function getKnowledgeCrawlErrorCode(error: unknown): KnowledgeCrawlFailureCode {
  if (error instanceof KnowledgeCrawlError) {
    return error.code;
  }

  const cause = error && typeof error === "object" ? (error as { cause?: { code?: string; name?: string; message?: string } }).cause : undefined;
  const causeText = [cause?.code, cause?.name, cause?.message].filter(Boolean).join(" ");

  if (error instanceof Error && /abort|timeout|und_err_connect_timeout/i.test(`${error.name} ${error.message} ${causeText}`)) {
    return "timeout";
  }

  return "parser_failed";
}

function readPositiveIntegerEnv(names: string[], fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  for (const name of names) {
    const rawValue = process.env[name]?.trim();
    const value = rawValue ? Number(rawValue) : NaN;

    if (Number.isFinite(value) && value >= min && value <= max) {
      return Math.floor(value);
    }
  }

  return fallback;
}

function getKnowledgeCrawlTimeoutMs(provider?: KnowledgeFetchProvider) {
  if (provider === "xcrawl") {
    return readPositiveIntegerEnv(["XCRAWL_TIMEOUT_MS", "KNOWLEDGE_CRAWL_TIMEOUT_MS"], 45000, 1000, 180000);
  }

  if (provider === "proxy_fetch") {
    return readPositiveIntegerEnv(["KNOWLEDGE_PROXY_FETCH_TIMEOUT_MS", "KNOWLEDGE_CRAWL_TIMEOUT_MS"], 45000, 1000, 180000);
  }

  return readPositiveIntegerEnv(["KNOWLEDGE_LOCAL_FETCH_TIMEOUT_MS", "KNOWLEDGE_CRAWL_TIMEOUT_MS"], 30000, 1000, 180000);
}

function getKnowledgeMinTextLength() {
  return readPositiveIntegerEnv(["KNOWLEDGE_CRAWL_MIN_TEXT_LENGTH"], 80, 20, 10000);
}

const knowledgeCrawlDomainSlots = new Map<string, number>();

async function waitForKnowledgeCrawlSlot(url: string) {
  const delayMs = readPositiveIntegerEnv(["KNOWLEDGE_CRAWL_DOMAIN_DELAY_MS"], 300, 0, 60000);

  if (!delayMs) {
    return;
  }

  let origin: string;

  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }

  const now = Date.now();
  const nextAllowedAt = knowledgeCrawlDomainSlots.get(origin) || 0;
  const waitMs = Math.max(0, nextAllowedAt - now);
  knowledgeCrawlDomainSlots.set(origin, Math.max(now, nextAllowedAt) + delayMs);

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new KnowledgeCrawlError("timeout", "URL 抓取超时。");
    }

    const code = getKnowledgeCrawlErrorCode(error);

    if (code === "timeout") {
      throw new KnowledgeCrawlError("timeout", "URL 抓取连接超时。");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCrawlerPayload(payload: Record<string, unknown>, provider: KnowledgeFetchProvider) {
  const text = normalizeKnowledgeText(findTextField(payload, /markdown|text|content|html/i) || "");

  if (!text) {
    return undefined;
  }

  return {
    title: normalizeKnowledgeText(findTextField(payload, /title/i, 1) || ""),
    text,
    provider
  };
}

function assertUsableCrawledText(text: string, contentType = "") {
  if (contentType.includes("html") && isLoadingOnlyKnowledgeText(text)) {
    throw new KnowledgeCrawlError("parser_failed", "该页面是客户端加载列表页，当前抓取未拿到真实文章正文。");
  }

  if (isBlockedKnowledgeText(text)) {
    throw new KnowledgeCrawlError("blocked", "站点防护拦截了本次抓取，未拿到真实正文。");
  }

  if (!text || text.length < getKnowledgeMinTextLength()) {
    throw new KnowledgeCrawlError("empty_content", "未提取到足够的正文文本。");
  }
}

async function throwHttpCrawlError(response: Response, providerLabel: string) {
  const body = normalizeKnowledgeText(await response.text().catch(() => ""));

  if (body && isBlockedKnowledgeText(body)) {
    throw new KnowledgeCrawlError("blocked", "站点防护拦截了本次抓取，未拿到真实正文。");
  }

  throw new KnowledgeCrawlError("http_error", `${providerLabel}请求失败：HTTP ${response.status}。`);
}

function createEndpointCandidates(baseUrl: string, paths: string[]) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const candidates: string[] = [];

  const pushCandidate = (value: string) => {
    const normalized = value.replace(/\/$/, "");
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  try {
    const parsed = new URL(normalizedBase);
    const pathname = parsed.pathname.replace(/\/$/, "");

    for (const path of paths) {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const standard = new URL(parsed.toString());
      standard.pathname = `/v1${normalizedPath}`;
      pushCandidate(standard.toString());
    }

    if (pathname.endsWith("/crawl")) {
      parsed.pathname = `${pathname.replace(/\/crawl$/, "")}/scrape`;
      pushCandidate(parsed.toString());
    } else if (pathname.endsWith("/scrape")) {
      parsed.pathname = `${pathname.replace(/\/scrape$/, "")}/crawl`;
      pushCandidate(parsed.toString());
    }
  } catch {
    // Keep the original string candidates for non-standard local endpoints.
  }

  pushCandidate(normalizedBase);

  for (const path of paths) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    if (!normalizedBase.endsWith(normalizedPath)) {
      pushCandidate(`${normalizedBase}${normalizedPath}`);
    }
  }

  for (const path of paths) {
    pushCandidate(`https://run.xcrawl.com/v1${path.startsWith("/") ? path : `/${path}`}`);
  }

  return candidates;
}

async function crawlWithXcrawl(url: string): Promise<{ title?: string; text: string; provider: KnowledgeFetchProvider } | undefined> {
  if (!process.env.XCRAWL_API_KEY?.trim()) {
    return undefined;
  }

  await waitForKnowledgeCrawlSlot(url);
  const baseUrl = process.env.XCRAWL_BASE_URL || "https://run.xcrawl.com/v1";
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.XCRAWL_API_KEY}`
  };

  let created: Response | undefined;
  let createEndpoint = "";
  let createError: unknown;

  for (const endpoint of createEndpointCandidates(baseUrl, ["/scrape", "/crawl"])) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url,
          crawler: { limit: 1, max_depth: 0 },
          js_render: { enabled: true, wait_until: "load" },
          output: { formats: ["markdown"] }
        })
      }, getKnowledgeCrawlTimeoutMs("xcrawl"));

      if (response.ok) {
        created = response;
        createEndpoint = endpoint;
        break;
      }

      createError = response.status === 404 ? new KnowledgeCrawlError("http_error", `XCrawl 抓取请求失败：HTTP ${response.status}。`) : undefined;
      if (response.status !== 404) {
        await throwHttpCrawlError(response, "XCrawl 抓取");
      }
    } catch (error) {
      createError = error;
    }
  }

  if (!created) {
    throw createError instanceof Error ? createError : new KnowledgeCrawlError("http_error", "XCrawl 抓取请求失败。");
  }

  if (!created.ok) {
    await throwHttpCrawlError(created, "XCrawl 抓取");
  }

  const payload = (await created.json().catch(() => ({}))) as Record<string, unknown>;
  const immediateResult = parseCrawlerPayload(payload, "xcrawl");

  if (immediateResult) {
    assertUsableCrawledText(immediateResult.text);
    return immediateResult;
  }

  const crawlId =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.crawl_id === "string"
        ? payload.crawl_id
        : typeof payload.scrape_id === "string"
          ? payload.scrape_id
          : undefined;

  if (!crawlId) {
    return undefined;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = await fetchWithTimeout(`${createEndpoint.replace(/\/$/, "")}/${crawlId}`, { headers }, getKnowledgeCrawlTimeoutMs("xcrawl"));

    if (!status.ok) {
      await throwHttpCrawlError(status, "XCrawl 抓取状态查询");
    }

    const statusPayload = (await status.json().catch(() => ({}))) as Record<string, unknown>;
    const result = parseCrawlerPayload(statusPayload, "xcrawl");

    if (result) {
      assertUsableCrawledText(result.text);
      return result;
    }
  }

  return undefined;
}

async function crawlWithProxyFetch(url: string): Promise<{ title?: string; text: string; provider: KnowledgeFetchProvider } | undefined> {
  const rawEndpoint = process.env.KNOWLEDGE_PROXY_FETCH_BASE_URL?.trim();

  if (!rawEndpoint) {
    return undefined;
  }

  await waitForKnowledgeCrawlSlot(url);
  const endpoint = rawEndpoint.includes("{url}") ? rawEndpoint.replace("{url}", encodeURIComponent(url)) : rawEndpoint;
  const apiKey = process.env.KNOWLEDGE_PROXY_FETCH_API_KEY?.trim();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "JOTO-GTM-Workbench/1.0 (+knowledge-base-import)"
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(
    endpoint,
    rawEndpoint.includes("{url}")
      ? { headers }
      : {
          method: "POST",
          headers,
          body: JSON.stringify({
            url,
            render: true,
            output: "markdown"
          })
        },
    getKnowledgeCrawlTimeoutMs("proxy_fetch")
  );

  if (!response.ok) {
    await throwHttpCrawlError(response, "代理抓取");
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("json")) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const result = parseCrawlerPayload(payload, "proxy_fetch");

    if (result) {
      assertUsableCrawledText(result.text);
      return result;
    }

    throw new KnowledgeCrawlError("empty_content", "代理抓取没有返回可用正文。");
  }

  const body = await response.text();
  const title = contentType.includes("html") ? extractHtmlTitle(body, url) : url;
  const text = contentType.includes("html") ? stripHtmlToText(body) : normalizeKnowledgeText(body);
  assertUsableCrawledText(text, contentType);

  return { title, text, provider: "proxy_fetch" };
}

async function crawlWithLocalFetch(url: string) {
  await waitForKnowledgeCrawlSlot(url);
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "user-agent": "JOTO-GTM-Workbench/1.0 (+knowledge-base-import)"
      }
    },
    getKnowledgeCrawlTimeoutMs("local_fetch")
  );

  if (!response.ok) {
    await throwHttpCrawlError(response, "本地抓取");
  }

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const title = contentType.includes("html") ? extractHtmlTitle(body, url) : url;
  const text = contentType.includes("html") ? stripHtmlToText(body) : normalizeKnowledgeText(body);
  assertUsableCrawledText(text, contentType);

  return { title, text, provider: "local_fetch" as const };
}

type LiveKnowledgeCrawler = Exclude<KnowledgeFetchProvider, "cache" | "manual" | "site_import">;

function getConfiguredKnowledgeCrawlers(): LiveKnowledgeCrawler[] {
  const crawlers: LiveKnowledgeCrawler[] = [];

  if (process.env.XCRAWL_API_KEY?.trim()) {
    crawlers.push("xcrawl");
  }

  if (process.env.KNOWLEDGE_PROXY_FETCH_BASE_URL?.trim()) {
    crawlers.push("proxy_fetch");
  }

  crawlers.push("local_fetch");

  const primaryProvider = process.env.KNOWLEDGE_CRAWL_PRIMARY_PROVIDER?.trim() as LiveKnowledgeCrawler | undefined;

  if (!primaryProvider || !crawlers.includes(primaryProvider)) {
    return crawlers;
  }

  return [primaryProvider, ...crawlers.filter((item) => item !== primaryProvider)];
}

async function crawlWithProvider(provider: LiveKnowledgeCrawler, url: string) {
  if (provider === "xcrawl") {
    return crawlWithXcrawl(url);
  }

  if (provider === "proxy_fetch") {
    return crawlWithProxyFetch(url);
  }

  return crawlWithLocalFetch(url);
}

function getPreferredKnowledgeFetchProvider() {
  const [provider] = getConfiguredKnowledgeCrawlers();
  return provider || "local_fetch";
}

export async function probeKnowledgeUrlCrawler(rawUrl = "https://www.jotoai.com/") {
  const validation = await validateCrawlUrl(rawUrl);

  if (!validation.ok) {
    return {
      ok: false,
      status: "failed" as const,
      provider: getPreferredKnowledgeFetchProvider(),
      errorCode: "invalid_url" as KnowledgeCrawlFailureCode,
      message: validation.message
    };
  }

  let lastError: unknown;

  for (const provider of getConfiguredKnowledgeCrawlers().filter((item) => item !== "local_fetch")) {
    try {
      const result = await crawlWithProvider(provider, validation.url);

      if (result) {
        return {
          ok: true,
          status: "ready" as const,
          provider: result.provider,
          title: result.title,
          textLength: result.text.length,
          message: `${result.provider === "xcrawl" ? "XCrawl" : "代理抓取"}测试成功，已取得 ${result.text.length} 字正文。`
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    status: process.env.XCRAWL_API_KEY?.trim() || process.env.KNOWLEDGE_PROXY_FETCH_BASE_URL?.trim() ? ("failed" as const) : ("pending_config" as const),
    provider: getPreferredKnowledgeFetchProvider(),
    errorCode: lastError ? getKnowledgeCrawlErrorCode(lastError) : ("pending_config" as KnowledgeCrawlFailureCode),
    message:
      lastError instanceof Error
        ? lastError.message
        : "未配置 XCrawl 或代理抓取；当前只能使用本地 fetch 兜底，遇到 IP 封锁或动态页面会不稳定。"
  };
}

function isLikelyBlogIndexUrl(url: string) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const decodedPathname = decodeURIComponent(pathname);
  const hostname = parsed.hostname.toLowerCase();
  const pageId = parsed.searchParams.get("page_id");
  const isKnownJotoHomepage = pathname === "/" && !pageId && (hostname === "www.jotoai.com" || hostname === "jotoai.com");
  const isKnownJotoBlogIndex = pageId === "9031" && (hostname === "www.jotoai.com" || hostname === "jotoai.com");
  return isKnownJotoHomepage || isKnownJotoBlogIndex || pathname === "/blog" || pathname === "/articles" || decodedPathname.includes("资讯中心");
}

function isTrustedJotoSiteUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "jotoai.com" || hostname === "www.jotoai.com" || hostname === "sec.jotoai.com";
  } catch {
    return false;
  }
}

function isSitemapUrl(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".xml");
  } catch {
    return false;
  }
}

function extractSitemapLocs(xml: string) {
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
    .map((match) => normalizeKnowledgeText(decodeHtmlEntities(match[1] || "")))
    .filter(Boolean);

  if (locs.length) {
    return locs;
  }

  return Array.from(xml.matchAll(/https?:\/\/[^\s<>"')]+/gi))
    .map((match) => normalizeKnowledgeText(decodeHtmlEntities(match[0] || "")).replace(/[)\].,;]+$/, ""))
    .filter(Boolean);
}

async function fetchSitemapTextWithProvider(provider: LiveKnowledgeCrawler, sitemapUrl: string) {
  if (provider !== "local_fetch") {
    const result = await crawlWithProvider(provider, sitemapUrl);
    return result?.text || "";
  }

  const response = await fetchWithTimeout(
    sitemapUrl,
    {
      headers: {
        "user-agent": "JOTO-GTM-Workbench/1.0 (+knowledge-base-import)"
      }
    },
    getKnowledgeCrawlTimeoutMs("local_fetch")
  );

  if (!response.ok) {
    await throwHttpCrawlError(response, "Sitemap 本地抓取");
  }

  const body = await response.text();

  if (isBlockedKnowledgeText(body)) {
    throw new KnowledgeCrawlError("blocked", "站点防护拦截了本次 sitemap 抓取，未拿到真实列表。");
  }

  return body;
}

async function fetchSitemapLocs(sitemapUrl: string) {
  let lastError: unknown;

  for (const provider of getConfiguredKnowledgeCrawlers()) {
    try {
      const body = await fetchSitemapTextWithProvider(provider, sitemapUrl);
      const locs = extractSitemapLocs(body);

      if (locs.length) {
        return locs;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error && getKnowledgeCrawlErrorCode(lastError) !== "http_error") {
    throw lastError;
  }

  return [];
}

const articlePathPattern = /\/articles\//;
const ignoredSiteAssetPattern = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|json|pdf|zip|rar|7z|mp4|mov|avi|mp3|wav|woff2?|ttf|eot)$/i;
const ignoredSitePathPattern = /\/(?:tag|tags|category|author|feed|search|wp-json|wp-content|wp-admin|login|cart|checkout|page)\/?/i;

function isImportableSiteContentUrl(item: string, origin: string) {
  try {
    const itemUrl = new URL(item);
    const pathname = decodeURIComponent(itemUrl.pathname);

    if (itemUrl.origin !== origin) {
      return false;
    }

    if (isSitemapUrl(itemUrl.toString())) {
      return false;
    }

    if (ignoredSiteAssetPattern.test(pathname) || ignoredSitePathPattern.test(pathname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function scoreSiteContentUrl(item: string) {
  const itemUrl = new URL(item);
  const pathname = itemUrl.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/") return 0;
  if (!articlePathPattern.test(pathname)) return 1;
  return 2;
}

function summarizeSiteContentUrls(urls: string[]) {
  const articleCount = urls.filter((item) => {
    try {
      return articlePathPattern.test(new URL(item).pathname);
    } catch {
      return false;
    }
  }).length;
  const pageCount = Math.max(0, urls.length - articleCount);
  const parts: string[] = [];

  if (pageCount) parts.push(`${pageCount} 个站点页面`);
  if (articleCount) parts.push(`${articleCount} 篇文章`);

  return parts.length ? parts.join("、") : `${urls.length} 个页面`;
}

async function expandBlogIndexFromSitemap(url: string, limit?: number) {
  const parsed = new URL(url);
  const sitemapQueue = [new URL("/sitemap.xml", parsed.origin).toString(), new URL("/sitemap_index.xml", parsed.origin).toString()];
  const visitedSitemaps = new Set<string>();
  const discoveredUrls: string[] = [];
  const discoveredSet = new Set<string>();

  while (sitemapQueue.length && visitedSitemaps.size < 30) {
    const sitemapUrl = sitemapQueue.shift();

    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) {
      continue;
    }

    visitedSitemaps.add(sitemapUrl);
    const locs = await fetchSitemapLocs(sitemapUrl);

    for (const loc of locs) {
      let locUrl: URL;

      try {
        locUrl = new URL(loc);
      } catch {
        continue;
      }

      if (locUrl.origin !== parsed.origin) {
        continue;
      }

      if (isSitemapUrl(locUrl.toString())) {
        if (!visitedSitemaps.has(locUrl.toString())) {
          sitemapQueue.push(locUrl.toString());
        }
        continue;
      }

      const normalizedUrl = locUrl.toString();

      if (!discoveredSet.has(normalizedUrl)) {
        discoveredSet.add(normalizedUrl);
        discoveredUrls.push(normalizedUrl);
      }
    }
  }

  const urls = discoveredUrls
    .filter((item) => isImportableSiteContentUrl(item, parsed.origin))
    .sort((left, right) => scoreSiteContentUrl(left) - scoreSiteContentUrl(right));

  return urls.slice(0, typeof limit === "number" ? limit : undefined);
}

async function collectSiteArticleUrls(url: string) {
  const validation = await validateCrawlUrl(url);

  if (!validation.ok || !isLikelyBlogIndexUrl(validation.url)) {
    return [];
  }

  try {
    return await expandBlogIndexFromSitemap(validation.url);
  } catch {
    return [];
  }
}

const runningKnowledgeSiteImports = new Set<string>();

function startKnowledgeSiteImportJob(knowledgeBaseId: string, sourceUrl: string) {
  if (runningKnowledgeSiteImports.has(knowledgeBaseId)) {
    return;
  }

  runningKnowledgeSiteImports.add(knowledgeBaseId);
  void runKnowledgeSiteImportJob(knowledgeBaseId, sourceUrl).finally(() => {
    runningKnowledgeSiteImports.delete(knowledgeBaseId);
  });
}

export function startKnowledgeAutoImport(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const knowledgeBase = state.knowledgeBases.find((item) => item.id === id);

  if (!knowledgeBase) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const normalizedKnowledgeBase = normalizeKnowledgeBase(knowledgeBase);
  const sourceUrl = normalizedKnowledgeBase.autoCrawl?.sourceUrl || normalizedKnowledgeBase.sourceUrl;
  const isBlogIndexSource = (() => {
    try {
      return Boolean(sourceUrl && isLikelyBlogIndexUrl(new URL(sourceUrl).toString()));
    } catch {
      return false;
    }
  })();

  if ((!normalizedKnowledgeBase.autoCrawl?.enabled && !isBlogIndexSource) || !sourceUrl) {
    return {
      ok: false,
      status: "pending_input",
      message: "该知识库未启用自动导入或缺少博客源 URL。"
    };
  }

  startKnowledgeSiteImportJob(id, sourceUrl);

  return {
    ok: true,
    status: "success",
    message: "后台增量导入任务已启动；系统会跳过已抓取过的文章。",
    data: {
      knowledgeBase: normalizedKnowledgeBase
    }
  };
}

async function runKnowledgeSiteImportJob(knowledgeBaseId: string, sourceUrl: string) {
  const startedAt = nowIso();
  const discoveredArticleUrls = await collectSiteArticleUrls(sourceUrl);
  let state = readWorkbenchState();
  let index = state.knowledgeBases.findIndex((item) => item.id === knowledgeBaseId);

  if (index < 0) {
    return;
  }

  let current = normalizeKnowledgeBase(state.knowledgeBases[index]);
  let existingSources = dedupeKnowledgeSources(current.sources || []);
  const knownSiteUrls = !discoveredArticleUrls.length ? collectKnownSiteSourceUrls(sourceUrl, state) : [];
  const articleUrls = discoveredArticleUrls.length
    ? discoveredArticleUrls
    : collectKnownKnowledgeSourceUrls(existingSources, [...(current.autoCrawl?.importedUrls || []), ...knownSiteUrls]);
  const sitemapUnavailable = !discoveredArticleUrls.length;
  const previousImportedUrls = new Set([
    ...(current.autoCrawl?.importedUrls || []),
    ...existingSources.filter((source) => source.status === "parsed").map((source) => source.url).filter((url): url is string => Boolean(url))
  ]);
  const pendingArticleUrls = articleUrls.filter((url) => !previousImportedUrls.has(url));
  const importedUrls = new Set(previousImportedUrls);

  state.knowledgeBases[index] = normalizeKnowledgeBase({
    ...current,
    autoCrawl: {
      enabled: true,
      weekday: current.autoCrawl?.weekday || 1,
      hour: current.autoCrawl?.hour || 9,
      sourceUrl,
      status: "running",
      totalDiscovered: articleUrls.length,
      importedCount: countParsedUrlSources(existingSources),
      failedCount: countFailedUrlSources(existingSources),
      importedUrls: Array.from(importedUrls),
      startedAt,
      lastCrawledAt: current.autoCrawl?.lastCrawledAt,
      nextCrawlAt: current.autoCrawl?.nextCrawlAt,
      lastError: sitemapUnavailable ? "Sitemap is temporarily unavailable; reused the existing saved URL list for this import run." : undefined
    }
  });
  saveWithEvent(state, "knowledge_site_import_started", `Started site import for knowledge base ${knowledgeBaseId}.`);

  for (const articleUrl of pendingArticleUrls) {
    state = readWorkbenchState();
    const cachedSource = findCachedParsedKnowledgeSource(articleUrl, state);
    const source = cachedSource
      ? cloneCachedKnowledgeSource(cachedSource, knowledgeBaseId, startedAt)
      : await crawlKnowledgeUrl(knowledgeBaseId, articleUrl, startedAt);
    state = readWorkbenchState();
    state = readWorkbenchState();
    index = state.knowledgeBases.findIndex((item) => item.id === knowledgeBaseId);

    if (index < 0) {
      return;
    }

    current = normalizeKnowledgeBase(state.knowledgeBases[index]);
    existingSources = dedupeKnowledgeSources([...(current.sources || []), source]);
    const sources = existingSources;
    if (source.status === "parsed") {
      if (source.url) importedUrls.add(source.url);
    }

    const chunkingStrategy = current.chunkingStrategy || "rule";
    const chunks = buildStructuredKnowledgeChunks(sources, current.id, chunkingStrategy, current.embeddingModel);
    const contentPreview = buildKnowledgeContentPreview(sources) || current.contentPreview || "";

    state.knowledgeBases[index] = normalizeKnowledgeBase({
      ...current,
      sources,
      contentPreview,
      chunks,
      vectorizationStatus: getKnowledgeEmbeddingStatus(current.embeddingModel),
      lastSyncedAt: nowIso(),
      autoCrawl: {
        enabled: true,
        weekday: current.autoCrawl?.weekday || 1,
        hour: current.autoCrawl?.hour || 9,
        sourceUrl,
        status: "running",
        totalDiscovered: articleUrls.length,
        importedCount: importedUrls.size,
        failedCount: countFailedUrlSources(sources),
        importedUrls: Array.from(importedUrls),
        startedAt,
        lastCrawledAt: current.autoCrawl?.lastCrawledAt,
        nextCrawlAt: current.autoCrawl?.nextCrawlAt,
        lastError: sitemapUnavailable ? "Sitemap is temporarily unavailable; reused the existing saved URL list for this import run." : undefined
      }
    });
    saveWithEvent(state, "knowledge_site_import_progress", `Imported ${importedUrls.size}/${articleUrls.length} site content URL(s) for knowledge base ${knowledgeBaseId}.`);
  }

  state = readWorkbenchState();
  index = state.knowledgeBases.findIndex((item) => item.id === knowledgeBaseId);

  if (index < 0) {
    return;
  }

  current = normalizeKnowledgeBase(state.knowledgeBases[index]);
  existingSources = dedupeKnowledgeSources(current.sources || []);
  const finalImportedCount = countParsedUrlSources(existingSources);
  const finalFailedCount = countFailedUrlSources(existingSources);
  const finalDiscoveredCount = articleUrls.length || finalImportedCount + finalFailedCount || current.autoCrawl?.totalDiscovered || 0;
  state.knowledgeBases[index] = normalizeKnowledgeBase({
    ...current,
    sources: existingSources,
    contentPreview: buildKnowledgeContentPreview(existingSources) || current.contentPreview || "",
    chunks: buildStructuredKnowledgeChunks(existingSources, current.id, current.chunkingStrategy || "rule", current.embeddingModel),
    autoCrawl: {
      enabled: true,
      weekday: current.autoCrawl?.weekday || 1,
      hour: current.autoCrawl?.hour || 9,
      sourceUrl,
      status: finalFailedCount || !finalDiscoveredCount ? "failed" : "success",
      totalDiscovered: finalDiscoveredCount,
      importedCount: finalImportedCount,
      failedCount: finalFailedCount,
      importedUrls: Array.from(importedUrls),
      startedAt,
      completedAt: nowIso(),
      lastCrawledAt: nowIso(),
      nextCrawlAt: addDaysFromNow(7, current.autoCrawl?.hour || 9),
      lastError: finalFailedCount
        ? `${finalFailedCount} 个页面抓取失败，失败来源已保留在来源列表。`
        : sitemapUnavailable
          ? "Sitemap is temporarily unavailable; reused the existing saved URL list for this import run."
          : undefined
    }
  });
  saveWithEvent(state, "knowledge_site_import_finished", `Finished site import for knowledge base ${knowledgeBaseId}.`);
}

async function crawlKnowledgeUrl(knowledgeBaseId: string, rawUrl: string, addedAt = nowIso()): Promise<KnowledgeSource> {
  const validation = await validateCrawlUrl(rawUrl);

  if (!validation.ok) {
    return {
      id: createId("source"),
      knowledgeBaseId,
      type: "url",
      title: rawUrl,
      url: rawUrl,
      extractedText: "",
      markdown: "",
      status: "failed",
      fetchProvider: getPreferredKnowledgeFetchProvider(),
      errorCode: "invalid_url",
      errorMessage: validation.message,
      addedAt,
      contentHash: createContentHash(rawUrl)
    };
  }

  try {
    let crawled: { title?: string; text: string; provider: KnowledgeFetchProvider } | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const provider of getConfiguredKnowledgeCrawlers()) {
        try {
          crawled = await crawlWithProvider(provider, validation.url);

          if (crawled) {
            break;
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (crawled) {
        break;
      }

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }

    if (!crawled) {
      throw lastError instanceof Error ? lastError : new Error("URL 抓取失败。");
    }

    const title = crawled.title || new URL(validation.url).hostname;
    const text = normalizeKnowledgeText(crawled.text);

    return {
      id: createId("source"),
      knowledgeBaseId,
      type: "url",
      title,
      url: validation.url,
      rawText: text,
      extractedText: text,
      markdown: text,
      status: "parsed",
      fetchProvider: crawled.provider,
      addedAt,
      parsedAt: nowIso(),
      contentHash: createContentHash(`${validation.url}\n${text}`)
    };
  } catch (error) {
    const cachedSource = findCachedParsedKnowledgeSource(validation.url);

    if (cachedSource) {
      return cloneCachedKnowledgeSource(cachedSource, knowledgeBaseId, addedAt);
    }

    return {
      id: createId("source"),
      knowledgeBaseId,
      type: "url",
      title: validation.url,
      url: validation.url,
      extractedText: "",
      markdown: "",
      status: "failed",
      fetchProvider: getPreferredKnowledgeFetchProvider(),
      errorCode: getKnowledgeCrawlErrorCode(error),
      errorMessage: error instanceof Error ? error.message : "URL 抓取失败。",
      addedAt,
      contentHash: createContentHash(validation.url)
    };
  }
}

function collectKnowledgeUrls(input: Record<string, unknown>) {
  const rawItems: string[] = [];

  for (const key of ["urlsText", "urls", "urlText", "sourceUrl"]) {
    const value = input[key];

    if (typeof value === "string") {
      rawItems.push(value);
    } else if (Array.isArray(value)) {
      rawItems.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }

  return Array.from(
    new Set(
      rawItems
        .join("\n")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

async function parseKnowledgeSourcesFromInput(
  input: Record<string, unknown>,
  knowledgeBaseId: string,
  fallbackTitle: string,
  options: { includeContentPreview?: boolean } = {}
) {
  const addedAt = nowIso();
  const sources: KnowledgeSource[] = [];

  for (const url of collectKnowledgeUrls(input)) {
    const validation = await validateCrawlUrl(url);
    const normalizedUrl = (() => {
      try {
        return new URL(url).toString();
      } catch {
        return "";
      }
    })();

    if (!validation.ok && normalizedUrl && isTrustedJotoSiteUrl(normalizedUrl) && isLikelyBlogIndexUrl(normalizedUrl)) {
      sources.push(
        createSiteImportPlanSource(
          knowledgeBaseId,
          fallbackTitle || "站点入口全量导入",
          normalizedUrl,
          `已识别为 JOTO 站点入口：${normalizedUrl}\n\n本机 DNS 本次暂时无法解析该域名，预览阶段未能读取 sitemap。保存后仍可启动后台全量导入任务，后台会按 ${getConfiguredKnowledgeCrawlerLabel()} 重试 sitemap 和真实正文抓取。\n\n预览阶段不把站点入口占位文本当作知识库正文。`,
          addedAt
        )
      );
      continue;
    }

    if (validation.ok && isLikelyBlogIndexUrl(validation.url)) {
      let articleUrls: string[] = [];
      let sitemapError: unknown;

      try {
        articleUrls = await expandBlogIndexFromSitemap(validation.url);
      } catch (error) {
        sitemapError = error;
      }

      if (articleUrls.length) {
        const sitemapSummary = summarizeSiteContentUrls(articleUrls);
        sources.push(
          createSiteImportPlanSource(
            knowledgeBaseId,
            fallbackTitle || "站点博客全量导入",
            validation.url,
            `已识别为站点聚合页：${validation.url}\n\nSitemap 已发现 ${sitemapSummary}。保存后将启动后台全量导入任务，后台会逐页抓取真实正文；后续自动导入只抓取时间线中未导入过的新内容。\n\n预览阶段不把聚合页占位文本当作知识库正文。`,
            addedAt
          )
        );
        continue;
      }

      const cachedSource = findCachedParsedKnowledgeSource(validation.url);

      if (cachedSource) {
        sources.push(cloneCachedKnowledgeSource(cachedSource, knowledgeBaseId, addedAt));
        continue;
      }

      const knownSiteUrls = collectKnownSiteSourceUrls(validation.url);

      if (knownSiteUrls.length) {
        const sitemapErrorMessage = sitemapError instanceof Error ? `\n\nSitemap 本次发现失败：${sitemapError.message}` : "";
        sources.push(
          createSiteImportPlanSource(
            knowledgeBaseId,
            fallbackTitle || "站点入口全量导入",
            validation.url,
            `已识别为站点入口：${validation.url}\n\n当前 sitemap 暂不可用。保存后将启动后台全量导入任务，并优先复用本地已保存的 ${knownSiteUrls.length} 个同站来源；没有历史正文的 URL 仍会继续尝试真实抓取。${sitemapErrorMessage}\n\n预览阶段不把站点入口占位文本当作知识库正文。`,
            addedAt
          )
        );
        continue;
      }
    }

    sources.push(await crawlKnowledgeUrl(knowledgeBaseId, url, addedAt));
  }

  const manualText =
    typeof input.manualText === "string" && input.manualText.trim()
      ? input.manualText.trim()
      : options.includeContentPreview && typeof input.contentPreview === "string" && input.contentPreview.trim()
        ? input.contentPreview.trim()
        : typeof input.rawContent === "string" && input.rawContent.trim()
          ? input.rawContent.trim()
          : "";
  const manualTitle = typeof input.title === "string" && input.title.trim() ? input.title.trim() : fallbackTitle || "手动追加文本";

  if (manualText) {
    sources.push(createManualKnowledgeSource(knowledgeBaseId, manualTitle, manualText, addedAt));
  }

  return sources;
}

export async function parseKnowledgeSourcesForPreview(input: Record<string, unknown>): Promise<WorkflowResult<{ sources: KnowledgeSource[]; contentPreview: string }>> {
  const title = typeof input.name === "string" && input.name.trim() ? input.name.trim() : typeof input.title === "string" && input.title.trim() ? input.title.trim() : "待导入资料";
  const sources = await parseKnowledgeSourcesFromInput(input, "kb-preview", title, { includeContentPreview: false });

  if (!sources.length) {
    return {
      ok: false,
      status: "pending_input",
      message: "请至少填写一个 URL 或一段补充文本。"
    };
  }

  const parsedCount = sources.filter((source) => source.status === "parsed").length;
  const failedCount = sources.filter((source) => source.status === "failed").length;
  const contentPreview = buildKnowledgeContentPreview(sources);

  return {
    ok: true,
    status: "success",
    message: failedCount
      ? `已解析 ${parsedCount} 个来源，${failedCount} 个 URL 抓取失败。失败原因已保留在来源结果中。`
      : `已解析 ${parsedCount} 个来源，并生成 Markdown 预览。`,
    data: {
      sources,
      contentPreview
    }
  };
}

function coerceDistributionPlatform(value: unknown): DistributionPlatformKey | undefined {
  const allowed: DistributionPlatformKey[] = ["weixin", "csdn", "juejin", "zhihu", "toutiao"];
  return allowed.includes(value as DistributionPlatformKey) ? (value as DistributionPlatformKey) : undefined;
}

function normalizePlatformDraftVariants(value?: PlatformDraftVariant[]): PlatformDraftVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((variant) => {
      const platform = coerceDistributionPlatform(variant.platform);

      if (!platform || !variant.id || !variant.articleDraftId || !variant.publishRecordId) {
        return undefined;
      }

      return {
        ...variant,
        platform,
        contentHash: variant.contentHash || createContentHash(`${variant.title}\n${variant.content}`),
        sourceDraftVersion: variant.sourceDraftVersion || 1,
        qaResult: variant.qaResult || { passed: false, blockers: ["平台终稿缺少质检结果"], warnings: [] },
        status: ["draft", "final", "discarded"].includes(variant.status) ? variant.status : "draft",
        generatedAt: variant.generatedAt || nowIso()
      } satisfies PlatformDraftVariant;
    })
    .filter((variant): variant is PlatformDraftVariant => Boolean(variant));
}

function normalizeDistributionTargets(value?: DistributionTarget[]): DistributionTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowedStatuses: DistributionTarget["status"][] = ["pending", "checking", "auth_required", "ready", "sending", "draft_created", "failed", "cancelled"];

  return value
    .map((target) => {
      const platform = coerceDistributionPlatform(target.platform);

      if (!platform || !target.id || !target.publishRecordId || !target.draftId || !target.taskId) {
        return undefined;
      }

      return {
        ...target,
        platform,
        status: allowedStatuses.includes(target.status) ? target.status : "pending",
        createdAt: target.createdAt || nowIso()
      } satisfies DistributionTarget;
    })
    .filter((target): target is DistributionTarget => Boolean(target));
}

function normalizePublishScheduleStatus(value: unknown): PublishScheduleStatus {
  const allowed: PublishScheduleStatus[] = [
    "scheduled",
    "precheck_failed",
    "publishing",
    "published_verified",
    "published_pending_url",
    "pending_verify",
    "failed",
    "manual_takeover_required",
    "pending_config"
  ];

  return allowed.includes(value as PublishScheduleStatus) ? (value as PublishScheduleStatus) : "scheduled";
}

function normalizePublishAttemptStatus(value: unknown): PublishAttemptStatus {
  const allowed: PublishAttemptStatus[] = [
    "precheck_failed",
    "publishing",
    "published_verified",
    "published_pending_url",
    "pending_verify",
    "failed",
    "manual_takeover_required",
    "pending_config"
  ];

  return allowed.includes(value as PublishAttemptStatus) ? (value as PublishAttemptStatus) : "failed";
}

function normalizePublishFailureCode(value: unknown): PublishFailureCode | undefined {
  const allowed: PublishFailureCode[] = [
    "auth_required",
    "pending_config",
    "payload_invalid",
    "platform_not_supported",
    "platform_review_pending",
    "verification_failed",
    "manual_takeover_required",
    "duplicate_protected",
    "adapter_failed",
    "unknown"
  ];

  return allowed.includes(value as PublishFailureCode) ? (value as PublishFailureCode) : undefined;
}

function normalizePublishSchedules(value?: PublishSchedule[]): PublishSchedule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<PublishSchedule[]>((schedules, schedule) => {
    const platform = coerceDirectPublishPlatform(schedule.platform);

    if (!platform || !schedule.id || !schedule.draftId || !schedule.scheduledAt) {
      return schedules;
    }

    schedules.push({
      ...schedule,
      platform,
      status: normalizePublishScheduleStatus(schedule.status),
      attemptIds: Array.isArray(schedule.attemptIds) ? schedule.attemptIds.filter((id): id is string => typeof id === "string") : [],
      pendingCsvReturn: Boolean(schedule.pendingCsvReturn),
      failureCode: normalizePublishFailureCode(schedule.failureCode),
      retryCount: typeof schedule.retryCount === "number" && schedule.retryCount >= 0 ? schedule.retryCount : 0,
      createdAt: schedule.createdAt || nowIso()
    });

    return schedules;
  }, []);
}

function normalizePublishAttempts(value?: PublishAttempt[]): PublishAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<PublishAttempt[]>((attempts, attempt) => {
    const platform = coerceDirectPublishPlatform(attempt.platform);

    if (!platform || !attempt.id || !attempt.scheduleId || !attempt.startedAt) {
      return attempts;
    }

    attempts.push({
      ...attempt,
      platform,
      status: normalizePublishAttemptStatus(attempt.status),
      mode: ["mock", "dry_run", "real"].includes(attempt.mode) ? attempt.mode : "dry_run",
      authStatus: ["ready", "pending_config", "auth_required", "manual_takeover_required", "failed"].includes(attempt.authStatus)
        ? attempt.authStatus
        : "failed",
      payloadStatus: attempt.payloadStatus === "valid" ? "valid" : "invalid",
      verifyStatus: ["verified", "pending", "failed", "not_started"].includes(attempt.verifyStatus || "") ? attempt.verifyStatus : "not_started",
      pendingCsvReturn: Boolean(attempt.pendingCsvReturn),
      failureCode: normalizePublishFailureCode(attempt.failureCode)
    });

    return attempts;
  }, []);
}

function splitKnowledgeContent(content: string, knowledgeBaseId: string, sourceTitle: string, sourceUrl?: string): KnowledgeChunk[] {
  const source = createLegacyKnowledgeSource(knowledgeBaseId, sourceTitle, content, sourceUrl);
  return buildStructuredKnowledgeChunks([source], knowledgeBaseId, "rule", undefined);
}

function addDaysFromNow(days: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function normalizeKnowledgeBase(item: KnowledgeBase): KnowledgeBase {
  const type = coerceKnowledgeBaseType(item.type, "custom");
  const sourceType = coerceKnowledgeSourceType(item.sourceType, type === "official_blog" ? "auto_crawl" : "manual");
  const chunkingStrategy = coerceKnowledgeChunkingStrategy(item.chunkingStrategy, "rule");
  const rawEmbeddingModel = typeof item.embeddingModel === "string" && item.embeddingModel.trim() ? item.embeddingModel.trim() : undefined;
  const embeddingModel = rawEmbeddingModel === "fallback_hash" || rawEmbeddingModel === "real_embedding_pending_config" ? undefined : rawEmbeddingModel;
  const retrievalStrategy = coerceOptionalKnowledgeRetrievalStrategy(item.retrievalStrategy);
  const normalizedSources = Array.isArray(item.sources)
    ? item.sources.map((source, index) => normalizeKnowledgeSource(source, item.id, item.name, index)).filter((source): source is KnowledgeSource => Boolean(source))
    : [];
  const legacyContent = normalizeKnowledgeText(item.contentPreview || "");
  const sources =
    normalizedSources.length || !legacyContent
      ? normalizedSources
      : [createLegacyKnowledgeSource(item.id, item.name, legacyContent, item.sourceUrl)];
  const contentPreview =
    buildKnowledgeContentPreview(sources) || legacyContent || `${item.name} 暂无内容预览，请通过统一导入或追加资料补充内容。`;
  const productExpressionSource = typeof item.productExpressionSource === "boolean" ? item.productExpressionSource : type === "brand" || type === "product";
  const productExpressionRulePackageMode = normalizeProductExpressionRulePackageMode(
    item.productExpressionRulePackageMode,
    productExpressionSource,
    item.linkedProductExpressionRulePackageId
  );
  const linkedProductExpressionRulePackageId =
    productExpressionRulePackageMode === "existing" && typeof item.linkedProductExpressionRulePackageId === "string" && item.linkedProductExpressionRulePackageId.trim()
      ? item.linkedProductExpressionRulePackageId.trim()
      : undefined;
  const chunks = normalizeKnowledgeChunks(item.chunks, item.id, sources, chunkingStrategy, embeddingModel);
  const vectorizationStatus =
    item.vectorizationStatus === "real_embedding"
      ? "real_embedding"
      : coerceKnowledgeEmbeddingStatus(item.vectorizationStatus === "fallback_hash" ? "pending_config" : item.vectorizationStatus, getKnowledgeEmbeddingStatus(embeddingModel));

  return {
    ...item,
    type,
    sourceType,
    sources,
    contentPreview,
    chunks,
    chunkingStrategy,
    chunkingModel: typeof item.chunkingModel === "string" && item.chunkingModel.trim() ? item.chunkingModel.trim() : undefined,
    embeddingModel,
    retrievalStrategy,
    vectorizationStatus,
    productExpressionSource,
    productExpressionRulePackageMode,
    linkedProductExpressionRulePackageId,
    productExpressionRuleDraft:
      productExpressionRulePackageMode !== "existing" && (item.productExpressionRuleDraft || productExpressionSource)
        ? normalizeProductExpressionRuleDraft(item.productExpressionRuleDraft, item.id, item.name, chunks.length, contentPreview, item.usageScope || "") ||
          buildDefaultProductExpressionRuleDraft(item.id, item.name, chunks.length, contentPreview, item.usageScope || "")
        : undefined,
    autoCrawl: {
      enabled: typeof item.autoCrawl?.enabled === "boolean" ? item.autoCrawl.enabled : sourceType === "auto_crawl",
      weekday: clampNumber(item.autoCrawl?.weekday, 1, 1, 7),
      hour: clampNumber(item.autoCrawl?.hour, 9, 0, 23),
      sourceUrl: typeof item.autoCrawl?.sourceUrl === "string" && item.autoCrawl.sourceUrl.trim() ? item.autoCrawl.sourceUrl.trim() : item.sourceUrl,
      status: item.autoCrawl?.status === "running" || item.autoCrawl?.status === "success" || item.autoCrawl?.status === "failed" ? item.autoCrawl.status : "idle",
      totalDiscovered: typeof item.autoCrawl?.totalDiscovered === "number" ? item.autoCrawl.totalDiscovered : undefined,
      importedCount: typeof item.autoCrawl?.importedCount === "number" ? item.autoCrawl.importedCount : sources.filter((source) => source.status === "parsed").length,
      failedCount: typeof item.autoCrawl?.failedCount === "number" ? item.autoCrawl.failedCount : sources.filter((source) => source.status === "failed").length,
      importedUrls: Array.isArray(item.autoCrawl?.importedUrls) ? item.autoCrawl.importedUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0) : sources.map((source) => source.url).filter((url): url is string => Boolean(url)),
      startedAt: item.autoCrawl?.startedAt,
      completedAt: item.autoCrawl?.completedAt,
      lastCrawledAt: item.autoCrawl?.lastCrawledAt || item.lastSyncedAt,
      nextCrawlAt: item.autoCrawl?.nextCrawlAt || addDaysFromNow(7, clampNumber(item.autoCrawl?.hour, 9, 0, 23)),
      lastError: item.autoCrawl?.lastError
    }
  };
}

function normalizeProductExpressionRulePackageMode(value: unknown, productExpressionSource: boolean, linkedPackageId?: unknown) {
  if (!productExpressionSource) {
    return "none" as const;
  }

  if (value === "existing" && typeof linkedPackageId === "string" && linkedPackageId.trim()) {
    return "existing" as const;
  }

  if (value === "new" || value === "existing") {
    return value === "existing" && (!linkedPackageId || typeof linkedPackageId !== "string" || !linkedPackageId.trim()) ? ("new" as const) : value;
  }

  return "new" as const;
}

function normalizeDistilledTerms(value?: DistilledTerm[]) {
  const source = value?.length ? value : defaultDistilledTerms;

  return source.map((term) => ({
    ...term,
    validationStatus: term.validationStatus || "auto_validated",
    confidence: typeof term.confidence === "number" ? Math.min(Math.max(term.confidence, 0), 1) : 0.72,
    generationMode: term.generationMode || "manual_seed",
    modelConsensusCount: term.modelConsensusCount || 2,
    status: term.status || "active",
    coveredContentTypes: term.coveredContentTypes || []
  }));
}

function normalizeDistilledTermExtractionRules(value?: DistilledTermExtractionRule[]) {
  const customRules = (value || []).filter((rule) => !defaultDistilledTermExtractionRules.some((defaultRule) => defaultRule.id === rule.id));
  const source = [...defaultDistilledTermExtractionRules, ...customRules];

  return source
    .filter((rule) => rule && typeof rule.mappedTerm === "string" && rule.mappedTerm.trim() && Array.isArray(rule.patterns))
    .map((rule) => ({
      ...rule,
      ruleName: rule.ruleName || rule.mappedTerm,
      mappedTerm: rule.mappedTerm.trim(),
      level: rule.level || inferDistilledTermLevel(rule.mappedTerm),
      patterns: rule.patterns.map((pattern) => String(pattern).trim()).filter(Boolean),
      source: rule.source || "manual",
      confidence: typeof rule.confidence === "number" ? Math.min(Math.max(rule.confidence, 0), 1) : 0.72,
      status: rule.status || "active"
    }));
}

function normalizeDistilledTermRuleDrafts(value?: DistilledTermRuleDraft[]) {
  return (value || [])
    .filter((draft) => draft && typeof draft.mappedTerm === "string" && draft.mappedTerm.trim())
    .map((draft) => ({
      ...draft,
      ruleName: draft.ruleName || draft.mappedTerm,
      mappedTerm: draft.mappedTerm.trim(),
      level: draft.level || inferDistilledTermLevel(draft.mappedTerm),
      patterns: Array.isArray(draft.patterns) ? draft.patterns.map((pattern) => String(pattern).trim()).filter(Boolean) : [],
      sourceQuestions: Array.isArray(draft.sourceQuestions) ? draft.sourceQuestions.map((question) => String(question).trim()).filter(Boolean) : [],
      riskNote: draft.riskNote || "待确认该规则是否会误伤其他业务问题。",
      confidence: typeof draft.confidence === "number" ? Math.min(Math.max(draft.confidence, 0), 1) : 0.64,
      status: draft.status || "pending",
      createdAt: draft.createdAt || nowIso()
    }));
}

function inferDistilledTermLevel(text: string): DistilledTerm["level"] {
  if (/服务商|交付|JOTO|品牌|官网/.test(text)) return "core";
  if (/护栏|安全|产品|治理|审计|泄露|越狱/.test(text)) return "product";
  return "scenario";
}

function inferDistilledTermProduct(text: string): ProductKey | undefined {
  if (/护栏|安全|输出|审计|治理|泄露|越狱|知识库|RAG/.test(text)) return "weike_guardrails";
  if (/Dify|服务商|JOTO|交付|官网/.test(text)) return "joto_brand";
  return undefined;
}

interface DistilledTermCandidate {
  term: string;
  confidence: number;
  level?: DistilledTerm["level"];
  product?: ProductKey;
  matchedRuleId?: string;
  draft?: Omit<DistilledTermRuleDraft, "id" | "status" | "createdAt">;
}

function normalizePatternText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function patternMatchesText(pattern: string, text: string) {
  const patternTokens = pattern
    .split(/\s+/)
    .map((item) => normalizePatternText(item))
    .filter(Boolean);
  const normalizedPattern = normalizePatternText(pattern);
  const normalizedText = normalizePatternText(text);

  if (patternTokens.length > 1) {
    return patternTokens.every((token) => normalizedText.includes(token));
  }

  return Boolean(normalizedPattern) && normalizedText.includes(normalizedPattern);
}

function matchActiveDistilledTermRule(question: string, rules: DistilledTermExtractionRule[]): DistilledTermCandidate | undefined {
  const rule = rules
    .filter((item) => item.status === "active")
    .find((item) => item.patterns.some((pattern) => patternMatchesText(pattern, question)));

  if (!rule) {
    return undefined;
  }

  return {
    term: rule.mappedTerm,
    confidence: rule.confidence,
    level: rule.level,
    product: rule.product,
    matchedRuleId: rule.id
  };
}

function inferDistilledTermCandidateFromSemanticTemplate(question: string): DistilledTermCandidate | undefined {
  const matched = distilledTermSemanticTemplates.find((template) => {
    const mustMatched = template.mustInclude ? template.mustInclude.every((pattern) => pattern.test(question)) : true;
    return mustMatched && template.anyInclude.some((pattern) => pattern.test(question));
  });

  if (!matched) {
    return undefined;
  }

  return {
    term: matched.mappedTerm,
    confidence: matched.confidence,
    level: matched.level,
    product: matched.product,
    draft: {
      ruleName: matched.ruleName,
      mappedTerm: matched.mappedTerm,
      level: matched.level,
      product: matched.product,
      patterns: matched.patterns,
      sourceQuestions: [question],
      riskNote: matched.riskNote,
      confidence: matched.confidence
    }
  };
}

function extractDistilledTermCandidate(question: string, rules: DistilledTermExtractionRule[] = defaultDistilledTermExtractionRules): DistilledTermCandidate {
  const text = question.trim();
  const matched = matchActiveDistilledTermRule(text, rules);

  if (matched) {
    return matched;
  }

  const semanticCandidate = inferDistilledTermCandidateFromSemanticTemplate(text);

  if (semanticCandidate) {
    return semanticCandidate;
  }

  const fallbackTerm = text
    .replace(/[？?。！，,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .find((item) => item.length >= 4 && item.length <= 14);

  return {
    term: fallbackTerm || text.slice(0, 12),
    confidence: fallbackTerm ? 0.64 : 0.52
  };
}

type DistilledTermAutoPoolSource = "knowledge_base" | "geo_gap" | "all";

interface DistilledTermAutoPoolCandidate {
  term: string;
  source: string;
  sourceQuestion?: string;
  sourceAssetId?: string;
  generationMode: NonNullable<DistilledTerm["generationMode"]>;
  confidence: number;
  product?: ProductKey;
  coveredContentTypes?: ContentType[];
  modelConsensusCount?: number;
}

function upsertDistilledTermRuleDraft(state: WorkbenchState, draftInput: NonNullable<DistilledTermCandidate["draft"]>) {
  const existing = state.distilledTermRuleDrafts.find((draft) => draft.status === "pending" && draft.mappedTerm === draftInput.mappedTerm);
  const sourceQuestions = Array.from(new Set([...(existing?.sourceQuestions || []), ...draftInput.sourceQuestions].map((question) => question.trim()).filter(Boolean)));
  const patterns = Array.from(new Set([...(existing?.patterns || []), ...draftInput.patterns].map((pattern) => pattern.trim()).filter(Boolean)));

  if (existing) {
    const nextDraft: DistilledTermRuleDraft = {
      ...existing,
      ruleName: draftInput.ruleName || existing.ruleName,
      level: draftInput.level || existing.level,
      product: draftInput.product || existing.product,
      patterns,
      sourceQuestions,
      riskNote: draftInput.riskNote || existing.riskNote,
      confidence: Math.max(existing.confidence, draftInput.confidence)
    };
    state.distilledTermRuleDrafts = normalizeDistilledTermRuleDrafts(state.distilledTermRuleDrafts.map((draft) => (draft.id === existing.id ? nextDraft : draft)));

    return nextDraft;
  }

  const draft: DistilledTermRuleDraft = {
    id: createId("distilled-rule-draft"),
    ruleName: draftInput.ruleName,
    mappedTerm: draftInput.mappedTerm,
    level: draftInput.level,
    product: draftInput.product,
    patterns,
    sourceQuestions,
    riskNote: draftInput.riskNote,
    confidence: draftInput.confidence,
    status: "pending",
    createdAt: nowIso()
  };
  state.distilledTermRuleDrafts = normalizeDistilledTermRuleDrafts([draft, ...state.distilledTermRuleDrafts]);

  return draft;
}

const contentTypeOrder: ContentType[] = ["brand", "scenario", "technical", "faq", "comparison", "case"];

function coerceContentType(value: number): ContentType {
  return contentTypeOrder[value % contentTypeOrder.length];
}

const taskTitleSeeds: Record<ContentType, string[]> = {
  brand: ["为什么企业选择服务商时要先看长期交付能力", "企业级 AI 项目真正考验服务商的是什么", "判断 Dify 服务商时，哪些能力比上线速度更重要"],
  scenario: ["企业把大模型接入业务流程前，需要先确认哪些风险", "哪些业务场景最容易在 AI 落地时出现失控问题", "企业做 AI 应用前，为什么要先梳理责任边界"],
  technical: ["从工程角度看 AI 护栏应该放在系统的哪个位置", "AI 护栏应该如何嵌入企业现有系统流程", "知识库、模型调用和安全护栏之间是什么关系"],
  faq: ["企业接入 Dify 后还需要 AI 安全护栏吗", "为什么有了提示词约束，企业仍然需要安全护栏", "AI 应用上线前，哪些基础问题必须先回答"],
  comparison: ["只靠提示词和接入专业护栏的差别在哪里", "企业自建 AI 安全规则和使用专业护栏有什么不同", "Dify 应用治理和 AI 护栏解决的是同一个问题吗"],
  case: ["一个内容团队如何用 AI 护栏降低发布风险", "企业知识库接入 AI 后，如何减少错误回答带来的风险", "一个业务团队如何把 AI 应用从试用推进到稳定使用"]
};

function pickTaskTitle(contentType: ContentType, variant: number) {
  const seeds = taskTitleSeeds[contentType];
  return seeds[variant % seeds.length];
}

function buildTaskTitle(index: number, contentType: ContentType) {
  return pickTaskTitle(contentType, Math.floor(index / contentTypeOrder.length));
}

function buildTaskKeywords(product: ProductKey, contentType: ContentType) {
  const base = product === "joto_brand" ? ["JOTO", "Dify 服务商"] : ["唯客 AI 护栏", "AI 安全"];
  const byType: Record<ContentType, string> = {
    brand: "企业级交付",
    scenario: "业务场景",
    technical: "工程实践",
    faq: "常见问题",
    comparison: "方案对比",
    case: "客户案例"
  };

  return [...base, byType[contentType]];
}

function buildTaskPlanContext(product: ProductKey, contentType: ContentType, sourceProblem?: string, primaryDistilledTerm?: string) {
  const baseKeywords = buildTaskKeywords(product, contentType);
  const keywords = primaryDistilledTerm && !baseKeywords.includes(primaryDistilledTerm) ? [baseKeywords[0], primaryDistilledTerm, ...baseKeywords.slice(1)] : baseKeywords;
  const productName = productLabels[product];
  const fallbackProblems: Record<ContentType, string> = {
    brand: "企业选择 AI 服务商时容易只看部署速度，忽略长期交付和治理。",
    scenario: "企业把大模型接入业务流程后，需要把场景、风险和责任边界讲清楚。",
    technical: "技术团队需要知道 AI 安全、知识库和应用治理应该落在系统哪个位置。",
    faq: "用户对 Dify、AI 护栏和企业级服务商的必要性仍有基础疑问。",
    comparison: "用户需要理解不同方案之间的边界和适用场景。",
    case: "用户需要看到可复用的业务实践，而不是孤立功能说明。"
  };

  return {
    primaryDistilledTerm: keywords[1] || keywords[0],
    targetKeywords: keywords,
    sourceProblem: sourceProblem || fallbackProblems[contentType],
    officialLinkTarget: "https://jotoai.com",
    reason: `用 ${productName} 的表达补强「${keywords[1] || keywords[0]}」相关认知入口。`,
    riskNote: contentType === "brand" ? "注意避免写成服务商自夸，标题需要落在企业选择标准上。" : "注意补足场景证据，避免只写概念说明。",
    evidenceNeed:
      product === "joto_brand"
        ? "需要 JOTO 企业级交付能力、Dify 企业版服务经验、长期运维流程或官网可信资料。"
        : "需要唯客 AI 护栏的风险识别、输出安全、审计留痕或落地流程资料。",
    confidence: contentType === "case" ? 0.68 : contentType === "brand" ? 0.82 : 0.76
  };
}

function isMutablePlanTask(task: ContentTask) {
  return ["planned", "rejected"].includes(task.status);
}

function getActiveProductPlans(input: GenerateWeeklyPlanInput, state: WorkbenchState, channels: ChannelKey[], products: ProductKey[]) {
  const sourcePlans = input.productPlans?.length ? input.productPlans : state.weeklyPlan.productPlans?.length ? state.weeklyPlan.productPlans : state.workspaceSetting.productPlans;
  const normalized = normalizeProductPlans(sourcePlans, products, channels);
  return normalized.filter((plan) => plan.enabled && plan.weeklyQuota > 0 && products.includes(plan.product));
}

function distributeProductDates(productPlan: ProductPlanConfig, publishMatrix: WeeklyPublishMatrixDay[]) {
  const activeDays = publishMatrix.filter((item) => !item.paused && item.plannedCount > 0);
  const dates: WeeklyPublishMatrixDay[] = [];

  if (!activeDays.length) {
    return dates;
  }

  for (let index = 0; index < productPlan.weeklyQuota; index += 1) {
    dates.push(activeDays[index % activeDays.length]);
  }

  return dates;
}

function createPlanTaskFromProductPlan(
  state: WorkbenchState,
  input: {
    weekStart: string;
    productPlan: ProductPlanConfig;
    matrixDay: WeeklyPublishMatrixDay;
    index: number;
    template: PromptVersionRecord;
  }
) {
  const product = input.productPlan.product;
  const channel = input.productPlan.channels[input.index % input.productPlan.channels.length] || state.workspaceSetting.enabledChannels[0] || "wechat";
  const rawBusinessSignal = pickWeeklyPlanTaskSignal(state, input.index);
  const businessSignal = rawBusinessSignal?.product && rawBusinessSignal.product !== product ? undefined : rawBusinessSignal;
  const contentType = businessSignal?.contentType || coerceContentType(input.index);
  const planContext = buildTaskPlanContext(product, contentType, businessSignal?.sourceProblem, businessSignal?.primaryDistilledTerm);
  const knowledgeBaseIds = getBoundKnowledgeBaseIds(input.productPlan);
  const task: ContentTask = {
    id: createId("task"),
    weeklyPlanId: `wp-${input.weekStart}`,
    publishDate: input.matrixDay.date,
    channel,
    product,
    knowledgeBaseIds: knowledgeBaseIds.length ? knowledgeBaseIds : undefined,
    knowledgeBaseId: knowledgeBaseIds[0],
    productExpressionRulePackageId: input.productPlan.productExpressionRulePackageId,
    title: buildTaskTitle(input.index, contentType),
    contentType,
    targetKeywords: planContext.targetKeywords,
    primaryDistilledTerm: planContext.primaryDistilledTerm,
    sourceProblem: planContext.sourceProblem,
    officialLinkTarget: planContext.officialLinkTarget,
    titleReason: planContext.reason,
    riskNote: planContext.riskNote,
    evidenceNeed: planContext.evidenceNeed,
    confidence: planContext.confidence,
    locked: input.matrixDay.locked,
    status: "planned",
    qaSummary: `${input.template.name} ${input.template.version}，按产品分组配额生成标题级计划。`
  };

  task.titleSourceAttributions = buildContentTaskTitleSourceAttributions(state, task, {
    matrixDay: input.matrixDay,
    businessSignal,
    promptVersion: input.template.version
  });

  return task;
}

function extractUrls(text: string) {
  return Array.from(new Set(text.match(/https?:\/\/[^\s)\]）】"'，。；、]+/g) || []));
}

function detectCompetitorAppeared(text: string) {
  return geoCompetitorKeywords.some((keyword) => text.includes(keyword));
}

function getGeoAccuracyStatus(input: Pick<GeoTestResult, "mentionedJoto" | "citedOfficialUrl" | "competitorAppeared" | "executionStatus">): NonNullable<GeoTestResult["accuracyStatus"]> {
  if (input.executionStatus && input.executionStatus !== "success") {
    return "needs_review";
  }

  if (input.mentionedJoto && input.citedOfficialUrl) {
    return input.competitorAppeared ? "needs_review" : "accurate";
  }

  return "needs_review";
}

function getGeoReviewStatus(input: Pick<GeoTestResult, "accuracyStatus" | "executionStatus">): NonNullable<GeoTestResult["reviewStatus"]> {
  return input.executionStatus === "success" && input.accuracyStatus === "accurate" ? "auto_checked" : "manual_review_needed";
}

function buildRegeneratedTaskTitle(task: ContentTask) {
  return pickTaskTitle(task.contentType, Date.now());
}

function formatContentTaskEditValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join("、");
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  return undefined;
}

function formatContentTaskFieldEditValue(field: keyof ContentTask, value: unknown) {
  if (field === "confidence" && typeof value === "number") {
    return value >= 0.65 ? "达到自动确认阈值" : "未达到自动确认阈值";
  }

  return formatContentTaskEditValue(value);
}

function buildContentTaskEditRecords(
  beforeTask: ContentTask,
  afterTask: ContentTask,
  source: ContentTaskEditRecord["source"]
): ContentTaskEditRecord[] {
  const fields: Array<{ field: keyof ContentTask; label: string }> = [
    { field: "publishDate", label: "发布日期" },
    { field: "title", label: "标题" },
    { field: "channel", label: "渠道" },
    { field: "product", label: "产品" },
    { field: "contentType", label: "内容类型" },
    { field: "targetKeywords", label: "目标关键词" },
    { field: "primaryDistilledTerm", label: "主蒸馏词" },
    { field: "sourceProblem", label: "来源问题" },
    { field: "officialLinkTarget", label: "官网链接目标" },
    { field: "riskNote", label: "风险说明" },
    { field: "evidenceNeed", label: "证据需求" },
    { field: "confidence", label: "确认阈值状态" },
    { field: "locked", label: "锁定状态" }
  ];

  const records: ContentTaskEditRecord[] = [];

  for (const item of fields) {
    const before = formatContentTaskFieldEditValue(item.field, beforeTask[item.field]);
    const after = formatContentTaskFieldEditValue(item.field, afterTask[item.field]);

    if (before === after) {
      continue;
    }

    records.push({
      id: createId("task_edit"),
      field: String(item.field),
      label: item.label,
      before,
      after,
      source,
      editedAt: nowIso()
    });
  }

  return records;
}

function appendContentTaskEditRecords(task: ContentTask, records: ContentTaskEditRecord[]) {
  if (!records.length) {
    return task;
  }

  return {
    ...task,
    editRecords: [...(task.editRecords || []), ...records].slice(-20)
  };
}

function appendContentTaskRiskAcceptanceRecord(task: ContentTask, record: ContentTaskRiskAcceptanceRecord) {
  return {
    ...task,
    riskAcceptanceRecords: [...(task.riskAcceptanceRecords || []), record].slice(-10)
  };
}

function appendContentTaskRejectionRecord(task: ContentTask, record: ContentTaskRejectionRecord) {
  return {
    ...task,
    rejectionRecords: [...(task.rejectionRecords || []), record].slice(-10)
  };
}

function getContentTaskReviewReasons(task: ContentTask) {
  const reasons: string[] = [];

  if ((task.confidence ?? 1) < 0.65) {
    reasons.push("未达到自动确认阈值");
  }

  if (!task.officialLinkTarget) {
    reasons.push("官网链接缺失");
  }

  if (!task.primaryDistilledTerm || !task.sourceProblem) {
    reasons.push("语义约束待补");
  }

  if (isBlockingContentTaskRiskNote(task.riskNote)) {
    reasons.push("风险说明需复核");
  }

  return reasons;
}

function isBlockingContentTaskRiskNote(riskNote?: string) {
  if (!riskNote || riskNote.includes("暂无")) {
    return false;
  }

  return /高风险|阻断|缺失|不足|未提到|越界|夸大|承诺|违规|错误|竞品|不建议/.test(riskNote);
}

function formatPromptProfile(promptVersion: Pick<PromptVersionRecord, "id" | "version">) {
  return `${promptVersion.id}@${promptVersion.version}`;
}

function createDraftEditAction(input: Omit<DraftEditAction, "id" | "createdAt">): DraftEditAction {
  return {
    id: createId("draft_edit"),
    createdAt: nowIso(),
    ...input
  };
}

function normalizeKeepRiskReasonCategory(value: unknown): DraftRiskKeepReasonCategory | undefined {
  return value === "false_positive" ||
    value === "evidence_added" ||
    value === "business_exception" ||
    value === "source_quote" ||
    value === "uncategorized"
    ? value
    : undefined;
}

function inferKeepRiskReasonCategory(reason: string): DraftRiskKeepReasonCategory {
  const text = reason.toLowerCase();

  if (text.includes("引用") || text.includes("原文") || text.includes("客户原话") || text.includes("访谈")) {
    return "source_quote";
  }

  if (text.includes("误报") || text.includes("不是风险") || text.includes("可接受") || text.includes("上下文")) {
    return "false_positive";
  }

  if (text.includes("证据") || text.includes("官网") || text.includes("链接") || text.includes("案例") || text.includes("资料") || text.includes("已补")) {
    return "evidence_added";
  }

  if (text.includes("业务") || text.includes("必须") || text.includes("特殊") || text.includes("渠道") || text.includes("活动") || text.includes("合规")) {
    return "business_exception";
  }

  return "uncategorized";
}

function getTextDiffStats(before: string, after: string) {
  const beforeLength = before.length;
  const afterLength = after.length;

  if (before === after) {
    return {
      beforeLength,
      afterLength,
      changedCharacterCount: 0,
      changedRatio: 0
    };
  }

  let prefixLength = 0;
  const maxPrefixLength = Math.min(beforeLength, afterLength);

  while (prefixLength < maxPrefixLength && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = Math.min(beforeLength - prefixLength, afterLength - prefixLength);

  while (
    suffixLength < maxSuffixLength &&
    before[beforeLength - 1 - suffixLength] === after[afterLength - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removedLength = Math.max(0, beforeLength - prefixLength - suffixLength);
  const addedLength = Math.max(0, afterLength - prefixLength - suffixLength);
  const changedCharacterCount = removedLength + addedLength;
  const baseLength = Math.max(beforeLength, afterLength, 1);

  return {
    beforeLength,
    afterLength,
    changedCharacterCount,
    changedRatio: Number((changedCharacterCount / baseLength).toFixed(4))
  };
}

function getDraftGenerationFailureReasons(input: {
  task: ContentTask;
  status?: "success" | "pending_config" | "failed";
  missingConfig?: string[];
  errorMessage?: string;
  evidenceSelection?: DraftEvidenceSelection;
  content?: string;
}): DraftGenerationFailure[] {
  const reasons: DraftGenerationFailure[] = [];
  const evidenceSelection = input.evidenceSelection || {};
  const missingEvidence = evidenceSelection.missingEvidence || [];
  const status = input.status || "success";

  if (status === "pending_config" || input.missingConfig?.length) {
    reasons.push({
      code: "provider_config_missing",
      label: "模型配置未完成",
      severity: "warning",
      message: `缺少 ${input.missingConfig?.join("、") || "模型必填配置"}，本次使用本地规则生成草稿。`,
      nextAction: "联系工作台运营补齐模型配置；当前可继续用本地规则稿完成发布。"
    });
  }

  if (status === "failed") {
    reasons.push({
      code: "model_failure",
      label: "模型调用失败",
      severity: "warning",
      message: input.errorMessage || "模型调用失败，本次已回退到本地规则稿。",
      nextAction: "联系工作台运营检查模型状态；当前先检查本地规则稿是否可用。"
    });
  }

  if (missingEvidence.length) {
    reasons.push({
      code: "evidence_missing",
      label: "证据不足",
      severity: "warning",
      message: missingEvidence.join("；"),
      nextAction: "在 Brief 抽屉补选知识库证据，或添加人工补充证据后重新生成。"
    });
  }

  if (!input.task.officialLinkTarget) {
    reasons.push({
      code: "rule_failure",
      label: "官网链接目标缺失",
      severity: "warning",
      message: "当前任务缺少官网链接目标，正文只能使用默认 jotoai.com。",
      nextAction: "回到周计划补齐官网链接目标，再重新生成正文。"
    });
  }

  if (!input.task.primaryDistilledTerm && !input.task.targetKeywords.length) {
    reasons.push({
      code: "structure_failure",
      label: "任务结构不完整",
      severity: "blocker",
      message: "当前任务缺少主蒸馏词或目标关键词，正文生成缺少语义锚点。",
      nextAction: "回到周计划补齐主蒸馏词或重新生成标题。"
    });
  }

  if (input.content) {
    if (input.task.product === "joto_brand" && !input.content.includes("JOTO")) {
      reasons.push({
        code: "product_boundary",
        label: "产品表达边界偏弱",
        severity: "warning",
        message: "正文没有明确建立 JOTO 与当前问题的关系。",
        nextAction: "补充 JOTO 的交付、服务或官网证据，再运行二次质检。"
      });
    }

    if (input.task.product === "weike_guardrails" && !input.content.includes("唯客")) {
      reasons.push({
        code: "product_boundary",
        label: "产品表达边界偏弱",
        severity: "warning",
        message: "正文没有明确建立唯客 AI 护栏与当前场景的关系。",
        nextAction: "补充唯客 AI 护栏的治理场景、风险识别或审计留痕表达。"
      });
    }
  }

  return reasons;
}

function normalizeEvidenceSelection(input: unknown): DraftEvidenceSelection {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const value = input as Record<string, unknown>;
  const selectedChunkIds = Array.isArray(value.selectedChunkIds) ? value.selectedChunkIds.map(String).filter(Boolean).slice(0, 6) : undefined;
  const missingEvidence = Array.isArray(value.missingEvidence) ? value.missingEvidence.map(String).filter(Boolean).slice(0, 6) : undefined;
  const evidenceSummary = typeof value.evidenceSummary === "string" && value.evidenceSummary.trim() ? value.evidenceSummary.trim() : undefined;
  const evidenceSupplement = typeof value.evidenceSupplement === "string" && value.evidenceSupplement.trim() ? value.evidenceSupplement.trim() : undefined;

  return {
    selectedChunkIds,
    evidenceSummary,
    missingEvidence,
    evidenceSupplement
  };
}

function getEnabledKnowledgeChunks(state: Pick<WorkbenchState, "knowledgeBases">): KnowledgeChunk[] {
  return state.knowledgeBases.flatMap((knowledgeBase) =>
    (knowledgeBase.chunks || [])
      .filter((chunk) => knowledgeBase.status === "enabled" && chunk.status === "enabled")
      .map((chunk) => ({
        ...chunk,
        sourceTitle: chunk.sourceTitle || knowledgeBase.name
      }))
  );
}

function getDefaultEvidenceSelection(state: Pick<WorkbenchState, "knowledgeBases">, task: ContentTask, input?: unknown): DraftEvidenceSelection {
  const explicitSelection = normalizeEvidenceSelection(input);
  const chunks = getEnabledKnowledgeChunks(state);
  const boundKnowledgeBaseIds = getBoundKnowledgeBaseIds(task);
  const boundChunks = boundKnowledgeBaseIds.length ? chunks.filter((chunk) => boundKnowledgeBaseIds.includes(chunk.knowledgeBaseId)) : chunks;
  const selectedChunkIds = explicitSelection.selectedChunkIds?.length
    ? explicitSelection.selectedChunkIds
    : boundChunks
        .filter((chunk) => {
          const text = `${chunk.sourceTitle} ${chunk.chunkTitle} ${chunk.content}`;
          return task.targetKeywords.some((keyword) => text.includes(keyword)) || (task.primaryDistilledTerm ? text.includes(task.primaryDistilledTerm) : false);
        })
        .slice(0, 4)
        .map((chunk) => chunk.id);
  const selectedChunks = chunks.filter((chunk) => selectedChunkIds.includes(chunk.id));
  const missingEvidence = explicitSelection.missingEvidence?.length
    ? explicitSelection.missingEvidence
    : selectedChunks.length
      ? []
      : [task.evidenceNeed || "缺少可直接引用的知识库证据。"];

  return {
    selectedChunkIds,
    evidenceSummary:
      explicitSelection.evidenceSummary ||
      (selectedChunks.length
        ? selectedChunks.map((chunk) => `${chunk.sourceTitle} / ${chunk.chunkTitle}`).join("；")
        : "未选择知识库证据片段，生成时只能使用任务信息和本地规则。"),
    missingEvidence,
    evidenceSupplement: explicitSelection.evidenceSupplement
  };
}

function hasUsableEvidenceSelection(evidenceSelection: DraftEvidenceSelection) {
  return Boolean((evidenceSelection.selectedChunkIds?.length && !evidenceSelection.missingEvidence?.length) || evidenceSelection.evidenceSupplement);
}

function buildMissingEvidenceItem(task: ContentTask, evidenceSelection: DraftEvidenceSelection) {
  return {
    taskId: task.id,
    title: task.title,
    reasons: evidenceSelection.missingEvidence?.length ? evidenceSelection.missingEvidence : [task.evidenceNeed || "缺少可直接引用的知识库证据。"]
  };
}

function getProductExpressionRuleSelection(state: Pick<WorkbenchState, "knowledgeBases">, task: ContentTask): ProductExpressionRuleSelection | undefined {
  const candidates = state.knowledgeBases.filter((knowledgeBase) => knowledgeBase.productExpressionSource && knowledgeBase.productExpressionRuleDraft);

  if (!candidates.length) {
    return undefined;
  }

  const explicitlyBound = task.productExpressionRulePackageId
    ? candidates.find((knowledgeBase) => knowledgeBase.id === task.productExpressionRulePackageId)
    : undefined;

  function isRelevant(knowledgeBase: KnowledgeBase) {
    const draft = knowledgeBase.productExpressionRuleDraft;
    const text = `${knowledgeBase.name} ${knowledgeBase.usageScope} ${knowledgeBase.contentPreview} ${draft?.summary || ""}`.toLowerCase();

    if (task.product === "weike_guardrails") {
      return knowledgeBase.type === "product" || text.includes("唯客") || text.includes("护栏") || text.includes("guardrail");
    }

    return knowledgeBase.type === "brand" || text.includes("joto") || text.includes("dify");
  }

  const selected =
    explicitlyBound ||
    candidates.find((knowledgeBase) => knowledgeBase.productExpressionRuleDraft?.status === "active" && isRelevant(knowledgeBase)) ||
    candidates.find((knowledgeBase) => isRelevant(knowledgeBase)) ||
    candidates.find((knowledgeBase) => knowledgeBase.productExpressionRuleDraft?.status === "active") ||
    candidates[0];
  const draft = selected.productExpressionRuleDraft;

  if (!draft) {
    return undefined;
  }

  return {
    source: selected.name,
    version: draft.version,
    status: draft.status,
    summary: draft.summary
  };
}

function getDraftQualityFromIssues(
  blockers: string[],
  warnings: string[],
  issues: DraftQaResult["issues"] = []
): Pick<DraftQaResult, "qualityGrade" | "qualityStatus" | "qualitySummary" | "copyAllowed" | "distributionAllowed" | "feedbackTarget"> {
  const hasReviewIssue = issues.some((issue) => issue.severity === "review");
  const primaryFeedbackTarget =
    issues.find((issue) => issue.severity === "blocker" || issue.severity === "review")?.feedbackTarget ||
    issues.find((issue) => issue.feedbackTarget)?.feedbackTarget ||
    "prompt";

  if (blockers.length) {
    return {
      qualityGrade: "D",
      qualityStatus: "blocked",
      qualitySummary: "D级：存在阻断风险，不可写入平台草稿箱。",
      copyAllowed: false,
      distributionAllowed: false,
      feedbackTarget: primaryFeedbackTarget
    };
  }

  if (hasReviewIssue) {
    return {
      qualityGrade: "C",
      qualityStatus: "review_required",
      qualitySummary: "C级：需要人工复核，复核后重新质检再分发。",
      copyAllowed: false,
      distributionAllowed: false,
      feedbackTarget: primaryFeedbackTarget
    };
  }

  if (warnings.length) {
    return {
      qualityGrade: "B",
      qualityStatus: "warning",
      qualitySummary: "B级：有提醒但允许写入平台草稿箱。",
      copyAllowed: true,
      distributionAllowed: true,
      feedbackTarget: primaryFeedbackTarget
    };
  }

  return {
    qualityGrade: "A",
    qualityStatus: "pass",
    qualitySummary: "A级：可直接写入平台草稿箱。",
    copyAllowed: true,
    distributionAllowed: true,
    feedbackTarget: primaryFeedbackTarget
  };
}

function runDraftQa(
  task: ContentTask,
  content: string,
  editedSegments: string[] = [],
  promptVersions = createInitialPromptVersions(),
  acceptedRiskSegments: Array<{ segment: string; reason: string }> = [],
  editActions: DraftEditAction[] = []
): DraftQaResult {
  const template = getActivePromptVersion({ promptVersions }, "draft_second_qa");
  const blockers: string[] = [];
  const warnings: string[] = [];
  const issues: DraftQaResult["issues"] = [];
  const failedSegments: string[] = [];
  const sensitiveMatches = Array.from(new Set(content.match(/最强|绝对领先|永久免费|100%/g) || []));
  const acceptedRiskBySegment = new Map(acceptedRiskSegments.map((item) => [item.segment, item.reason]));

  if (task.product === "joto_brand" && !content.includes("JOTO")) {
    warnings.push("正文缺少 JOTO 品牌词");
    issues.push({
      code: "brand_term_missing",
      label: "正文与标题偏离",
      severity: "warning",
      rule: "品牌词缺失",
      location: "全文",
      suggestedAction: "rewrite",
      feedbackTarget: "prompt"
    });
  }

  if (task.product === "weike_guardrails" && !content.includes("唯客")) {
    warnings.push("正文缺少唯客产品词");
    issues.push({
      code: "product_term_missing",
      label: "正文与标题偏离",
      severity: "warning",
      rule: "产品词缺失",
      location: "全文",
      suggestedAction: "rewrite",
      feedbackTarget: "prompt"
    });
  }

  if (!content.includes("jotoai.com")) {
    warnings.push("建议补充官网链接");
    issues.push({
      code: "official_source_missing",
      label: "缺少官网信源",
      severity: "warning",
      rule: "官网链接目标缺失",
      location: "全文",
      suggestedAction: "add_evidence",
      feedbackTarget: "evidence_selection"
    });
  }

  const unacceptedSensitiveMatches = sensitiveMatches.filter((match) => !acceptedRiskBySegment.has(match));
  const acceptedSensitiveMatches = sensitiveMatches.filter((match) => acceptedRiskBySegment.has(match));

  if (acceptedSensitiveMatches.length) {
    warnings.push("存在人工保留的高风险表达");
    issues.push(
      ...acceptedSensitiveMatches.map((match) => ({
        code: "risk_kept_with_reason" as const,
        label: "存在夸大表达",
        severity: "warning" as const,
        rule: "人工保留高风险表达",
        location: "正文",
        failedText: match,
        failedSegment: match,
        suggestedAction: "keep_with_reason" as const,
        feedbackTarget: "rule_package" as const,
        allowedActions: ["restore_previous" as const, "delete_failed_segment" as const, "ai_rewrite_segment" as const]
      }))
    );
  }

  if (unacceptedSensitiveMatches.length) {
    blockers.push("存在敏感或夸大表达");
    failedSegments.push(...unacceptedSensitiveMatches);
    issues.push({
      code: "exaggerated_claim",
      label: "存在夸大表达",
      severity: "blocker",
      rule: "夸大表达",
      location: "正文",
      failedText: unacceptedSensitiveMatches.join("、"),
      failedSegment: unacceptedSensitiveMatches.join("、"),
      suggestedAction: "delete",
      feedbackTarget: "rule_package",
      allowedActions: ["restore_previous", "delete_failed_segment", "ai_rewrite_segment", "keep_failed_segment"]
    });
  }

  const quality = getDraftQualityFromIssues(blockers, warnings, issues);

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    summary: blockers.length
      ? `存在 ${blockers.length} 个阻断项，暂不能复制全文。规则：${template?.name || "AI 二次质检模板"} ${template?.version || "v3"}。`
      : warnings.length
        ? `质检通过，但有 ${warnings.length} 个提醒。规则：${template?.name || "AI 二次质检模板"} ${template?.version || "v3"}。`
        : `质检通过，可以复制全文。规则：${template?.name || "AI 二次质检模板"} ${template?.version || "v3"}。`,
    qualityGrade: quality.qualityGrade,
    qualityStatus: quality.qualityStatus,
    qualitySummary: quality.qualitySummary,
    issues,
    editedSegments,
    editActions,
    failedSegments: Array.from(new Set(failedSegments)),
    copyAllowed: quality.copyAllowed,
    distributionAllowed: quality.distributionAllowed,
    feedbackTarget: quality.feedbackTarget
  };
}

function createLocalDraft(
  task: ContentTask,
  existingDraft?: ArticleDraft,
  options: {
    provider?: string;
    model?: string;
    status?: "success" | "pending_config" | "failed";
    missingConfig?: string[];
    errorMessage?: string;
    promptVersions?: PromptVersionRecord[];
    evidenceSelection?: DraftEvidenceSelection;
    productExpressionRule?: ProductExpressionRuleSelection;
  } = {}
): ArticleDraft {
  const promptVersions = options.promptVersions || createInitialPromptVersions();
  const evidenceTemplate = getActivePromptVersion({ promptVersions }, "evidence_selection");
  const bodyTemplate = getActivePromptVersion({ promptVersions }, "batch_body_generation");
  const channelName = channelLabels[task.channel];
  const productName = productLabels[task.product];
  const officialLinkTarget = task.officialLinkTarget || "https://jotoai.com";
  const primaryDistilledTerm = task.primaryDistilledTerm || task.targetKeywords[1] || task.targetKeywords[0];
  const evidenceSelection = options.evidenceSelection || {};
  const productExpressionRule = options.productExpressionRule;
  const content = [
    `很多团队在做 ${primaryDistilledTerm} 相关内容时，容易先从功能点出发，最后写成一篇没有判断的说明文。`,
    `这篇 ${channelName} 文章应该先回答一个真实问题：${task.title}。`,
    `如果把它放回 JOTO 当前的 GTM 工作流里看，内容的作用不是堆关键词，而是帮助读者理解企业接入 AI 能力时需要哪些交付、治理和安全边界。`,
    `生成前使用「${evidenceTemplate.name}」选择知识片段，再用「${bodyTemplate.name}」组织正文。`,
    productExpressionRule ? `本次产品表达规则包：${productExpressionRule.source} ${productExpressionRule.version}（${productExpressionRule.status === "active" ? "已生效" : "未生效"}）。` : "",
    evidenceSelection.evidenceSummary ? `本次证据选择摘要：${evidenceSelection.evidenceSummary}。` : "",
    evidenceSelection.evidenceSupplement ? `人工补充证据：${evidenceSelection.evidenceSupplement}。` : "",
    task.product === "weike_guardrails"
      ? "唯客 AI 护栏适合承担输出安全、风险识别和审计留痕这类稳定治理工作。"
      : "JOTO 的价值应该放在企业级交付、长期运维和 AI 应用治理的完整链路里理解。",
    `后续发布时建议补充官网链接：${officialLinkTarget}，并根据 ${channelName} 的阅读习惯调整标题和段落密度。`
  ]
    .filter(Boolean)
    .join("\n\n");
  const failureReasons = getDraftGenerationFailureReasons({
    task,
    status: options.status,
    missingConfig: options.missingConfig,
    errorMessage: options.errorMessage,
    evidenceSelection,
    content
  });
  const qaResult = runDraftQa(task, content, [], promptVersions);

  return {
    id: existingDraft?.id || createId("draft"),
    taskId: task.id,
    title: task.title,
    summary: `围绕「${task.title}」生成的本地规则稿，后续可切换为真实 AI 生成。`,
    content,
    channel: task.channel,
    qaResult,
    version: existingDraft ? existingDraft.version + 1 : 1,
    status: "draft",
    generationSource: {
      mode: "local_rule",
      generatedAt: nowIso(),
      provider: options.provider,
      model: options.model,
      promptProfile: formatPromptProfile(bodyTemplate),
      evidenceProfile: formatPromptProfile(evidenceTemplate),
      productExpressionRuleVersion: productExpressionRule?.version,
      productExpressionRuleSource: productExpressionRule?.source,
      selectedChunkIds: evidenceSelection.selectedChunkIds || [],
      evidenceSummary: evidenceSelection.evidenceSummary,
      missingEvidence: evidenceSelection.missingEvidence || [],
      evidenceSupplement: evidenceSelection.evidenceSupplement,
      fallbackTriggered: options.status === "pending_config" || options.status === "failed",
      failureReasons,
      status: options.status || "success"
    },
    updatedAt: nowIso()
  };
}

function getContentProviderKey(): AiProviderKey {
  const provider = process.env.CONTENT_GENERATION_PROVIDER;

  if (provider === "deepseek" || provider === "doubao" || provider === "qwen") {
    return provider;
  }

  return "qwen";
}

async function createDraftWithProviderFallback(
  task: ContentTask,
  existingDraft?: ArticleDraft,
  promptVersions = createInitialPromptVersions(),
  evidenceSelection: DraftEvidenceSelection = {},
  productExpressionRule?: ProductExpressionRuleSelection
) {
  const provider = getContentProviderKey();
  const evidenceTemplate = getActivePromptVersion({ promptVersions }, "evidence_selection");
  const bodyTemplate = getActivePromptVersion({ promptVersions }, "batch_body_generation");
  const aiResult = await callAiProvider({
    provider,
    systemPrompt:
      "你是 JOTO GTM 内容工作台的内容生成 Worker。只输出可发布正文，不要输出解释。写作要克制、具体、避免夸大承诺。",
    userPrompt: [
      `渠道：${channelLabels[task.channel]}`,
      `产品：${productLabels[task.product]}`,
      `标题：${task.title}`,
      `内容类型：${task.contentType}`,
      `主蒸馏词：${task.primaryDistilledTerm || task.targetKeywords[1] || task.targetKeywords[0]}`,
      `来源问题：${task.sourceProblem || "本周内容增长计划"}`,
      `官网链接目标：${task.officialLinkTarget || "https://jotoai.com"}`,
      `目标关键词：${task.targetKeywords.join("、")}`,
      `证据选择规则：${evidenceTemplate.name} ${evidenceTemplate.version}`,
      `正文生成规则：${bodyTemplate.name} ${bodyTemplate.version}`,
      productExpressionRule
        ? `产品表达规则包：${productExpressionRule.source} ${productExpressionRule.version}（${productExpressionRule.status === "active" ? "已生效" : "未生效"}）`
        : "产品表达规则包：暂无已匹配规则包",
      `已选证据片段 ID：${evidenceSelection.selectedChunkIds?.length ? evidenceSelection.selectedChunkIds.join("、") : "未选择"}`,
      `证据摘要：${evidenceSelection.evidenceSummary || "暂无"}`,
      `缺口证据：${evidenceSelection.missingEvidence?.length ? evidenceSelection.missingEvidence.join("、") : "暂无"}`,
      evidenceSelection.evidenceSupplement ? `人工补充证据：${evidenceSelection.evidenceSupplement}` : "",
      "请生成一篇适合该渠道的中文文章，保留真实问题意识，并自然提及 JOTO 或唯客。"
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.4
  });

  if (aiResult.ok && aiResult.content) {
    const failureReasons = getDraftGenerationFailureReasons({
      task,
      status: "success",
      evidenceSelection,
      content: aiResult.content
    });
    const qaResult = runDraftQa(task, aiResult.content, [], promptVersions);

    return {
      id: existingDraft?.id || createId("draft"),
      taskId: task.id,
      title: task.title,
      summary: "由 AI 生成的渠道稿。",
      content: aiResult.content,
      channel: task.channel,
      qaResult,
      version: existingDraft ? existingDraft.version + 1 : 1,
      status: "draft" as const,
      generationSource: {
        mode: "ai_provider" as const,
        provider: aiResult.provider,
        model: aiResult.model,
        generatedAt: nowIso(),
        promptProfile: formatPromptProfile(bodyTemplate),
        evidenceProfile: formatPromptProfile(evidenceTemplate),
        productExpressionRuleVersion: productExpressionRule?.version,
        productExpressionRuleSource: productExpressionRule?.source,
        selectedChunkIds: evidenceSelection.selectedChunkIds || [],
        evidenceSummary: evidenceSelection.evidenceSummary,
        missingEvidence: evidenceSelection.missingEvidence || [],
        evidenceSupplement: evidenceSelection.evidenceSupplement,
        fallbackTriggered: false,
        failureReasons,
        status: "success" as const
      },
      updatedAt: nowIso()
    };
  }

  return createLocalDraft(task, existingDraft, {
    provider: aiResult.provider,
    model: aiResult.model,
    status: aiResult.status,
    missingConfig: aiResult.missingConfig,
    errorMessage: aiResult.errorMessage,
    promptVersions,
    evidenceSelection,
    productExpressionRule
  });
}

function updateTaskStatusForDraft(task: ContentTask, draft: ArticleDraft): ContentTask {
  return {
    ...task,
    status: draft.qaResult.passed ? "pending_review" : "qa_failed",
    qaSummary: draft.qaResult.passed
      ? draft.qaResult.warnings.length
        ? `有 ${draft.qaResult.warnings.length} 个警告`
        : "通过"
      : `有 ${draft.qaResult.blockers.length} 个阻断项`
  };
}

export function getDashboardSummary() {
  const state = readWorkbenchState();
  const weeklyTasks = getCurrentWeeklyTasks(state);
  const weeklyTaskIds = new Set(weeklyTasks.map((task) => task.id));
  const weeklyDraftIds = new Set(state.drafts.filter((draft) => weeklyTaskIds.has(draft.taskId)).map((draft) => draft.id));
  const weeklyPublishRecords = state.publishRecords.filter((record) => weeklyDraftIds.has(record.draftId));
  const generated = weeklyTasks.filter((task) =>
    ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)
  ).length;
  const approved = weeklyTasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = weeklyPublishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = weeklyPublishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    weeklyPlan: state.weeklyPlan,
    metrics: {
      targetTotal: state.weeklyPlan.targetTotalCount,
      generated,
      approved,
      published,
      pendingUrl,
      geoHitRate: `${state.geoResults.filter((item) => item.mentionedJoto).length}/${state.geoResults.length}`,
      aiBotPv: state.botVisits.reduce((sum, item) => sum + item.pv, 0)
    },
    dataSource: state.runtime.storage
  };
}

export function generateWeeklyPlan(input: GenerateWeeklyPlanInput = {}) {
  const state = readWorkbenchState();
  const template = getActivePromptVersion(state, "weekly_plan_generation");
  const days = clampNumber(input.days, 5, 1, 7);
  const dailyCount = clampNumber(input.dailyCount, 3, 1, 10);
  const channels: ChannelKey[] = input.channels?.length ? input.channels : ["wechat", "csdn", "juejin", "zhihu_toutiao_general"];
  const products: ProductKey[] = input.products?.length ? input.products : ["joto_brand", "weike_guardrails"];
  const weekStart = input.weekStart || state.weeklyPlan.weekStart;
  const weekEnd = input.weekEnd || addDays(weekStart, 6);
  const publishMatrix = normalizePublishMatrix(input, weekStart);
  const matrixIssues = getPublishMatrixIssues(publishMatrix);
  const blockingIssues = matrixIssues.filter((issue) => issue.level === "error");
  const targetTotalCount = publishMatrix.reduce((sum, item) => sum + item.plannedCount, 0);
  const productPlans = getActiveProductPlans(input, state, channels, products);
  const tasks: ContentTask[] = [];

  if (blockingIssues.length) {
    return {
      ok: false,
      status: "pending_input" as const,
      message: blockingIssues[0].message,
      data: {
        publishMatrix,
        matrixIssues
      }
    };
  }

  if (productPlans.length) {
    for (const productPlan of productPlans) {
      const productDates = distributeProductDates(productPlan, publishMatrix);

      for (const matrixDay of productDates) {
        const index = tasks.length;
        tasks.push(
          createPlanTaskFromProductPlan(state, {
            weekStart,
            productPlan,
            matrixDay,
            index,
            template
          })
        );
      }
    }
  } else {
    for (const matrixDay of publishMatrix) {
      if (matrixDay.paused || matrixDay.plannedCount <= 0) {
        continue;
      }

      for (let count = 0; count < matrixDay.plannedCount; count += 1) {
        const index = tasks.length;
        const productPlan: ProductPlanConfig = {
          product: products[index % products.length],
          weeklyQuota: 1,
          channels,
          enabled: true
        };
        tasks.push(
          createPlanTaskFromProductPlan(state, {
            weekStart,
            productPlan,
            matrixDay,
            index,
            template
          })
        );
      }
    }
  }

  const isTargetWeekTask = (task: ContentTask) => task.weeklyPlanId === `wp-${weekStart}` || isDateInWeek(task.publishDate, weekStart);
  const targetWeekExistingTasks = state.tasks.filter(isTargetWeekTask);
  const historicalTasks = state.tasks.filter((task) => !isTargetWeekTask(task));
  const replaceAll = input.generationMode === "replace_all" || !targetWeekExistingTasks.length;
  const generatedProducts = new Set(tasks.map((task) => task.product));
  const preservedTasks = replaceAll
    ? []
    : targetWeekExistingTasks.filter((task) => !generatedProducts.has(task.product) || !isMutablePlanTask(task));
  const nextTasks = [...preservedTasks, ...tasks].sort((left, right) => `${left.publishDate}-${left.product}`.localeCompare(`${right.publishDate}-${right.product}`));

  state.weeklyPlan = {
    id: `wp-${weekStart}`,
    weekStart,
    weekEnd,
    targetTotalCount: productPlans.length ? productPlans.reduce((sum, item) => sum + item.weeklyQuota, 0) : targetTotalCount,
    status: "draft",
    publishMatrix,
    productPlans,
    generationSource: buildWeeklyPlanGenerationSource(state, template, matrixIssues)
  };
  state.tasks = [...historicalTasks, ...nextTasks];

  if (replaceAll) {
    const targetTaskIds = new Set(targetWeekExistingTasks.map((task) => task.id));
    const targetDraftIds = new Set(state.drafts.filter((draft) => targetTaskIds.has(draft.taskId)).map((draft) => draft.id));
    state.drafts = state.drafts.filter((draft) => !targetTaskIds.has(draft.taskId));
    state.publishRecords = state.publishRecords.filter((record) => !targetDraftIds.has(record.draftId));
  }

  saveWithEvent(
    state,
    "weekly_plan_generated",
    `Generated ${tasks.length} local-rule content tasks from ${productPlans.length ? "product quota groups" : "publish matrix"}.`
  );

  return {
    ok: true,
    status: "success" as const,
    weeklyPlan: state.weeklyPlan,
    tasks: nextTasks,
    matrixIssues
  };
}

export function patchWeeklyPlan(
  id: string,
  input: Record<string, unknown>
): WorkflowResult<{ weeklyPlan: WeeklyPlan; tasks: ContentTask[]; matrixIssues?: PublishMatrixIssue[] }> {
  const state = readWorkbenchState();
  const channels = coerceChannels(input.channels);
  const products = coerceProducts(input.products);
  const productPlans = normalizeProductPlans(input.productPlans, products || state.workspaceSetting.enabledProducts, channels || state.workspaceSetting.enabledChannels);
  const nextWeekStart = typeof input.weekStart === "string" ? input.weekStart : state.weeklyPlan.weekStart;
  const nextWeekEnd = typeof input.weekEnd === "string" ? input.weekEnd : state.weeklyPlan.weekEnd;
  const nextPublishMatrix = Array.isArray(input.publishMatrix)
    ? normalizePublishMatrix(
        {
          publishMatrix: input.publishMatrix as Array<Partial<WeeklyPublishMatrixDay>>,
          days: 7,
          dailyCount: state.workspaceSetting.defaultDailyCount
        },
        nextWeekStart
      )
    : state.weeklyPlan.publishMatrix;
  const matrixIssues = nextPublishMatrix?.length ? getPublishMatrixIssues(nextPublishMatrix) : [];
  const blockingIssues = matrixIssues.filter((issue) => issue.level === "error");

  if (blockingIssues.length) {
    return {
      ok: false,
      status: "failed",
      message: blockingIssues[0].message,
      data: {
        weeklyPlan: state.weeklyPlan,
        tasks: state.tasks,
        matrixIssues
      }
    };
  }
  const matrixTargetTotalCount = nextPublishMatrix?.reduce((sum, item) => sum + item.plannedCount, 0);

  state.weeklyPlan = {
    ...state.weeklyPlan,
    id,
    weekStart: nextWeekStart,
    weekEnd: nextWeekEnd,
    targetTotalCount:
      typeof input.targetTotalCount === "number"
        ? clampNumber(input.targetTotalCount, state.weeklyPlan.targetTotalCount, 1, 200)
        : matrixTargetTotalCount || state.weeklyPlan.targetTotalCount,
    status: typeof input.status === "string" ? (input.status as WeeklyPlan["status"]) : state.weeklyPlan.status,
    publishMatrix: nextPublishMatrix || state.weeklyPlan.publishMatrix,
    productPlans: productPlans.length ? productPlans : state.weeklyPlan.productPlans
  };

  saveWithEvent(state, "weekly_plan_updated", `Updated weekly plan ${id}${nextPublishMatrix ? " publish matrix" : ""}.`);

  return {
    ok: true,
    status: "success",
    message: nextPublishMatrix ? "周发布设置已保存，后续生成计划预览会按该矩阵排期。" : "周计划已保存到本地持久化状态。",
    data: {
      weeklyPlan: state.weeklyPlan,
      tasks: state.tasks,
      matrixIssues
    }
  };
}

export function patchContentTask(id: string, input: Record<string, unknown>): WorkflowResult<{ task: ContentTask }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === id);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${id}`
    };
  }

  const current = state.tasks[taskIndex];
  const channels = coerceChannels([input.channel]);
  const products = coerceProducts([input.product]);
  const contentTypes: ContentType[] = ["brand", "scenario", "technical", "faq", "comparison", "case"];
  const nextContentType = contentTypes.includes(input.contentType as ContentType) ? (input.contentType as ContentType) : current.contentType;
  const inputKnowledgeBaseIds = Object.prototype.hasOwnProperty.call(input, "knowledgeBaseIds")
    ? coerceStringIds(input.knowledgeBaseIds) || []
    : Object.prototype.hasOwnProperty.call(input, "knowledgeBaseId")
      ? typeof input.knowledgeBaseId === "string" && input.knowledgeBaseId.trim()
        ? [input.knowledgeBaseId.trim()]
        : []
      : getBoundKnowledgeBaseIds(current);
  const taskPatch: ContentTask = {
    ...current,
    publishDate: typeof input.publishDate === "string" && input.publishDate.trim() ? input.publishDate.trim() : current.publishDate,
    channel: channels?.[0] || current.channel,
    product: products?.[0] || current.product,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : current.title,
    contentType: nextContentType,
    knowledgeBaseIds: inputKnowledgeBaseIds.length ? inputKnowledgeBaseIds : undefined,
    knowledgeBaseId: inputKnowledgeBaseIds[0],
    productExpressionRulePackageId:
      typeof input.productExpressionRulePackageId === "string" && input.productExpressionRulePackageId.trim()
        ? input.productExpressionRulePackageId.trim()
        : current.productExpressionRulePackageId,
    targetKeywords: Array.isArray(input.targetKeywords)
      ? input.targetKeywords.map(String).map((item) => item.trim()).filter(Boolean)
      : typeof input.targetKeywords === "string"
        ? input.targetKeywords.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
        : current.targetKeywords,
    primaryDistilledTerm:
      typeof input.primaryDistilledTerm === "string" && input.primaryDistilledTerm.trim()
        ? input.primaryDistilledTerm.trim()
        : current.primaryDistilledTerm,
    sourceProblem: typeof input.sourceProblem === "string" && input.sourceProblem.trim() ? input.sourceProblem.trim() : current.sourceProblem,
    officialLinkTarget:
      typeof input.officialLinkTarget === "string" && input.officialLinkTarget.trim()
        ? input.officialLinkTarget.trim()
        : current.officialLinkTarget,
    titleReason: typeof input.titleReason === "string" && input.titleReason.trim() ? input.titleReason.trim() : current.titleReason,
    riskNote: typeof input.riskNote === "string" && input.riskNote.trim() ? input.riskNote.trim() : current.riskNote,
    evidenceNeed: typeof input.evidenceNeed === "string" && input.evidenceNeed.trim() ? input.evidenceNeed.trim() : current.evidenceNeed,
    confidence: typeof input.confidence === "number" ? Math.min(Math.max(input.confidence, 0), 1) : current.confidence,
    locked: typeof input.locked === "boolean" ? input.locked : current.locked,
    status: typeof input.status === "string" ? (input.status as TaskStatus) : current.status
  };
  const task = appendContentTaskEditRecords(taskPatch, buildContentTaskEditRecords(current, taskPatch, "manual"));

  state.tasks[taskIndex] = task;
  saveWithEvent(state, "content_task_updated", `Updated content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "内容任务已保存到本地持久化状态。",
    data: { task }
  };
}

export function confirmContentTasks(
  input: Record<string, unknown> = {}
): WorkflowResult<{ confirmed: number; tasks: ContentTask[]; reviewRequired: Array<{ taskId: string; title: string; reasons: string[] }> }> {
  const state = readWorkbenchState();
  const requestedIds = Array.isArray(input.taskIds) ? input.taskIds.map(String).filter(Boolean) : undefined;
  const isSingleConfirm = requestedIds?.length === 1 && input.mode !== "batch";
  const riskAcceptanceReason = typeof input.riskAcceptanceReason === "string" ? input.riskAcceptanceReason.trim() : "";
  const reviewRequired: Array<{ taskId: string; title: string; reasons: string[] }> = [];

  if (isSingleConfirm && requestedIds?.[0]) {
    const task = state.tasks.find((item) => item.id === requestedIds[0]);
    const reasons = task ? getContentTaskReviewReasons(task) : [];

    if (task?.status === "planned" && reasons.length && !riskAcceptanceReason) {
      return {
        ok: false,
        status: "pending_input",
        message: "确认高风险计划项前必须填写接受风险原因。",
        data: {
          confirmed: 0,
          tasks: state.tasks,
          reviewRequired: [
            {
              taskId: task.id,
              title: task.title,
              reasons
            }
          ]
        }
      };
    }
  }

  const nextTasks: ContentTask[] = state.tasks.map((task) => {
    const shouldConfirm = requestedIds?.length ? requestedIds.includes(task.id) : task.status === "planned";

    if (!shouldConfirm || task.status !== "planned") {
      return task;
    }

    const reasons = getContentTaskReviewReasons(task);

    if (!isSingleConfirm && reasons.length) {
      reviewRequired.push({
        taskId: task.id,
        title: task.title,
        reasons
      });
      return task;
    }

    const confirmedTask: ContentTask = {
      ...task,
      status: "confirmed",
      qaSummary: "已确认，等待生成"
    };

    if (isSingleConfirm && reasons.length && riskAcceptanceReason) {
      return appendContentTaskRiskAcceptanceRecord(confirmedTask, {
        id: createId("task_risk_accept"),
        reasons,
        note: riskAcceptanceReason,
        source: "manual",
        acceptedAt: nowIso()
      });
    }

    return confirmedTask;
  });
  const confirmed = nextTasks.filter((task, index) => task.status === "confirmed" && state.tasks[index].status === "planned").length;

  if (confirmed === 0) {
    return {
      ok: false,
      status: "pending_input",
      message: "没有可确认的计划任务，请先生成周计划或选择计划中任务。",
      data: {
        confirmed,
        tasks: state.tasks,
        reviewRequired
      }
    };
  }

  state.tasks = nextTasks;
  state.weeklyPlan = {
    ...state.weeklyPlan,
    status: "confirmed"
  };
  saveWithEvent(state, "content_tasks_confirmed", `Confirmed ${confirmed} content tasks.`);

  return {
    ok: true,
    status: "success",
    message: `已确认 ${confirmed} 个内容任务，可进入今日任务生成。`,
    data: {
      confirmed,
      tasks: state.tasks,
      reviewRequired
    }
  };
}

export function rejectContentTask(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ task: ContentTask }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === id);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${id}`
    };
  }

  const task = state.tasks[taskIndex];

  if (!["planned", "confirmed"].includes(task.status)) {
    return {
      ok: false,
      status: "failed",
      message: "只能驳回计划中或已确认但尚未生成正文的计划项。"
    };
  }

  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : "";

  if (!reason) {
    return {
      ok: false,
      status: "pending_input",
      message: "驳回计划项必须填写原因。"
    };
  }

  const nextTask = appendContentTaskRejectionRecord(
    {
      ...task,
      status: "rejected",
      qaSummary: `已驳回：${reason}`
    },
    {
      id: createId("task_reject"),
      reason,
      rejectedFromStatus: task.status,
      rejectedAt: nowIso()
    }
  );

  state.tasks[taskIndex] = nextTask;
  saveWithEvent(state, "content_task_rejected", `Rejected content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "计划项已驳回，并保留为后续模型评估信号。",
    data: { task: nextTask }
  };
}

export function restoreRejectedContentTask(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ task: ContentTask }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === id);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${id}`
    };
  }

  const task = state.tasks[taskIndex];

  if (task.status !== "rejected") {
    return {
      ok: false,
      status: "failed",
      message: "只有已驳回的计划项可以重新入池。"
    };
  }

  const restoreReason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : "人工重新入池，继续作为周计划候选。";
  const records = [...(task.rejectionRecords || [])];
  const lastOpenIndex = [...records].reverse().findIndex((item) => !item.restoredAt);
  const openIndex = lastOpenIndex >= 0 ? records.length - 1 - lastOpenIndex : -1;

  if (openIndex >= 0) {
    records[openIndex] = {
      ...records[openIndex],
      restoredAt: nowIso(),
      restoreReason
    };
  }

  const nextTask: ContentTask = {
    ...task,
    status: "planned",
    qaSummary: `已重新入池：${restoreReason}`,
    rejectionRecords: records.slice(-10)
  };

  state.tasks[taskIndex] = nextTask;
  saveWithEvent(state, "content_task_restored", `Restored rejected content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "计划项已重新入池，可继续编辑或确认。",
    data: { task: nextTask }
  };
}

export function deleteContentTask(id: string): WorkflowResult<{ taskId: string; tasks: ContentTask[] }> {
  const state = readWorkbenchState();
  const task = state.tasks.find((item) => item.id === id);

  if (!task) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${id}`
    };
  }

  if (state.drafts.some((draft) => draft.taskId === id) || !["planned", "confirmed"].includes(task.status)) {
    return {
      ok: false,
      status: "failed",
      message: "只能删除尚未生成稿件的计划任务；已生成、已入队或已发布任务请保留台账。"
    };
  }

  state.tasks = state.tasks.filter((item) => item.id !== id);
  state.weeklyPlan = {
    ...state.weeklyPlan,
    targetTotalCount: state.tasks.length
  };
  saveWithEvent(state, "content_task_deleted", `Deleted content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "内容任务已删除。",
    data: {
      taskId: id,
      tasks: state.tasks
    }
  };
}

export function getWorkspaceSetting() {
  return readWorkbenchState().workspaceSetting;
}

export function saveWorkspaceSetting(input: SaveWorkspaceSettingInput) {
  const state = readWorkbenchState();
  const enabledChannels = coerceChannels(input.enabledChannels) || state.workspaceSetting.enabledChannels;
  const enabledProducts = coerceProducts(input.enabledProducts) || state.workspaceSetting.enabledProducts;
  const productPlans = normalizeProductPlans(input.productPlans, enabledProducts, enabledChannels);
  const nextSetting: WorkspaceSetting = {
    ...state.workspaceSetting,
    defaultWeeklyDays: clampNumber(input.defaultWeeklyDays, state.workspaceSetting.defaultWeeklyDays, 1, 7),
    defaultDailyCount: clampNumber(input.defaultDailyCount, state.workspaceSetting.defaultDailyCount, 1, 10),
    enabledChannels,
    enabledProducts,
    productPlans,
    currentRole: coerceWorkspaceRole(input.currentRole, state.workspaceSetting.currentRole),
    finalReviewMode:
      input.finalReviewMode === "default_final" || input.finalReviewMode === "manual_review"
        ? input.finalReviewMode
        : state.workspaceSetting.finalReviewMode,
    geoPlatforms: coerceGeoPlatforms(input.geoPlatforms) || state.workspaceSetting.geoPlatforms,
    logMode:
      input.logMode === "demo_csv" || input.logMode === "csv_import" || input.logMode === "nginx_log" || input.logMode === "cdn_log"
        ? input.logMode
        : state.workspaceSetting.logMode,
    knowledgeRagConfig:
      input.knowledgeRagConfig === undefined
        ? state.workspaceSetting.knowledgeRagConfig
        : normalizeKnowledgeRagConfig({
            ...input.knowledgeRagConfig,
            updatedAt: nowIso()
          }),
    updatedAt: nowIso()
  };

  state.workspaceSetting = nextSetting;
  state.weeklyPlan = {
    ...state.weeklyPlan,
    productPlans
  };
  saveWithEvent(state, "workspace_setting_updated", "Workspace setting updated.");

  return {
    ok: true,
    status: "success" as const,
    message: "工作台设置已保存。",
    data: {
      workspaceSetting: nextSetting
    }
  };
}

export async function createKnowledgeBase(input: Record<string, unknown>): Promise<WorkflowResult<{ knowledgeBase: KnowledgeBase }>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const usageScope = typeof input.usageScope === "string" ? input.usageScope.trim() : "产品表达、内容生成、GEO 诊断、周报复盘";
  const sourceType = coerceKnowledgeSourceType(input.sourceType, "manual");
  const sourceUrls = collectKnowledgeUrls(input);
  const siteSourceUrl = sourceUrls.find((url) => {
    try {
      return isLikelyBlogIndexUrl(new URL(url).toString());
    } catch {
      return false;
    }
  });
  const contentPreview =
    typeof input.contentPreview === "string" && input.contentPreview.trim()
      ? input.contentPreview.trim()
      : typeof input.rawContent === "string" && input.rawContent.trim()
        ? input.rawContent.trim()
        : `${name} 的资料已经进入统一导入流程，等待补充内容预览。`;
  const sourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.trim() ? input.sourceUrl.trim() : siteSourceUrl || sourceUrls[0];

  if (!name) {
    return {
      ok: false,
      status: "pending_input",
      message: "请填写知识库名称。"
    };
  }

  const state = readWorkbenchState();
  const id = createId("kb");
  const nextType = coerceKnowledgeBaseType(input.type, "brand");
  const shouldStartSiteImport = Boolean(siteSourceUrl);
  const nextSourceType = shouldStartSiteImport ? "auto_crawl" : sourceType;
  const productExpressionSource =
    typeof input.productExpressionSource === "boolean" ? input.productExpressionSource : nextType === "brand" || nextType === "product";
  const linkedProductExpressionRulePackageId =
    typeof input.linkedProductExpressionRulePackageId === "string" && input.linkedProductExpressionRulePackageId.trim()
      ? input.linkedProductExpressionRulePackageId.trim()
      : undefined;
  const productExpressionRulePackageMode = normalizeProductExpressionRulePackageMode(
    typeof input.productExpressionRulePackageMode === "string" ? input.productExpressionRulePackageMode : input.rulePackageMode,
    productExpressionSource,
    linkedProductExpressionRulePackageId
  );
  const chunkingStrategy = coerceKnowledgeChunkingStrategy(input.chunkingStrategy, "rule");
  const embeddingModel = typeof input.embeddingModel === "string" && input.embeddingModel.trim() ? input.embeddingModel.trim() : undefined;
  const retrievalStrategy = coerceOptionalKnowledgeRetrievalStrategy(input.retrievalStrategy);
  const inputSources = Array.isArray(input.sources)
    ? input.sources.map((source, sourceIndex) => normalizeKnowledgeSource(source, id, name, sourceIndex)).filter((source): source is KnowledgeSource => Boolean(source))
    : [];
  const initialInputSources = shouldStartSiteImport ? inputSources.filter((source) => !isKnowledgeSiteImportPlaceholder(source)) : inputSources;
  const parsedUrlSources = !initialInputSources.length && sourceUrls.length && !shouldStartSiteImport ? await parseKnowledgeSourcesFromInput(input, id, name, { includeContentPreview: false }) : [];
  const sources = inputSources.length
    ? initialInputSources
    : parsedUrlSources.length
      ? parsedUrlSources
      : contentPreview
      ? [
          createLegacyKnowledgeSource(
            id,
            name,
            contentPreview,
            sourceUrl
          )
        ]
      : [];
  const nextContentPreview = buildKnowledgeContentPreview(sources) || contentPreview;
  const chunks = buildStructuredKnowledgeChunks(sources, id, chunkingStrategy, embeddingModel);
  const knowledgeBase: KnowledgeBase = {
    id,
    name,
    type: nextType,
    trustLevel: coerceKnowledgeBaseTrustLevel(input.trustLevel, "medium"),
    status: coerceKnowledgeBaseStatus(input.status, "enabled"),
    usageScope,
    lastSyncedAt: typeof input.lastSyncedAt === "string" && input.lastSyncedAt.trim() ? input.lastSyncedAt.trim() : nowIso(),
    sourceType: nextSourceType,
    sourceUrl,
    sources,
    contentPreview: nextContentPreview,
    chunks,
    chunkingStrategy,
    embeddingModel,
    retrievalStrategy,
    vectorizationStatus: getKnowledgeEmbeddingStatus(embeddingModel),
    productExpressionSource,
    productExpressionRulePackageMode,
    linkedProductExpressionRulePackageId: productExpressionRulePackageMode === "existing" ? linkedProductExpressionRulePackageId : undefined,
    productExpressionRuleDraft:
      productExpressionRulePackageMode === "existing"
        ? undefined
        : normalizeProductExpressionRuleDraft(input.productExpressionRuleDraft, id, name, chunks.length, nextContentPreview, usageScope) ||
          (productExpressionSource ? buildDefaultProductExpressionRuleDraft(id, name, chunks.length, nextContentPreview, usageScope) : undefined),
    autoCrawl: {
      enabled: shouldStartSiteImport || sourceType === "auto_crawl",
      weekday: clampNumber(input.crawlWeekday, 1, 1, 7),
      hour: clampNumber(input.crawlHour, 9, 0, 23),
      sourceUrl,
      status: shouldStartSiteImport ? "running" : "idle",
      totalDiscovered: shouldStartSiteImport ? 0 : undefined,
      importedCount: 0,
      failedCount: 0,
      importedUrls: [],
      startedAt: shouldStartSiteImport ? nowIso() : undefined,
      lastCrawledAt: sourceType === "auto_crawl" && !siteSourceUrl ? nowIso() : undefined,
      nextCrawlAt: shouldStartSiteImport || sourceType === "auto_crawl" ? addDaysFromNow(7, clampNumber(input.crawlHour, 9, 0, 23)) : undefined
    }
  };

  const normalizedKnowledgeBase = normalizeKnowledgeBase(knowledgeBase);
  state.knowledgeBases = [normalizedKnowledgeBase, ...state.knowledgeBases];
  saveWithEvent(state, "knowledge_base_created", `Created knowledge base ${knowledgeBase.id}.`);

  if (shouldStartSiteImport && siteSourceUrl) {
    startKnowledgeSiteImportJob(normalizedKnowledgeBase.id, siteSourceUrl);
  }

  return {
    ok: true,
    status: "success",
    message: shouldStartSiteImport ? "知识库已创建，后台全量导入任务已启动。" : "知识库已新增到本地持久化状态。",
    data: { knowledgeBase: normalizedKnowledgeBase }
  };
}

export function patchKnowledgeBase(id: string, input: Record<string, unknown>): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = state.knowledgeBases[index];
  const nextName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : current.name;
  const currentSources = Array.isArray(current.sources)
    ? current.sources.map((source, sourceIndex) => normalizeKnowledgeSource(source, current.id, current.name, sourceIndex)).filter((source): source is KnowledgeSource => Boolean(source))
    : current.contentPreview
      ? [createLegacyKnowledgeSource(current.id, current.name, current.contentPreview, current.sourceUrl)]
      : [];
  const nextContentPreview =
    typeof input.contentPreview === "string" && input.contentPreview.trim()
      ? input.contentPreview.trim()
      : current.contentPreview;
  const nextSourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.trim() ? input.sourceUrl.trim() : current.sourceUrl;
  const nextSourceType = coerceKnowledgeSourceType(input.sourceType, current.sourceType || "manual");
  const shouldRegenerateChunks = typeof input.contentPreview === "string" && input.contentPreview.trim();
  const nextChunkingStrategy = coerceKnowledgeChunkingStrategy(input.chunkingStrategy, current.chunkingStrategy || "rule");
  const nextEmbeddingModel = typeof input.embeddingModel === "string" && input.embeddingModel.trim() ? input.embeddingModel.trim() : current.embeddingModel;
  const nextRetrievalStrategy = coerceOptionalKnowledgeRetrievalStrategy(input.retrievalStrategy) || current.retrievalStrategy;
  const nextSources = shouldRegenerateChunks
    ? [createLegacyKnowledgeSource(current.id, nextName, nextContentPreview || "", nextSourceUrl)]
    : currentSources.map((source) => ({
        ...source,
        knowledgeBaseId: current.id,
        title: source.type === "legacy" && source.id === `source-${current.id}-legacy` ? nextName : source.title
      }));
  const nextContentPreviewFromSources = buildKnowledgeContentPreview(nextSources) || nextContentPreview || "";
  const nextChunks = shouldRegenerateChunks
    ? buildStructuredKnowledgeChunks(nextSources, current.id, nextChunkingStrategy, nextEmbeddingModel)
    : normalizeKnowledgeChunks(current.chunks, current.id, nextSources, nextChunkingStrategy, nextEmbeddingModel);
  const nextUsageScope = typeof input.usageScope === "string" && input.usageScope.trim() ? input.usageScope.trim() : current.usageScope;
  const productExpressionSource =
    typeof input.productExpressionSource === "boolean"
      ? input.productExpressionSource
      : typeof current.productExpressionSource === "boolean"
        ? current.productExpressionSource
        : current.type === "brand" || current.type === "product";
  const linkedProductExpressionRulePackageId =
    typeof input.linkedProductExpressionRulePackageId === "string" && input.linkedProductExpressionRulePackageId.trim()
      ? input.linkedProductExpressionRulePackageId.trim()
      : current.linkedProductExpressionRulePackageId;
  const productExpressionRulePackageMode = normalizeProductExpressionRulePackageMode(
    typeof input.productExpressionRulePackageMode === "string" ? input.productExpressionRulePackageMode : input.rulePackageMode ?? current.productExpressionRulePackageMode,
    productExpressionSource,
    linkedProductExpressionRulePackageId
  );
  const shouldCreateNewRuleDraft =
    productExpressionSource &&
    productExpressionRulePackageMode !== "existing" &&
    (shouldRegenerateChunks ||
      nextName !== current.name ||
      nextUsageScope !== current.usageScope ||
      Boolean(current.productExpressionSource) !== productExpressionSource);
  const knowledgeBase: KnowledgeBase = {
    ...current,
    name: nextName,
    type: coerceKnowledgeBaseType(input.type, current.type),
    trustLevel: coerceKnowledgeBaseTrustLevel(input.trustLevel, current.trustLevel),
    status: coerceKnowledgeBaseStatus(input.status, current.status),
    usageScope: nextUsageScope,
    lastSyncedAt: typeof input.lastSyncedAt === "string" && input.lastSyncedAt.trim() ? input.lastSyncedAt.trim() : current.lastSyncedAt,
    sourceType: nextSourceType,
    sourceUrl: nextSourceUrl,
    sources: nextSources,
    contentPreview: nextContentPreviewFromSources,
    chunks: nextChunks,
    chunkingStrategy: nextChunkingStrategy,
    chunkingModel: typeof input.chunkingModel === "string" && input.chunkingModel.trim() ? input.chunkingModel.trim() : current.chunkingModel,
    embeddingModel: nextEmbeddingModel,
    retrievalStrategy: nextRetrievalStrategy,
    vectorizationStatus: getKnowledgeEmbeddingStatus(nextEmbeddingModel),
    productExpressionSource,
    productExpressionRulePackageMode,
    linkedProductExpressionRulePackageId: productExpressionRulePackageMode === "existing" ? linkedProductExpressionRulePackageId : undefined,
    productExpressionRuleDraft:
      productExpressionRulePackageMode === "existing"
        ? undefined
        : typeof input.productExpressionRuleDraft === "object" || typeof input.productExpressionRuleDraft === "string"
        ? normalizeProductExpressionRuleDraft(
            input.productExpressionRuleDraft,
            current.id,
            nextName,
            nextChunks.length,
            nextContentPreviewFromSources || current.contentPreview || "",
            typeof input.usageScope === "string" && input.usageScope.trim() ? input.usageScope.trim() : current.usageScope
          ) ||
          buildDefaultProductExpressionRuleDraft(
            current.id,
            nextName,
            nextChunks.length,
            nextContentPreviewFromSources || current.contentPreview || "",
            nextUsageScope,
            current.productExpressionRuleDraft?.version,
            buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft)
          )
        : shouldCreateNewRuleDraft
          ? buildDefaultProductExpressionRuleDraft(
              current.id,
              nextName,
              nextChunks.length,
              nextContentPreviewFromSources || current.contentPreview || "",
              nextUsageScope,
              current.productExpressionRuleDraft?.version,
              buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft)
            )
          : productExpressionSource
            ? current.productExpressionRuleDraft
            : current.productExpressionRuleDraft
              ? {
                  ...current.productExpressionRuleDraft,
                  status: "archived",
                  archivedAt: nowIso()
                }
              : undefined,
    autoCrawl: {
      enabled: typeof input.autoCrawlEnabled === "boolean" ? input.autoCrawlEnabled : current.autoCrawl?.enabled || false,
      weekday: clampNumber(input.crawlWeekday, current.autoCrawl?.weekday || 1, 1, 7),
      hour: clampNumber(input.crawlHour, current.autoCrawl?.hour || 9, 0, 23),
      lastCrawledAt: typeof input.lastCrawledAt === "string" && input.lastCrawledAt.trim() ? input.lastCrawledAt.trim() : current.autoCrawl?.lastCrawledAt,
      nextCrawlAt:
        typeof input.nextCrawlAt === "string" && input.nextCrawlAt.trim()
          ? input.nextCrawlAt.trim()
          : addDaysFromNow(7, clampNumber(input.crawlHour, current.autoCrawl?.hour || 9, 0, 23))
    }
  };

  const normalizedKnowledgeBase = normalizeKnowledgeBase(knowledgeBase);
  state.knowledgeBases[index] = normalizedKnowledgeBase;
  saveWithEvent(state, "knowledge_base_updated", `Updated knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "知识库已保存到本地持久化状态。",
    data: { knowledgeBase: normalizedKnowledgeBase }
  };
}

export async function appendKnowledgeSources(
  id: string,
  input: Record<string, unknown>
): Promise<WorkflowResult<{ knowledgeBase: KnowledgeBase; sources: KnowledgeSource[]; chunks: KnowledgeChunk[] }>> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);
  const addedAt = nowIso();
  const rawUrlText = [input.urlsText, input.urls, input.urlText]
    .filter((item): item is string => typeof item === "string")
    .join("\n");
  const urls = Array.from(
    new Set(
      rawUrlText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  const manualText = typeof input.manualText === "string" && input.manualText.trim() ? input.manualText.trim() : "";
  const sourceTitle = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "手动追加文本";

  if (!urls.length && !manualText) {
    return {
      ok: false,
      status: "pending_input",
      message: "请至少填写一个 URL 或一段补充文本。"
    };
  }

  const addedSources: KnowledgeSource[] = [];

  for (const url of urls) {
    addedSources.push(await crawlKnowledgeUrl(current.id, url, addedAt));
  }

  if (manualText) {
    addedSources.push(createManualKnowledgeSource(current.id, sourceTitle, manualText, addedAt));
  }

  const sources = [...(current.sources || []), ...addedSources];
  const chunkingStrategy = coerceKnowledgeChunkingStrategy(input.chunkingStrategy, current.chunkingStrategy || "rule");
  const embeddingModel = typeof input.embeddingModel === "string" && input.embeddingModel.trim() ? input.embeddingModel.trim() : current.embeddingModel;
  const chunks = buildStructuredKnowledgeChunks(sources, current.id, chunkingStrategy, embeddingModel);
  const contentPreview = buildKnowledgeContentPreview(sources) || current.contentPreview || "";
  const productExpressionRuleDraft = current.productExpressionSource
    ? buildDefaultProductExpressionRuleDraft(
        current.id,
        current.name,
        chunks.length,
        contentPreview,
        current.usageScope || "",
        current.productExpressionRuleDraft?.version,
        buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft)
      )
    : current.productExpressionRuleDraft;
  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    sources,
    contentPreview,
    chunks,
    chunkingStrategy,
    embeddingModel,
    retrievalStrategy: current.retrievalStrategy,
    vectorizationStatus: getKnowledgeEmbeddingStatus(embeddingModel),
    productExpressionRuleDraft,
    lastSyncedAt: addedAt
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "knowledge_sources_appended", `Appended ${addedSources.length} source(s) to knowledge base ${id}.`);

  const failedCount = addedSources.filter((source) => source.status === "failed").length;
  const parsedCount = addedSources.filter((source) => source.status === "parsed").length;

  return {
    ok: true,
    status: "success",
    message:
      failedCount > 0
        ? `已追加 ${parsedCount} 个可用来源，${failedCount} 个 URL 抓取失败，失败原因已保留在来源列表。`
        : `已追加 ${addedSources.length} 个来源，并重新生成资料片段。`,
    data: {
      knowledgeBase,
      sources: addedSources,
      chunks
    }
  };
}

export async function vectorizeKnowledgeBase(
  id: string,
  input: Record<string, unknown> = {}
): Promise<WorkflowResult<{ knowledgeBase: KnowledgeBase; vectorizedCount: number; dimensions: number }>> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);
  const selectedProvider =
    coerceKnowledgeEmbeddingModelProvider(input.embeddingModelProvider) ||
    state.workspaceSetting.knowledgeRagConfig?.embeddingModelProvider ||
    coerceKnowledgeEmbeddingModelProvider(current.embeddingModel);

  if (!selectedProvider) {
    return {
      ok: false,
      status: "pending_config",
      message: "未选择真实 Embedding 模型，请先在 AI 配置页选择知识库 RAG 的 Embedding 模型。",
      missingConfig: ["workspaceSetting.knowledgeRagConfig.embeddingModelProvider"]
    };
  }

  const chunkingStrategy = current.chunkingStrategy || state.workspaceSetting.knowledgeRagConfig?.chunkingStrategy || "rule";
  const chunks = (current.chunks?.length ? current.chunks : buildStructuredKnowledgeChunks(current.sources || [], current.id, chunkingStrategy, selectedProvider))
    .filter((chunk) => chunk.status !== "disabled" && normalizeKnowledgeText(chunk.content));

  if (!chunks.length) {
    return {
      ok: false,
      status: "pending_input",
      message: "当前知识库没有可向量化的资料片段，请先追加 URL 或文本资料。"
    };
  }

  const vectors: number[][] = [];
  const batchSize = 10;

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const result = await callEmbeddingProvider({
      provider: selectedProvider,
      input: batch.map((chunk) => chunk.content)
    });

    if (!result.ok || !result.vectors?.length) {
      return {
        ok: false,
        status: result.status,
        message:
          result.status === "pending_config"
            ? `Embedding 配置未完成：${(result.missingConfig || []).join(", ")}`
            : result.errorMessage || "Embedding 向量化失败。",
        missingConfig: result.missingConfig
      };
    }

    vectors.push(...result.vectors);
  }

  if (vectors.length !== chunks.length) {
    return {
      ok: false,
      status: "failed",
      message: `Embedding 返回数量不匹配：期望 ${chunks.length} 条，实际 ${vectors.length} 条。`
    };
  }

  const vectorByChunkId = new Map(chunks.map((chunk, chunkIndex) => [chunk.id, vectors[chunkIndex]]));
  const nextChunks = (current.chunks?.length ? current.chunks : chunks).map((chunk) => {
    const vector = vectorByChunkId.get(chunk.id);

    if (!vector?.length) {
      return chunk;
    }

    return {
      ...chunk,
      embeddingStatus: "real_embedding" as const,
      embeddingModel: selectedProvider,
      embeddingVector: vector
    };
  });
  const vectorizedCount = nextChunks.filter((chunk) => chunk.embeddingStatus === "real_embedding" && Array.isArray(chunk.embeddingVector) && chunk.embeddingVector.length).length;
  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    chunks: nextChunks,
    embeddingModel: selectedProvider,
    vectorizationStatus: vectorizedCount === nextChunks.length ? "real_embedding" : "pending_config",
    lastSyncedAt: nowIso()
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "knowledge_base_vectorized", `Vectorized ${vectorizedCount} chunks for knowledge base ${id} with ${selectedProvider}.`);

  return {
    ok: true,
    status: "success",
    message: `已写入 ${vectorizedCount} 条真实向量。`,
    data: {
      knowledgeBase,
      vectorizedCount,
      dimensions: vectors[0]?.length || 0
    }
  };
}

export async function vectorizeKnowledgeBases(
  input: Record<string, unknown> = {}
): Promise<WorkflowResult<{ results: Array<{ id: string; name: string; status: WorkflowResult<unknown>["status"]; message: string; vectorizedCount?: number; dimensions?: number; missingConfig?: string[] }> }>> {
  const state = readWorkbenchState();
  const inputIds = Array.isArray(input.ids) ? input.ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const selectedIds = Array.from(new Set(inputIds));
  const enabledKnowledgeBases = state.knowledgeBases.filter((item) => item.status !== "disabled" && (!selectedIds.length || selectedIds.includes(item.id)));
  const results: Array<{
    id: string;
    name: string;
    status: WorkflowResult<unknown>["status"];
    message: string;
    vectorizedCount?: number;
    dimensions?: number;
    missingConfig?: string[];
  }> = [];

  if (selectedIds.length && enabledKnowledgeBases.length !== selectedIds.length) {
    return {
      ok: false,
      status: "failed",
      message: "部分选中的知识库不存在或已停用，请刷新列表后重试。"
    };
  }

  for (const knowledgeBase of enabledKnowledgeBases) {
    const result = await vectorizeKnowledgeBase(knowledgeBase.id, input);
    results.push({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      status: result.status,
      message: result.message,
      vectorizedCount: result.data?.vectorizedCount,
      dimensions: result.data?.dimensions,
      missingConfig: result.missingConfig
    });

    if (result.status === "pending_config") {
      break;
    }
  }

  const failed = results.filter((item) => item.status === "failed");
  const pending = results.filter((item) => item.status === "pending_config");

  return {
    ok: !failed.length && !pending.length,
    status: failed.length ? "failed" : pending.length ? "pending_config" : "success",
    message: pending.length ? pending[0].message : failed.length ? failed[0].message : `已完成 ${results.length} 个知识库的真实向量写入。`,
    missingConfig: pending[0]?.missingConfig,
    data: {
      results
    }
  };
}

export function mergeKnowledgeBases(input: Record<string, unknown>): WorkflowResult<{ knowledgeBase: KnowledgeBase; sourceIds: string[] }> {
  const sourceIds = Array.isArray(input.ids)
    ? input.ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const uniqueSourceIds = Array.from(new Set(sourceIds));

  if (uniqueSourceIds.length < 2) {
    return {
      ok: false,
      status: "pending_input",
      message: "请至少选择两个知识库再合并。"
    };
  }

  const state = readWorkbenchState();
  const selectedKnowledgeBases = uniqueSourceIds
    .map((id) => state.knowledgeBases.find((item) => item.id === id))
    .filter((item): item is KnowledgeBase => Boolean(item));

  if (selectedKnowledgeBases.length !== uniqueSourceIds.length) {
    return {
      ok: false,
      status: "failed",
      message: "部分知识库不存在，请刷新列表后重试。"
    };
  }

  const nonPending = selectedKnowledgeBases.filter((item) => item.vectorizationStatus === "real_embedding");

  if (nonPending.length) {
    return {
      ok: false,
      status: "failed",
      message: "当前只支持合并未向量化或待向量化的知识库；真实向量库请先单独管理，避免向量来源混淆。"
    };
  }

  const id = createId("kb");
  const now = nowIso();
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : `合并知识库：${selectedKnowledgeBases.map((item) => item.name).slice(0, 3).join(" + ")}`;
  const type = coerceKnowledgeBaseType(input.type, selectedKnowledgeBases[0].type || "custom");
  const usageScope =
    typeof input.usageScope === "string" && input.usageScope.trim()
      ? input.usageScope.trim()
      : Array.from(new Set(selectedKnowledgeBases.map((item) => item.usageScope).filter(Boolean))).join("；") || "合并资料，用于内容生成、质检和 GEO 诊断。";
  const chunkingStrategy = coerceKnowledgeChunkingStrategy(input.chunkingStrategy, state.workspaceSetting.knowledgeRagConfig?.chunkingStrategy || "rule");
  const embeddingModel =
    typeof input.embeddingModel === "string" && input.embeddingModel.trim()
      ? input.embeddingModel.trim()
      : state.workspaceSetting.knowledgeRagConfig?.embeddingModelProvider;
  const retrievalStrategy = coerceOptionalKnowledgeRetrievalStrategy(input.retrievalStrategy) || state.workspaceSetting.knowledgeRagConfig?.retrievalStrategy;
  const sources = selectedKnowledgeBases.flatMap((knowledgeBase, knowledgeIndex) => {
    const normalizedSources = normalizeKnowledgeBase(knowledgeBase).sources || [];

    return normalizedSources.map((source, sourceIndex) => ({
      ...source,
      id: createId("source"),
      knowledgeBaseId: id,
      title: `${knowledgeBase.name} / ${source.title || `来源 ${sourceIndex + 1}`}`,
      addedAt: source.addedAt || now,
      parsedAt: source.parsedAt || (source.status === "parsed" ? now : undefined),
      contentHash: createContentHash(`${knowledgeBase.id}\n${knowledgeIndex}\n${sourceIndex}\n${source.markdown || source.extractedText || ""}`)
    }));
  });
  const contentPreview = buildKnowledgeContentPreview(sources);
  const chunks = buildStructuredKnowledgeChunks(sources, id, chunkingStrategy, embeddingModel);
  const productExpressionSource = Boolean(input.productExpressionSource);
  const knowledgeBase = normalizeKnowledgeBase({
    id,
    name,
    type,
    trustLevel: "medium",
    status: "enabled",
    usageScope,
    lastSyncedAt: now,
    sourceType: "manual",
    sources,
    contentPreview,
    chunks,
    chunkingStrategy,
    embeddingModel,
    retrievalStrategy,
    vectorizationStatus: getKnowledgeEmbeddingStatus(embeddingModel),
    productExpressionSource,
    productExpressionRuleDraft: productExpressionSource
      ? buildDefaultProductExpressionRuleDraft(id, name, chunks.length, contentPreview, usageScope)
      : undefined
  });

  state.knowledgeBases = [knowledgeBase, ...state.knowledgeBases];
  saveWithEvent(state, "knowledge_bases_merged", `Merged ${uniqueSourceIds.length} knowledge bases into ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "已创建合并知识库，原知识库已保留。",
    data: {
      knowledgeBase,
      sourceIds: uniqueSourceIds
    }
  };
}

export function deleteKnowledgeBase(id: string): WorkflowResult<{ knowledgeBaseId: string; knowledgeBases: KnowledgeBase[] }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const [deletedKnowledgeBase] = state.knowledgeBases.splice(index, 1);
  saveWithEvent(state, "knowledge_base_deleted", `Deleted knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: `知识库资料「${deletedKnowledgeBase.name}」已删除。`,
    data: {
      knowledgeBaseId: id,
      knowledgeBases: state.knowledgeBases
    }
  };
}

export function regenerateProductExpressionRuleDraft(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);
  const draft = buildDefaultProductExpressionRuleDraft(
    current.id,
    current.name,
    current.chunks?.length || 0,
    current.contentPreview || "",
    current.usageScope || "",
    current.productExpressionRuleDraft?.version,
    buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft)
  );
  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    productExpressionSource: true,
    productExpressionRuleDraft: draft
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "product_expression_rule_draft_regenerated", `Regenerated product expression rule draft for knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "已生成新的产品表达规则包草稿，生效前不会覆盖当前规则。",
    data: { knowledgeBase }
  };
}

export function activateProductExpressionRuleDraft(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);

  if (!current.productExpressionRuleDraft) {
    return {
      ok: false,
      status: "pending_input",
      message: "当前资料还没有产品表达规则包草稿。"
    };
  }

  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    productExpressionSource: true,
    productExpressionRuleDraft: {
      ...current.productExpressionRuleDraft,
      status: "active",
      activatedAt: nowIso()
    }
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "product_expression_rule_draft_activated", `Activated product expression rule draft for knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "产品表达规则包已确认生效。",
    data: { knowledgeBase }
  };
}

export function rollbackProductExpressionRuleDraft(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);

  if (!current.productExpressionRuleDraft) {
    return {
      ok: false,
      status: "pending_input",
      message: "当前资料还没有可回滚的产品表达规则包。"
    };
  }

  const previousSnapshot = current.productExpressionRuleDraft.previousSnapshot;
  const rolledBackDraft: ProductExpressionRuleDraft = previousSnapshot
    ? {
        ...current.productExpressionRuleDraft,
        version: previousSnapshot.version,
        status: "active",
        previousVersion: current.productExpressionRuleDraft.version,
        previousSnapshot: buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft),
        activatedAt: nowIso(),
        archivedAt: undefined,
        sourceChunkCount: previousSnapshot.sourceChunkCount,
        generatedAt: previousSnapshot.generatedAt,
        summary: previousSnapshot.summary,
        doExpressions: [...previousSnapshot.doExpressions],
        dontExpressions: [...previousSnapshot.dontExpressions],
        boundaryNotes: [...previousSnapshot.boundaryNotes],
        distilledTermSuggestions: [...previousSnapshot.distilledTermSuggestions]
      }
    : {
        ...current.productExpressionRuleDraft,
        version: current.productExpressionRuleDraft.previousVersion || `${current.productExpressionRuleDraft.version}-rollback`,
        status: "active",
        previousSnapshot: buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft),
        activatedAt: nowIso(),
        archivedAt: undefined,
        summary: `${current.productExpressionRuleDraft.summary}（已按上一版本口径回滚）`
      };
  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    productExpressionSource: true,
    productExpressionRuleDraft: rolledBackDraft
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "product_expression_rule_draft_rolled_back", `Rolled back product expression rule draft for knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "产品表达规则包已回滚到上一版本口径。",
    data: { knowledgeBase }
  };
}

export function discardProductExpressionRuleDraft(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const state = readWorkbenchState();
  const index = state.knowledgeBases.findIndex((item) => item.id === id);

  if (index < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到知识库：${id}`
    };
  }

  const current = normalizeKnowledgeBase(state.knowledgeBases[index]);

  if (!current.productExpressionRuleDraft) {
    return {
      ok: false,
      status: "pending_input",
      message: "当前资料还没有可放弃的产品表达规则包草稿。"
    };
  }

  if (current.productExpressionRuleDraft.status !== "draft") {
    return {
      ok: false,
      status: "failed",
      message: "只有草稿状态的产品表达规则包可以放弃；已生效版本请使用回滚。"
    };
  }

  const previousSnapshot = current.productExpressionRuleDraft.previousSnapshot;
  const discardedAt = nowIso();
  const restoredDraft: ProductExpressionRuleDraft = previousSnapshot
    ? {
        ...current.productExpressionRuleDraft,
        version: previousSnapshot.version,
        status: "active",
        previousVersion: current.productExpressionRuleDraft.version,
        previousSnapshot: buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft),
        activatedAt: previousSnapshot.activatedAt || discardedAt,
        archivedAt: undefined,
        sourceChunkCount: previousSnapshot.sourceChunkCount,
        generatedAt: previousSnapshot.generatedAt,
        summary: previousSnapshot.summary,
        doExpressions: [...previousSnapshot.doExpressions],
        dontExpressions: [...previousSnapshot.dontExpressions],
        boundaryNotes: [...previousSnapshot.boundaryNotes],
        distilledTermSuggestions: [...previousSnapshot.distilledTermSuggestions]
      }
    : {
        ...current.productExpressionRuleDraft,
        status: "archived",
        archivedAt: discardedAt,
        previousSnapshot: buildProductExpressionRuleSnapshot(current.productExpressionRuleDraft)
      };
  const knowledgeBase = normalizeKnowledgeBase({
    ...current,
    productExpressionSource: true,
    productExpressionRuleDraft: restoredDraft
  });

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "product_expression_rule_draft_discarded", `Discarded product expression rule draft for knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: previousSnapshot ? "已放弃当前产品表达规则包草稿，并恢复上一版生效口径。" : "已放弃当前产品表达规则包草稿。",
    data: { knowledgeBase }
  };
}

export function regenerateContentTaskTitle(id: string): WorkflowResult<{ task: ContentTask }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === id);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${id}`
    };
  }

  const current = state.tasks[taskIndex];
  const taskPatch: ContentTask = {
    ...current,
    title: buildRegeneratedTaskTitle(current),
    ...buildTaskPlanContext(current.product, current.contentType, current.sourceProblem, current.primaryDistilledTerm),
    confidence: 0.78
  };
  const task = appendContentTaskEditRecords(taskPatch, buildContentTaskEditRecords(current, taskPatch, "ai_regenerate"));

  state.tasks[taskIndex] = task;
  saveWithEvent(state, "content_task_title_regenerated", `Regenerated title for content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "选题标题已重生成。",
    data: { task }
  };
}

export async function generateDraftForTask(
  taskId: string,
  input: Record<string, unknown> = {}
): Promise<WorkflowResult<{ task: ContentTask; draft?: ArticleDraft; missingEvidence?: ReturnType<typeof buildMissingEvidenceItem> }>> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === taskId);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${taskId}`
    };
  }

  const task = state.tasks[taskIndex];
  const existingDraftIndex = state.drafts.findIndex((item) => item.taskId === task.id);
  const evidenceSelection = getDefaultEvidenceSelection(state, task, input.evidenceSelection);

  if (input.requireEvidence === true && !hasUsableEvidenceSelection(evidenceSelection)) {
    return {
      ok: false,
      status: "pending_input",
      message: "生成正文前需要先补齐知识库证据或人工补充证据。",
      data: {
        task,
        missingEvidence: buildMissingEvidenceItem(task, evidenceSelection)
      }
    };
  }

  const productExpressionRule = getProductExpressionRuleSelection(state, task);
  const draft = await createDraftWithProviderFallback(
    task,
    existingDraftIndex >= 0 ? state.drafts[existingDraftIndex] : undefined,
    state.promptVersions,
    evidenceSelection,
    productExpressionRule
  );
  const nextTask = updateTaskStatusForDraft(task, draft);

  state.tasks[taskIndex] = nextTask;

  if (existingDraftIndex >= 0) {
    state.drafts[existingDraftIndex] = draft;
  } else {
    state.drafts.push(draft);
  }

  saveWithEvent(state, "draft_generated", `Generated local-rule draft for task ${taskId}.`);

  return {
    ok: true,
    status: "success",
    message: draft.generationSource?.mode === "ai_provider" ? "已通过 AI 生成正文草稿。" : "已使用本地规则生成正文草稿；模型不可用时会保留生成来源。",
    data: {
      task: nextTask,
      draft
    }
  };
}

export async function batchGenerateDrafts(
  input: Record<string, unknown> = {}
): Promise<
  WorkflowResult<{
    generated: number;
    tasks: ContentTask[];
    drafts: ArticleDraft[];
    missingEvidence?: Array<{ taskId: string; title: string; reasons: string[] }>;
  }>
> {
  const state = readWorkbenchState();
  let generated = 0;
  const nextTasks: ContentTask[] = [];
  const requestedIds = Array.isArray(input.taskIds) ? input.taskIds.map(String).filter(Boolean) : undefined;
  const requireEvidence = input.requireEvidence === true;
  const generationCandidates = state.tasks.filter((task) => {
    const shouldGenerate = requestedIds?.length ? requestedIds.includes(task.id) : task.status === "confirmed";

    return shouldGenerate && ["confirmed", "generated", "qa_failed", "pending_review"].includes(task.status);
  });

  if (requireEvidence) {
    const missingEvidence = generationCandidates
      .map((task) => {
        const evidenceInput =
          input.evidenceByTaskId && typeof input.evidenceByTaskId === "object" && !Array.isArray(input.evidenceByTaskId)
            ? (input.evidenceByTaskId as Record<string, unknown>)[task.id]
            : undefined;
        const evidenceSelection = getDefaultEvidenceSelection(state, task, evidenceInput);

        return {
          task,
          evidenceSelection
        };
      })
      .filter((item) => !hasUsableEvidenceSelection(item.evidenceSelection))
      .map((item) => buildMissingEvidenceItem(item.task, item.evidenceSelection));

    if (missingEvidence.length) {
      return {
        ok: false,
        status: "pending_input",
        message: "生成正文前需要先补齐知识库证据或人工补充证据。",
        data: {
          generated: 0,
          tasks: state.tasks,
          drafts: state.drafts,
          missingEvidence
        }
      };
    }
  }

  const draftResults = await Promise.all(
    generationCandidates.map(async (task) => {
      const existingDraftIndex = state.drafts.findIndex((item) => item.taskId === task.id);
      const evidenceInput =
        input.evidenceByTaskId && typeof input.evidenceByTaskId === "object" && !Array.isArray(input.evidenceByTaskId)
          ? (input.evidenceByTaskId as Record<string, unknown>)[task.id]
          : undefined;
      const evidenceSelection = getDefaultEvidenceSelection(state, task, evidenceInput);
      const productExpressionRule = getProductExpressionRuleSelection(state, task);
      const draft = await createDraftWithProviderFallback(
        task,
        existingDraftIndex >= 0 ? state.drafts[existingDraftIndex] : undefined,
        state.promptVersions,
        evidenceSelection,
        productExpressionRule
      );

      return {
        taskId: task.id,
        existingDraftIndex,
        draft
      };
    })
  );
  const draftResultByTaskId = new Map(draftResults.map((item) => [item.taskId, item]));

  for (const task of state.tasks) {
    const draftResult = draftResultByTaskId.get(task.id);

    if (!draftResult) {
      nextTasks.push(task);
      continue;
    }

    generated += 1;

    if (draftResult.existingDraftIndex >= 0) {
      state.drafts[draftResult.existingDraftIndex] = draftResult.draft;
    } else {
      state.drafts.push(draftResult.draft);
    }

    nextTasks.push(updateTaskStatusForDraft(task, draftResult.draft));
  }

  state.tasks = nextTasks;

  saveWithEvent(state, "draft_batch_generated", `Generated ${generated} local-rule drafts.`);

  return {
    ok: generated > 0,
    status: generated > 0 ? "success" : "pending_input",
    message:
      generated > 0
        ? `已批量生成 ${generated} 篇稿件；模型不可用时会使用本地规则稿并保留生成来源。`
        : "请先在今日发布页选择已确认的任务，再批量生成正文。",
    data: {
      generated,
      tasks: state.tasks,
      drafts: state.drafts
    }
  };
}

export function patchDraft(id: string, input: Record<string, unknown>): WorkflowResult<{ draft: ArticleDraft }> {
  const state = readWorkbenchState();
  const draftIndex = state.drafts.findIndex((item) => item.id === id);

  if (draftIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到稿件：${id}`
    };
  }

  const current = state.drafts[draftIndex];
  const task = state.tasks.find((item) => item.id === current.taskId);
  const content = typeof input.content === "string" ? input.content : current.content;
  const contentDiffStats = getTextDiffStats(current.content, content);
  const acceptedRiskSegments =
    Array.isArray(input.keptRiskSegments)
      ? input.keptRiskSegments
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return undefined;
            }

            const value = item as Record<string, unknown>;
            const segment = typeof value.segment === "string" && value.segment.trim() ? value.segment.trim() : undefined;
            const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : undefined;
            const keepReasonCategory = normalizeKeepRiskReasonCategory(value.keepReasonCategory) || (reason ? inferKeepRiskReasonCategory(reason) : undefined);

            return segment && reason ? { segment, reason, keepReasonCategory } : undefined;
          })
          .filter((item): item is { segment: string; reason: string; keepReasonCategory: DraftRiskKeepReasonCategory } => Boolean(item))
      : [];
  const incomingEditActions =
    Array.isArray(input.editActions)
      ? input.editActions
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return undefined;
            }

            const value = item as Record<string, unknown>;
            const type = value.type;

            if (
              type !== "manual_edit" &&
              type !== "delete_risk_segment" &&
              type !== "ai_rewrite_segment" &&
              type !== "keep_risk_segment" &&
              type !== "run_qa"
            ) {
              return undefined;
            }

            const originalText = typeof value.originalText === "string" && value.originalText.trim() ? value.originalText.trim() : undefined;
            const rewrittenText = typeof value.rewrittenText === "string" && value.rewrittenText.trim() ? value.rewrittenText.trim() : undefined;
            const rewriteDiffStats = originalText && rewrittenText ? getTextDiffStats(originalText, rewrittenText) : {};

            return createDraftEditAction({
              type,
              source: value.source === "ai_provider" ? "ai_provider" : value.source === "local_rule" ? "local_rule" : "user",
              segment: typeof value.segment === "string" && value.segment.trim() ? value.segment.trim() : undefined,
              originalText,
              rewrittenText,
              reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : undefined,
              keepReasonCategory:
                type === "keep_risk_segment"
                  ? normalizeKeepRiskReasonCategory(value.keepReasonCategory) ||
                    (typeof value.reason === "string" && value.reason.trim() ? inferKeepRiskReasonCategory(value.reason.trim()) : undefined)
                  : undefined,
              ...rewriteDiffStats
            });
          })
          .filter((item): item is DraftEditAction => Boolean(item))
      : [];
  const keptRiskSegmentActions = acceptedRiskSegments.map((item) =>
    createDraftEditAction({
      type: "keep_risk_segment",
      source: "user",
      segment: item.segment,
      reason: item.reason,
      keepReasonCategory: item.keepReasonCategory
    })
  );
  const keptRiskSegmentNotes = acceptedRiskSegments.map((item) => `保留高风险片段：${item.segment}；原因：${item.reason}`);
  const editedSegments =
    content !== current.content
      ? [
          typeof input.editNote === "string" && input.editNote.trim()
            ? input.editNote.trim()
            : `人工修改于 ${nowIso()}，已触发 AI 二次质检。`
        ]
      : current.qaResult.editedSegments || [];
  const nextEditedSegments = Array.from(new Set([...editedSegments, ...keptRiskSegmentNotes]));
  const existingEditActions = current.qaResult.editActions || [];
  const manualEditAction =
    content !== current.content && !incomingEditActions.length
      ? [
          createDraftEditAction({
            type: "manual_edit",
            source: "user",
            reason:
              typeof input.editNote === "string" && input.editNote.trim()
                ? input.editNote.trim()
                : "人工修改后运行 AI 二次质检。",
            ...contentDiffStats
          })
        ]
      : [];
  const nextEditActions = [...existingEditActions, ...manualEditAction, ...incomingEditActions, ...keptRiskSegmentActions];
  const qaResult = task ? runDraftQa(task, content, nextEditedSegments, state.promptVersions, acceptedRiskSegments, nextEditActions) : current.qaResult;
  const draft: ArticleDraft = {
    ...current,
    title: typeof input.title === "string" ? input.title : current.title,
    summary: typeof input.summary === "string" ? input.summary : current.summary,
    content,
    qaResult,
    version: current.version + 1,
    status: typeof input.status === "string" ? (input.status as ArticleDraft["status"]) : current.status,
    updatedAt: nowIso()
  };

  state.drafts[draftIndex] = draft;

  if (task) {
    const taskIndex = state.tasks.findIndex((item) => item.id === task.id);
    state.tasks[taskIndex] = updateTaskStatusForDraft(task, draft);
  }

  saveWithEvent(state, "draft_updated", `Updated draft ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "稿件已保存，并重新执行本地质检。",
    data: { draft }
  };
}

export function approveDraft(id: string): WorkflowResult<{ draft: ArticleDraft; record: PublishRecord }> {
  const state = readWorkbenchState();
  const draftIndex = state.drafts.findIndex((item) => item.id === id);

  if (draftIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到稿件：${id}`
    };
  }

  const draft = state.drafts[draftIndex];

  if (!draft.qaResult.passed || draft.qaResult.distributionAllowed === false) {
    return {
      ok: false,
      status: "failed",
      message: "稿件仍存在阻断项或需要人工复核，不能进入发布队列。"
    };
  }

  const finalDraft: ArticleDraft = {
    ...draft,
    status: "final",
    updatedAt: nowIso()
  };
  const taskIndex = state.tasks.findIndex((item) => item.id === finalDraft.taskId);
  const existingRecord = state.publishRecords.find((item) => item.draftId === finalDraft.id);
  const weekFields = buildPublishRecordWeekFields(state, finalDraft);
  const record =
    existingRecord
      ? {
          ...existingRecord,
          ...weekFields,
          channel: finalDraft.channel,
          title: finalDraft.title
        }
      : ({
          id: createId("pub"),
          draftId: finalDraft.id,
          channel: finalDraft.channel,
          title: finalDraft.title,
          publishStatus: "queued",
          ...weekFields
        } satisfies PublishRecord);

  state.drafts[draftIndex] = finalDraft;

  if (taskIndex >= 0) {
    state.tasks[taskIndex] = {
      ...state.tasks[taskIndex],
      status: "queued" satisfies TaskStatus,
      qaSummary: "已确认终稿，进入发布队列"
    };
  }

  if (existingRecord) {
    state.publishRecords = state.publishRecords.map((item) => (item.id === record.id ? record : item));
  } else {
    state.publishRecords.push(record);
  }

  saveWithEvent(state, "draft_approved", `Approved draft ${id} and queued publish record ${record.id}.`);

  return {
    ok: true,
    status: "success",
    message: "终稿已确认，并已进入发布队列。",
    data: {
      draft: finalDraft,
      record
    }
  };
}

export function createPublishRecord(input: Record<string, unknown>): WorkflowResult<{ record: PublishRecord }> {
  const state = readWorkbenchState();
  const draftId = typeof input.draftId === "string" ? input.draftId : undefined;
  const draft = draftId
    ? state.drafts.find((item) => item.id === draftId)
    : state.drafts.find((item) => item.status === "final" && !state.publishRecords.some((record) => record.draftId === item.id));

  if (!draft) {
    return {
      ok: false,
      status: "pending_input",
      message: "没有可入队的终稿，请先确认稿件或传入 draftId。"
    };
  }

  if (!draft.qaResult.passed || draft.qaResult.distributionAllowed === false) {
    return {
      ok: false,
      status: "failed",
      message: "稿件质检未达到分发标准，不能创建发布记录。"
    };
  }

  const existingRecord = state.publishRecords.find((item) => item.draftId === draft.id);

  if (existingRecord) {
    return {
      ok: true,
      status: "success",
      message: "该终稿已经在发布队列中。",
      data: { record: existingRecord }
    };
  }

  const record: PublishRecord = {
    id: createId("pub"),
    draftId: draft.id,
    channel: draft.channel,
    title: draft.title,
    publishStatus: "queued",
    ...buildPublishRecordWeekFields(state, draft)
  };
  state.publishRecords.push(record);
  saveWithEvent(state, "publish_record_created", `Created publish record ${record.id}.`);

  return {
    ok: true,
    status: "success",
    message: "发布记录已创建。",
    data: { record }
  };
}

function getDistributionPlatformsForRecord(record: Pick<PublishRecord, "channel">, inputPlatforms?: unknown): DistributionPlatformKey[] {
  const requestedPlatforms = Array.isArray(inputPlatforms)
    ? inputPlatforms.map(coerceDistributionPlatform).filter((platform): platform is DistributionPlatformKey => Boolean(platform))
    : [];
  const defaultPlatforms = channelDistributionTargets[record.channel] || [];
  const platforms = requestedPlatforms.length ? requestedPlatforms : defaultPlatforms;

  return Array.from(new Set(platforms));
}

function buildPlatformVariantFromDraft(record: PublishRecord, draft: ArticleDraft, platform: DistributionPlatformKey): PlatformDraftVariant {
  const platformLabel = distributionPlatformLabels[platform];
  const platformNoteByPlatform: Record<DistributionPlatformKey, string> = {
    weixin: "公众号版保留连续观点和自然转化，发布前检查排版、封面和引导语。",
    csdn: "CSDN 版优先保留工程链路、检查清单和技术可信度。",
    juejin: "掘金版优先保留工程实践、问题拆解和开发者视角。",
    zhihu: "知乎版优先强化问题意识、判断过程和回答完整性。",
    toutiao: "今日头条版优先强化开头判断、阅读节奏和通俗解释。"
  };
  const content = `${draft.content.trim()}\n\n${platformNoteByPlatform[platform]}`;

  return {
    id: createId("variant"),
    articleDraftId: draft.id,
    publishRecordId: record.id,
    platform,
    title: draft.title,
    summary: draft.summary,
    content,
    contentHash: createContentHash(`${platform}:${draft.title}\n${content}`),
    sourceDraftVersion: draft.version,
    qaResult: clone(draft.qaResult),
    status: draft.status === "final" ? "final" : "draft",
    generatedAt: nowIso(),
    updatedAt: nowIso()
  };
}

function ensurePlatformDraftVariant(state: WorkbenchState, record: PublishRecord, draft: ArticleDraft, platform: DistributionPlatformKey) {
  const existing = state.platformDraftVariants.find((variant) => variant.publishRecordId === record.id && variant.platform === platform);

  if (existing) {
    return existing;
  }

  const variant = buildPlatformVariantFromDraft(record, draft, platform);
  state.platformDraftVariants.push(variant);
  return variant;
}

export function createDistributionTargetsForPublishRecord(
  id: string,
  input: Record<string, unknown> = {}
): WorkflowResult<{ record: PublishRecord; variants: PlatformDraftVariant[]; targets: DistributionTarget[] }> {
  const state = readWorkbenchState();
  const record = state.publishRecords.find((item) => item.id === id);

  if (!record) {
    return {
      ok: false,
      status: "failed",
      message: `未找到发布记录：${id}`
    };
  }

  const draft = state.drafts.find((item) => item.id === record.draftId);

  if (!draft) {
    return {
      ok: false,
      status: "failed",
      message: "发布记录缺少对应终稿，不能写入平台草稿箱。"
    };
  }

  const task = state.tasks.find((item) => item.id === draft.taskId);

  if (!task) {
    return {
      ok: false,
      status: "failed",
      message: "发布记录缺少对应内容任务，不能写入平台草稿箱。"
    };
  }

  if (!draft.qaResult.passed || draft.qaResult.distributionAllowed === false) {
    return {
      ok: false,
      status: "failed",
      message: "稿件质检未达到分发标准，不能写入平台草稿箱。"
    };
  }

  const platforms = getDistributionPlatformsForRecord(record, input.platforms);
  const variants: PlatformDraftVariant[] = [];
  const targets: DistributionTarget[] = [];

  for (const platform of platforms) {
    const variant = ensurePlatformDraftVariant(state, record, draft, platform);
    const existingTarget = state.distributionTargets.find((target) => target.publishRecordId === record.id && target.platform === platform);
    const target: DistributionTarget =
      existingTarget ||
      ({
        id: createId("dist"),
        publishRecordId: record.id,
        draftId: draft.id,
        taskId: task.id,
        platformVariantId: variant.id,
        platform,
        status: "pending",
        createdAt: nowIso(),
        updatedAt: nowIso()
      } satisfies DistributionTarget);

    if (!existingTarget) {
      state.distributionTargets.push(target);
    } else if (!existingTarget.platformVariantId) {
      existingTarget.platformVariantId = variant.id;
      existingTarget.updatedAt = nowIso();
    }

    variants.push(variant);
    targets.push(existingTarget || target);
  }

  saveWithEvent(state, "distribution_target_created", `Prepared ${targets.length} platform draft targets for publish record ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "平台草稿箱写入任务已创建。",
    data: {
      record,
      variants,
      targets
    }
  };
}

export async function getWechatsyncStatus(): Promise<WorkflowResult<{ runtime: Awaited<ReturnType<typeof getWechatsyncRuntimeStatus>> }>> {
  const runtime = await getWechatsyncRuntimeStatus();

  return {
    ok: runtime.bridgeStatus === "ready",
    status: runtime.bridgeStatus === "ready" ? "success" : runtime.bridgeStatus === "pending_config" ? "pending_config" : "failed",
    message: runtime.message,
    data: { runtime }
  };
}

export async function checkDistributionPlatformAuth(
  input: Record<string, unknown>
): Promise<WorkflowResult<{ platform: DistributionPlatformKey; authenticated: boolean; nextAction: string }>> {
  const platform = coerceDistributionPlatform(input.platform);

  if (!platform) {
    return {
      ok: false,
      status: "failed",
      message: "平台不在当前支持范围内。"
    };
  }

  const auth = await checkWechatsyncAuth(platform);

  return {
    ok: auth.authenticated,
    status: auth.authenticated ? "success" : "pending_config",
    message: auth.message,
    data: {
      platform,
      authenticated: auth.authenticated,
      nextAction: auth.nextAction
    }
  };
}

export async function sendDistributionTargetDraft(id: string): Promise<WorkflowResult<{ target: DistributionTarget }>> {
  const state = readWorkbenchState();
  const targetIndex = state.distributionTargets.findIndex((item) => item.id === id);

  if (targetIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到平台草稿任务：${id}`
    };
  }

  const target = state.distributionTargets[targetIndex];
  const record = state.publishRecords.find((item) => item.id === target.publishRecordId);
  const draft = state.drafts.find((item) => item.id === target.draftId);
  const variant = state.platformDraftVariants.find((item) => item.id === target.platformVariantId);
  const failTarget = (errorCode: NonNullable<DistributionTarget["errorCode"]>, message: string): WorkflowResult<{ target: DistributionTarget }> => {
    const failedTarget: DistributionTarget = {
      ...target,
      status: errorCode === "auth_required" ? "auth_required" : "failed",
      errorCode,
      errorMessage: message,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso()
    };
    state.distributionTargets[targetIndex] = failedTarget;
    saveWithEvent(state, "distribution_draft_failed", `Platform draft ${id} failed: ${errorCode}.`);

    return {
      ok: false,
      status: errorCode === "bridge_not_configured" || errorCode === "bridge_unreachable" || errorCode === "auth_required" ? "pending_config" : "failed",
      message,
      data: { target: failedTarget }
    };
  };

  if (!record || !draft) {
    return failTarget("unknown", "平台草稿任务缺少对应发布记录或终稿。");
  }

  if (record.publishStatus !== "queued") {
    return failTarget("sync_failed", "只有待发布状态的记录可以写入平台草稿箱。");
  }

  if (!variant) {
    return failTarget("variant_missing", "缺少平台专属终稿，不能写入平台草稿箱。");
  }

  if (variant.status !== "final" || !variant.qaResult.passed || variant.qaResult.distributionAllowed === false) {
    return failTarget("qa_blocked", "平台专属终稿尚未达到分发标准，不能写入平台草稿箱。");
  }

  const checkingTarget: DistributionTarget = {
    ...target,
    status: "checking",
    errorCode: undefined,
    errorMessage: undefined,
    lastCheckedAt: nowIso(),
    updatedAt: nowIso()
  };
  state.distributionTargets[targetIndex] = checkingTarget;
  writeWorkbenchState(state);

  const runtime = await getWechatsyncRuntimeStatus();

  if (runtime.bridgeStatus !== "ready") {
    return failTarget(runtime.bridgeStatus === "pending_config" ? "bridge_not_configured" : "bridge_unreachable", runtime.message);
  }

  if (runtime.mode === "real" && !runtime.supportedPlatforms.includes(target.platform)) {
    return failTarget("platform_not_supported", `平台 ${target.platform} 尚未接入真实 bridge。`);
  }

  const auth = await checkWechatsyncAuth(target.platform);

  if (!auth.authenticated) {
    return failTarget("auth_required", auth.message);
  }

  state.distributionTargets[targetIndex] = {
    ...checkingTarget,
    status: "sending",
    updatedAt: nowIso()
  };
  writeWorkbenchState(state);

  const sent = await sendWechatsyncDraft({
    platform: target.platform,
    title: variant.title,
    markdown: variant.content
  });

  if (sent.status !== "draft_created") {
    return failTarget(sent.errorCode || "sync_failed", sent.message);
  }

  const nextTarget: DistributionTarget = {
    ...target,
    status: "draft_created",
    draftUrl: sent.draftUrl,
    editorUrl: sent.editorUrl,
    externalDraftId: sent.externalDraftId,
    mode: sent.mode,
    errorCode: undefined,
    errorMessage: undefined,
    lastCheckedAt: nowIso(),
    sentAt: nowIso(),
    updatedAt: nowIso()
  };
  state.distributionTargets[targetIndex] = nextTarget;
  saveWithEvent(state, "distribution_draft_created", `Created ${sent.mode} platform draft for target ${id}.`);

  return {
    ok: true,
    status: "success",
    message: sent.message,
    data: { target: nextTarget }
  };
}

function getDefaultDirectPublishPlatformsForDraft(draft: Pick<ArticleDraft, "channel">): DirectPublishPlatformKey[] {
  if (draft.channel === "wechat") return ["wechat"];
  if (draft.channel === "csdn") return ["csdn"];
  if (draft.channel === "juejin") return ["juejin"];
  if (draft.channel === "zhihu_toutiao_general") return ["zhihu"];
  return ["wechat"];
}

function getDirectPublishPlatforms(input: Record<string, unknown>, draft: Pick<ArticleDraft, "channel">): DirectPublishPlatformKey[] {
  const requested = Array.isArray(input.platforms)
    ? input.platforms.map(coerceDirectPublishPlatform).filter((platform): platform is DirectPublishPlatformKey => Boolean(platform))
    : [];
  const singlePlatform = coerceDirectPublishPlatform(input.platform);
  const platforms = requested.length ? requested : singlePlatform ? [singlePlatform] : getDefaultDirectPublishPlatformsForDraft(draft);

  return Array.from(new Set(platforms));
}

function getScheduleStatusFromPrecheck(status: "ready" | "pending_config" | "auth_required" | "manual_takeover_required" | "failed"): PublishScheduleStatus {
  if (status === "pending_config") return "pending_config";
  if (status === "manual_takeover_required") return "manual_takeover_required";
  return "precheck_failed";
}

function getFailureCodeFromPrecheck(status: "ready" | "pending_config" | "auth_required" | "manual_takeover_required" | "failed"): PublishFailureCode {
  if (status === "pending_config") return "pending_config";
  if (status === "auth_required") return "auth_required";
  if (status === "manual_takeover_required") return "manual_takeover_required";
  return "adapter_failed";
}

function buildDirectPublishPayload(schedule: PublishSchedule, draft: ArticleDraft): PlatformPublishPayload {
  return {
    title: draft.title,
    markdown: draft.content,
    summary: draft.summary,
    scheduledAt: schedule.scheduledAt,
    sourceDraftId: draft.id,
    publishRecordId: schedule.publishRecordId,
    matrixItemId: schedule.matrixItemId,
    categoryId: schedule.platform === "juejin" ? process.env.JUEJIN_CATEGORY_ID : undefined,
    tagIds:
      schedule.platform === "juejin" && process.env.JUEJIN_TAG_IDS
        ? process.env.JUEJIN_TAG_IDS.split(",").map((item) => item.trim()).filter(Boolean)
        : undefined,
    coverMediaId: schedule.platform === "wechat" ? process.env.WECHAT_MP_THUMB_MEDIA_ID : undefined,
    dryRun: process.env.DIRECT_PUBLISH_ENABLED !== "true"
  };
}

function findOrCreatePublishRecordForSchedule(state: WorkbenchState, draft: ArticleDraft): PublishRecord {
  const existingRecord = state.publishRecords.find((item) => item.draftId === draft.id);

  if (existingRecord) {
    return existingRecord;
  }

  const record: PublishRecord = {
    id: createId("pub"),
    draftId: draft.id,
    channel: draft.channel,
    title: draft.title,
    publishStatus: "queued",
    ...buildPublishRecordWeekFields(state, draft)
  };
  state.publishRecords.push(record);
  return record;
}

export function createPublishSchedules(input: Record<string, unknown>): WorkflowResult<{ schedules: PublishSchedule[]; record: PublishRecord }> {
  const state = readWorkbenchState();
  const draftId = typeof input.draftId === "string" ? input.draftId : undefined;
  const publishRecordId = typeof input.publishRecordId === "string" ? input.publishRecordId : undefined;
  const recordFromInput = publishRecordId ? state.publishRecords.find((item) => item.id === publishRecordId) : undefined;
  const draft = draftId
    ? state.drafts.find((item) => item.id === draftId)
    : recordFromInput
      ? state.drafts.find((item) => item.id === recordFromInput.draftId)
      : undefined;

  if (!draft) {
    return {
      ok: false,
      status: "pending_input",
      message: "请传入可发布终稿 draftId 或 publishRecordId。"
    };
  }

  if (draft.status !== "final" || !draft.qaResult.passed || draft.qaResult.distributionAllowed === false) {
    return {
      ok: false,
      status: "failed",
      message: "只有已确认且质检通过的终稿可以创建正式发布排程。"
    };
  }

  const scheduledAt =
    typeof input.scheduledAt === "string" && !Number.isNaN(new Date(input.scheduledAt).getTime())
      ? input.scheduledAt
      : draft.updatedAt || nowIso();
  const platforms = getDirectPublishPlatforms(input, draft);
  const record = recordFromInput || findOrCreatePublishRecordForSchedule(state, draft);
  const schedules: PublishSchedule[] = [];

  for (const platform of platforms) {
    const existing = state.publishSchedules.find(
      (item) =>
        item.draftId === draft.id &&
        item.platform === platform &&
        item.scheduledAt === scheduledAt &&
        !["failed", "precheck_failed", "manual_takeover_required", "pending_config"].includes(item.status)
    );

    if (existing) {
      schedules.push(existing);
      continue;
    }

    const schedule: PublishSchedule = {
      id: createId("schedule"),
      platform,
      status: "scheduled",
      scheduledAt,
      draftId: draft.id,
      publishRecordId: record.id,
      matrixItemId: typeof input.matrixItemId === "string" ? input.matrixItemId : undefined,
      attemptIds: [],
      retryCount: 0,
      pendingCsvReturn: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.publishSchedules.push(schedule);
    schedules.push(schedule);
  }

  saveWithEvent(state, "publish_schedule_created", `Created ${schedules.length} direct publish schedules for draft ${draft.id}.`);

  return {
    ok: true,
    status: "success",
    message: "正式发布排程已创建。",
    data: {
      schedules,
      record
    }
  };
}

export async function runPublishSchedule(id: string): Promise<WorkflowResult<{ schedule: PublishSchedule; attempt: PublishAttempt }>> {
  const state = readWorkbenchState();
  const scheduleIndex = state.publishSchedules.findIndex((item) => item.id === id);

  if (scheduleIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到正式发布排程：${id}`
    };
  }

  const schedule = state.publishSchedules[scheduleIndex];

  if (["published_verified", "published_pending_url"].includes(schedule.status)) {
    const attempt: PublishAttempt = {
      id: createId("attempt"),
      scheduleId: schedule.id,
      platform: schedule.platform,
      status: schedule.status === "published_verified" ? "published_verified" : "published_pending_url",
      startedAt: nowIso(),
      finishedAt: nowIso(),
      mode: "dry_run",
      authStatus: "ready",
      payloadStatus: "valid",
      publishStatus: "confirmed",
      verifyStatus: "verified",
      platformArticleId: schedule.platformArticleId,
      publicUrl: schedule.publicUrl,
      pendingCsvReturn: schedule.pendingCsvReturn,
      failureCode: "duplicate_protected",
      diagnosticSummary: "Duplicate execution skipped because schedule is already published."
    };

    return {
      ok: true,
      status: "success",
      message: "该排程已完成发布，重复执行已被保护。",
      data: {
        schedule,
        attempt
      }
    };
  }

  const draft = state.drafts.find((item) => item.id === schedule.draftId);

  if (!draft) {
    return {
      ok: false,
      status: "failed",
      message: "发布排程缺少对应终稿。"
    };
  }

  const adapter = getPublishAdapter(schedule.platform);
  const startedAt = nowIso();
  const payload = buildDirectPublishPayload(schedule, draft);
  const auth = await adapter.checkAuth();
  const validation = await adapter.validatePayload(payload);
  const attemptBase: PublishAttempt = {
    id: createId("attempt"),
    scheduleId: schedule.id,
    platform: schedule.platform,
    status: "publishing",
    startedAt,
    mode: "dry_run",
    authStatus: auth.status,
    payloadStatus: validation.ok ? "valid" : "invalid",
    verifyStatus: "not_started"
  };

  const finishAttempt = (attempt: PublishAttempt, status: PublishScheduleStatus, message: string): WorkflowResult<{ schedule: PublishSchedule; attempt: PublishAttempt }> => {
    const finishedAttempt: PublishAttempt = {
      ...attempt,
      finishedAt: attempt.finishedAt || nowIso()
    };
    const nextSchedule: PublishSchedule = {
      ...schedule,
      status,
      latestAttemptId: finishedAttempt.id,
      attemptIds: Array.from(new Set([...schedule.attemptIds, finishedAttempt.id])),
      publishedAt: finishedAttempt.status === "published_verified" || finishedAttempt.status === "published_pending_url" ? finishedAttempt.finishedAt : schedule.publishedAt,
      platformArticleId: finishedAttempt.platformArticleId,
      publicUrl: finishedAttempt.publicUrl,
      pendingCsvReturn: Boolean(finishedAttempt.pendingCsvReturn),
      failureCode: finishedAttempt.failureCode,
      failureReason: finishedAttempt.failureReason,
      nextAction: finishedAttempt.nextAction,
      retryCount: status === "failed" || status === "pending_verify" ? schedule.retryCount + 1 : schedule.retryCount,
      manualTakeoverReason: status === "manual_takeover_required" ? finishedAttempt.failureReason || finishedAttempt.nextAction : schedule.manualTakeoverReason,
      updatedAt: nowIso()
    };

    state.publishSchedules[scheduleIndex] = nextSchedule;
    state.publishAttempts.push(finishedAttempt);

    const recordIndex = nextSchedule.publishRecordId ? state.publishRecords.findIndex((item) => item.id === nextSchedule.publishRecordId) : -1;

    if (recordIndex >= 0 && ["published_verified", "published_pending_url"].includes(nextSchedule.status)) {
      state.publishRecords[recordIndex] = {
        ...state.publishRecords[recordIndex],
        publishStatus: nextSchedule.publicUrl ? "url_filled" : "published",
        publishedAt: nextSchedule.publishedAt || nowIso(),
        publishedUrl: nextSchedule.publicUrl || state.publishRecords[recordIndex].publishedUrl,
        notes: nextSchedule.pendingCsvReturn ? "正式发布已确认，公开 URL 等待 CSV 回传或人工回填。" : state.publishRecords[recordIndex].notes
      };
    }

    saveWithEvent(state, "direct_publish_attempt_finished", `Direct publish schedule ${id} finished with ${status}.`);

    return {
      ok: ["published_verified", "published_pending_url", "pending_verify"].includes(status),
      status: status === "pending_config" ? "pending_config" : status === "manual_takeover_required" ? "pending_input" : status === "failed" || status === "precheck_failed" ? "failed" : "success",
      message,
      data: {
        schedule: nextSchedule,
        attempt: finishedAttempt
      }
    };
  };

  if (!auth.ok) {
    const status = getScheduleStatusFromPrecheck(auth.status);
    return finishAttempt(
      {
        ...attemptBase,
        status: status === "pending_config" ? "pending_config" : status === "manual_takeover_required" ? "manual_takeover_required" : "precheck_failed",
        failureCode: getFailureCodeFromPrecheck(auth.status),
        failureReason: auth.message,
        nextAction: auth.nextAction,
        diagnosticSummary: auth.missingConfig?.length ? `missing_config=${auth.missingConfig.join(",")}` : auth.message
      },
      status,
      auth.message
    );
  }

  if (!validation.ok) {
    return finishAttempt(
      {
        ...attemptBase,
        status: "precheck_failed",
        failureCode: validation.failureCode || "payload_invalid",
        failureReason: validation.message,
        nextAction: validation.nextAction
      },
      "precheck_failed",
      validation.message
    );
  }

  state.publishSchedules[scheduleIndex] = {
    ...schedule,
    status: "publishing",
    updatedAt: nowIso()
  };
  writeWorkbenchState(state);

  const publishResult = await adapter.publish(payload);

  if (!publishResult.ok) {
    return finishAttempt(
      {
        ...attemptBase,
        status: publishResult.status,
        mode: publishResult.mode,
        publishStatus: publishResult.publishStatus,
        failureCode: publishResult.failureCode || "adapter_failed",
        failureReason: publishResult.failureReason,
        nextAction: publishResult.nextAction,
        diagnosticSummary: publishResult.diagnosticSummary
      },
      publishResult.status,
      publishResult.failureReason || "正式发布执行失败。"
    );
  }

  const verifyResult = await adapter.verify(publishResult);
  const finalStatus = verifyResult.status;

  return finishAttempt(
    {
      ...attemptBase,
      status: finalStatus,
      mode: publishResult.mode,
      publishStatus: publishResult.publishStatus,
      verifyStatus: verifyResult.verifyStatus,
      platformArticleId: verifyResult.platformArticleId,
      publicUrl: verifyResult.publicUrl,
      pendingCsvReturn: verifyResult.pendingCsvReturn,
      failureCode: verifyResult.failureCode,
      failureReason: verifyResult.failureReason,
      nextAction: verifyResult.nextAction,
      diagnosticSummary: publishResult.diagnosticSummary
    },
    finalStatus,
    verifyResult.ok ? "正式发布执行完成，并已记录验证结果。" : verifyResult.failureReason || "正式发布验证失败。"
  );
}

export async function runDuePublishSchedules(input: Record<string, unknown> = {}): Promise<WorkflowResult<{ schedules: PublishSchedule[]; attempts: PublishAttempt[] }>> {
  const state = readWorkbenchState();
  const now = typeof input.now === "string" && !Number.isNaN(new Date(input.now).getTime()) ? new Date(input.now) : new Date();
  const limit = typeof input.limit === "number" && input.limit > 0 ? Math.floor(input.limit) : 20;
  const dueSchedules = state.publishSchedules
    .filter((schedule) => schedule.status === "scheduled" && new Date(schedule.scheduledAt).getTime() <= now.getTime())
    .slice(0, limit);
  const schedules: PublishSchedule[] = [];
  const attempts: PublishAttempt[] = [];

  for (const schedule of dueSchedules) {
    const result = await runPublishSchedule(schedule.id);

    if (result.data?.schedule) schedules.push(result.data.schedule);
    if (result.data?.attempt) attempts.push(result.data.attempt);
  }

  return {
    ok: true,
    status: "success",
    message: `已执行 ${attempts.length} 条到期正式发布排程。`,
    data: {
      schedules,
      attempts
    }
  };
}

export function fillPublishUrl(id: string, input: Record<string, unknown>): WorkflowResult<{ record: PublishRecord }> {
  const state = readWorkbenchState();
  const recordIndex = state.publishRecords.findIndex((item) => item.id === id);
  const publishedUrl = typeof input.publishedUrl === "string" ? input.publishedUrl.trim() : undefined;

  if (recordIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到发布记录：${id}`
    };
  }

  if (!publishedUrl) {
    return {
      ok: false,
      status: "pending_input",
      message: "请提供 publishedUrl 后再回填。"
    };
  }

  try {
    new URL(publishedUrl);
  } catch {
    return {
      ok: false,
      status: "failed",
      message: "publishedUrl 不是有效 URL。"
    };
  }

  const currentRecord = state.publishRecords[recordIndex];
  const draft = state.drafts.find((item) => item.id === currentRecord.draftId);
  const weekFields = draft
    ? buildPublishRecordWeekFields(state, draft)
    : {
        plannedPublishDate: currentRecord.plannedPublishDate,
        sourceWeek: normalizeReportWeek(input.sourceWeek, currentRecord.sourceWeek || state.weeklyPlan.weekStart)
      };
  const record: PublishRecord = {
    ...currentRecord,
    ...weekFields,
    publishStatus: "url_filled",
    publishedUrl,
    publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : nowIso(),
    notes: typeof input.notes === "string" ? input.notes : currentRecord.notes
  };

  state.publishRecords[recordIndex] = record;

  const taskIndex = draft ? state.tasks.findIndex((item) => item.id === draft.taskId) : -1;

  if (taskIndex >= 0) {
    state.tasks[taskIndex] = {
      ...state.tasks[taskIndex],
      status: "url_filled"
    };
  }

  saveWithEvent(state, "publish_url_filled", `Filled URL for publish record ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "URL 已回填，发布台账已更新。",
    data: { record }
  };
}

export function markPublishRecordPublished(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ record: PublishRecord }> {
  const state = readWorkbenchState();
  const recordIndex = state.publishRecords.findIndex((item) => item.id === id);

  if (recordIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到发布记录：${id}`
    };
  }

  const currentRecord = state.publishRecords[recordIndex];
  const draft = state.drafts.find((item) => item.id === currentRecord.draftId);
  const weekFields = draft
    ? buildPublishRecordWeekFields(state, draft)
    : {
        plannedPublishDate: currentRecord.plannedPublishDate,
        sourceWeek: normalizeReportWeek(input.sourceWeek, currentRecord.sourceWeek || state.weeklyPlan.weekStart)
      };
  const record: PublishRecord = {
    ...currentRecord,
    ...weekFields,
    publishStatus: "published",
    publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : currentRecord.publishedAt || nowIso(),
    notes: typeof input.notes === "string" ? input.notes : currentRecord.notes
  };

  state.publishRecords[recordIndex] = record;

  const taskIndex = draft ? state.tasks.findIndex((item) => item.id === draft.taskId) : -1;

  if (taskIndex >= 0) {
    state.tasks[taskIndex] = {
      ...state.tasks[taskIndex],
      status: "published"
    };
  }

  saveWithEvent(state, "publish_record_marked_published", `Marked publish record ${id} as published.`);

  return {
    ok: true,
    status: "success",
    message: "发布记录已标记为已发布，等待 URL 回填。",
    data: { record }
  };
}

export function markContentTaskPublished(taskId: string, input: Record<string, unknown> = {}): WorkflowResult<{ task: ContentTask; draft: ArticleDraft; record: PublishRecord }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === taskId);

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${taskId}`
    };
  }

  const draftIndex = state.drafts.findIndex((item) => item.taskId === taskId);

  if (draftIndex < 0) {
    return {
      ok: false,
      status: "pending_input",
      message: "请先在今日发布页批量生成正文，并在草稿预览页通过二次质检。"
    };
  }

  const draft = state.drafts[draftIndex];

  if (!draft.qaResult.passed) {
    return {
      ok: false,
      status: "failed",
      message: "草稿仍有阻断项，不能确认已发布。"
    };
  }

  const finalDraft: ArticleDraft = {
    ...draft,
    status: "final",
    updatedAt: nowIso()
  };
  const existingRecordIndex = state.publishRecords.findIndex((item) => item.draftId === finalDraft.id);
  const weekFields = buildPublishRecordWeekFields(state, finalDraft);
  const record: PublishRecord =
    existingRecordIndex >= 0
      ? {
          ...state.publishRecords[existingRecordIndex],
          ...weekFields,
          title: finalDraft.title,
          channel: finalDraft.channel,
          publishStatus: "published",
          publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : state.publishRecords[existingRecordIndex].publishedAt || nowIso(),
          notes: typeof input.notes === "string" ? input.notes : state.publishRecords[existingRecordIndex].notes
        }
      : {
          id: createId("pub"),
          draftId: finalDraft.id,
          channel: finalDraft.channel,
          title: finalDraft.title,
          publishStatus: "published",
          ...weekFields,
          publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : nowIso(),
          notes: typeof input.notes === "string" ? input.notes : undefined
        };

  state.drafts[draftIndex] = finalDraft;
  state.tasks[taskIndex] = {
    ...state.tasks[taskIndex],
    status: "published",
    qaSummary: "已人工发布，等待 URL 回填"
  };

  if (existingRecordIndex >= 0) {
    state.publishRecords[existingRecordIndex] = record;
  } else {
    state.publishRecords.push(record);
  }

  saveWithEvent(state, "content_task_marked_published", `Marked content task ${taskId} as published from today page.`);

  return {
    ok: true,
    status: "success",
    message: "已确认发布，请继续回填正式 URL。",
    data: {
      task: state.tasks[taskIndex],
      draft: finalDraft,
      record
    }
  };
}

export function fillContentTaskPublishUrl(taskId: string, input: Record<string, unknown>): WorkflowResult<{ task: ContentTask; record: PublishRecord }> {
  const state = readWorkbenchState();
  const taskIndex = state.tasks.findIndex((item) => item.id === taskId);
  const draft = state.drafts.find((item) => item.taskId === taskId);
  const recordIndex = draft ? state.publishRecords.findIndex((item) => item.draftId === draft.id) : -1;
  const publishedUrl = typeof input.publishedUrl === "string" ? input.publishedUrl.trim() : undefined;

  if (taskIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到内容任务：${taskId}`
    };
  }

  if (!draft || recordIndex < 0) {
    return {
      ok: false,
      status: "pending_input",
      message: "请先在今日发布页确认已发布，再回填 URL。"
    };
  }

  if (!publishedUrl) {
    return {
      ok: false,
      status: "pending_input",
      message: "请填写正式发布 URL。"
    };
  }

  try {
    new URL(publishedUrl);
  } catch {
    return {
      ok: false,
      status: "failed",
      message: "URL 格式不正确，请填写完整链接。"
    };
  }

  const record: PublishRecord = {
    ...state.publishRecords[recordIndex],
    ...buildPublishRecordWeekFields(state, draft),
    publishStatus: "url_filled",
    publishedUrl,
    publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : state.publishRecords[recordIndex].publishedAt || nowIso(),
    notes: typeof input.notes === "string" ? input.notes : state.publishRecords[recordIndex].notes
  };

  state.publishRecords[recordIndex] = record;
  state.tasks[taskIndex] = {
    ...state.tasks[taskIndex],
    status: "url_filled",
    qaSummary: "已回填 URL，等待渠道数据回传"
  };

  saveWithEvent(state, "content_task_publish_url_filled", `Filled publish URL for content task ${taskId}.`);

  return {
    ok: true,
    status: "success",
    message: "URL 已回填，后续到数据回传页导入渠道指标。",
    data: {
      task: state.tasks[taskIndex],
      record
    }
  };
}

export function exportPublishRecords() {
  const state = readWorkbenchState();
  const exportedAt = nowIso();
  const records = state.publishRecords.map((record) => ({
    ...record,
    exportedAt
  }));

  state.publishRecords = records;
  saveWithEvent(state, "publish_records_exported", `Exported ${records.length} publish records.`);

  const csv = [
    "id,channel,title,publishStatus,publishedUrl,publishedAt",
    ...records.map((record) =>
      [record.id, record.channel, `"${record.title.replace(/"/g, '""')}"`, record.publishStatus, record.publishedUrl || "", record.publishedAt || ""].join(",")
    )
  ].join("\n");

  return {
    records,
    csv,
    exportedAt
  };
}

export function importChannelMetricsForPublishRecords(
  input: Record<string, unknown>
): WorkflowResult<{ records: PublishRecord[]; matched: number; unmatched: number }> {
  const state = readWorkbenchState();
  const result = importChannelMetrics(input, state.publishRecords);

  if (!result.ok || !result.records) {
    return {
      ok: false,
      status: result.status,
      message: result.message,
      data: {
        records: state.publishRecords,
        matched: result.matched || 0,
        unmatched: result.unmatched || state.publishRecords.length
      }
    };
  }

  state.publishRecords = result.records;
  saveWithEvent(state, "channel_metrics_imported", `Imported channel metrics: matched ${result.matched || 0}, unmatched ${result.unmatched || 0}.`);

  return {
    ok: true,
    status: "success",
    message: result.message,
    data: {
      records: state.publishRecords,
      matched: result.matched || 0,
      unmatched: result.unmatched || 0
    }
  };
}

export function updatePublishRecordMetrics(id: string, input: Record<string, unknown>): WorkflowResult<{ record: PublishRecord }> {
  const state = readWorkbenchState();
  const recordIndex = state.publishRecords.findIndex((item) => item.id === id);

  if (recordIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到发布记录：${id}`
    };
  }

  const currentMetrics = state.publishRecords[recordIndex].channelMetrics;
  const record: PublishRecord = {
    ...state.publishRecords[recordIndex],
    channelMetrics: {
      impressions: clampNumber(input.impressions, currentMetrics?.impressions || 0, 0, 1000000000),
      views: clampNumber(input.views, currentMetrics?.views || 0, 0, 1000000000),
      likes: clampNumber(input.likes, currentMetrics?.likes || 0, 0, 1000000000),
      favorites: clampNumber(input.favorites, currentMetrics?.favorites || 0, 0, 1000000000),
      comments: clampNumber(input.comments, currentMetrics?.comments || 0, 0, 1000000000),
      shares: clampNumber(input.shares, currentMetrics?.shares || 0, 0, 1000000000),
      importedAt: nowIso()
    }
  };

  state.publishRecords[recordIndex] = record;
  saveWithEvent(state, "publish_record_metrics_updated", `Updated channel metrics for publish record ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "渠道指标已保存到发布台账。",
    data: { record }
  };
}

export async function syncBlogArticles(input: Record<string, unknown>): Promise<WorkflowResult<{ articles: BlogArticle[] }>> {
  const state = readWorkbenchState();
  const result = await loadBlogArticles(input);

  if (!result.ok || !result.articles) {
    if (result.status === "pending_config") {
      saveWithEvent(state, "blog_sync_pending_config", "Blog sync source is not configured yet.");
    }

    return {
      ok: false,
      status: result.status,
      message: result.message,
      missingConfig: result.missingConfig,
      data: { articles: state.blogArticles }
    };
  }

  const existingByUrl = new Map(state.blogArticles.map((article) => [article.url.replace(/\/$/, ""), article]));
  const nextByUrl = new Map(existingByUrl);
  const sourceWeek = normalizeReportWeek(input.sourceWeek, state.weeklyPlan.weekStart);

  for (const article of result.articles) {
    const existing = existingByUrl.get(article.url.replace(/\/$/, ""));
    nextByUrl.set(
      article.url.replace(/\/$/, ""),
      existing
      ? {
          ...existing,
          ...article,
          id: existing.id,
          indexedStatus: existing.indexedStatus,
          seoIssueCount: existing.seoIssueCount,
          geoResult: existing.geoResult,
          candidateStatus: existing.candidateStatus,
          candidateReason: existing.candidateReason,
          candidateAddedAt: existing.candidateAddedAt,
          sourceWeek: article.sourceWeek || sourceWeek
        }
      : {
          ...article,
          sourceWeek: article.sourceWeek || sourceWeek
        }
    );
  }

  state.blogArticles = Array.from(nextByUrl.values());
  saveWithEvent(state, "blog_articles_synced", `Synced ${state.blogArticles.length} blog articles.`);

  return {
    ok: true,
    status: "success",
    message: result.message,
    data: { articles: state.blogArticles }
  };
}

export function diagnoseBlogArticle(id: string): WorkflowResult<{ article: BlogArticle; diagnosis: Record<string, unknown> }> {
  const state = readWorkbenchState();
  const articleIndex = state.blogArticles.findIndex((item) => item.id === id);

  if (articleIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到博客文章：${id}`
    };
  }

  const article = state.blogArticles[articleIndex];
  const seoIssues = [
    article.title.length < 12 ? "标题信息量偏弱" : undefined,
    article.url.startsWith("http") ? undefined : "URL 格式异常",
    article.title.includes("Dify") || article.title.includes("AI") ? undefined : "标题缺少核心主题词"
  ].filter((item): item is string => Boolean(item));
  const geoIssues = article.geoResult === "miss" ? ["当前 GEO 测试未命中 JOTO 或唯客"] : [];
  const nextArticle: BlogArticle = {
    ...article,
    seoIssueCount: seoIssues.length,
    dataConfidence: article.dataConfidence === "demo" ? "imported" : article.dataConfidence
  };
  const diagnosis = {
    seoIssues,
    geoIssues,
    suggestionType: seoIssues.length || geoIssues.length ? "建议优化" : "暂不处理",
    dataConfidence: nextArticle.dataConfidence
  };

  state.blogArticles[articleIndex] = nextArticle;
  saveWithEvent(state, "blog_article_diagnosed", `Diagnosed blog article ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "已完成本地 SEO/GEO 诊断，后续可接入 XCrawl 正文和真实 GEO 结果。",
    data: {
      article: nextArticle,
      diagnosis
    }
  };
}

export function addBlogArticleToCandidatePool(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ article: BlogArticle }> {
  const state = readWorkbenchState();
  const articleIndex = state.blogArticles.findIndex((item) => item.id === id);

  if (articleIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到博客文章：${id}`
    };
  }

  const article = state.blogArticles[articleIndex];
  const fallbackReason =
    article.geoResult === "miss"
      ? "GEO 测试未命中，建议进入博客候选池补强。"
      : article.seoIssueCount > 0
        ? `存在 ${article.seoIssueCount} 个 SEO 问题，建议进入优化候选池。`
        : "人工加入博客候选池。";
  const nextArticle: BlogArticle = {
    ...article,
    candidateStatus: "candidate",
    candidateReason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : fallbackReason,
    candidateAddedAt: nowIso(),
    sourceWeek: normalizeReportWeek(input.sourceWeek, state.weeklyPlan.weekStart)
  };

  state.blogArticles[articleIndex] = nextArticle;
  saveWithEvent(state, "blog_article_added_to_candidate_pool", `Added blog article ${id} to candidate pool.`);

  return {
    ok: true,
    status: "success",
    message: "博客主题已加入候选池。",
    data: { article: nextArticle }
  };
}

export function updateBlogArticleCandidateStatus(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ article: BlogArticle }> {
  const state = readWorkbenchState();
  const articleIndex = state.blogArticles.findIndex((item) => item.id === id);

  if (articleIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到博客文章：${id}`
    };
  }

  const status = input.status;

  if (status !== "candidate" && status !== "planned" && status !== "dismissed" && status !== "none") {
    return {
      ok: false,
      status: "failed",
      message: "候选状态无效，只能是 candidate、planned、dismissed 或 none。"
    };
  }

  const article = state.blogArticles[articleIndex];
  const sourceWeek = normalizeReportWeek(input.sourceWeek, state.weeklyPlan.weekStart);
  const nextArticle: BlogArticle = {
    ...article,
    candidateStatus: status,
    candidateReason:
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim()
        : status === "planned"
          ? article.candidateReason || "已纳入后续博客规划。"
          : status === "dismissed"
            ? article.candidateReason || "已从候选池移出，暂不处理。"
            : article.candidateReason,
    candidateAddedAt: (status === "candidate" || status === "planned") && !article.candidateAddedAt ? nowIso() : article.candidateAddedAt,
    sourceWeek: status === "none" ? article.sourceWeek : sourceWeek
  };

  state.blogArticles[articleIndex] = nextArticle;
  saveWithEvent(state, "blog_article_candidate_status_updated", `Updated blog article ${id} candidate status to ${status}.`);

  return {
    ok: true,
    status: "success",
    message: status === "planned" ? "博客候选主题已标记为已规划。" : status === "dismissed" ? "博客候选主题已移出候选池。" : "博客候选状态已更新。",
    data: { article: nextArticle }
  };
}

export function createContentTaskFromBlogCandidate(id: string, input: Record<string, unknown> = {}): WorkflowResult<{ article: BlogArticle; task: ContentTask }> {
  const state = readWorkbenchState();
  const articleIndex = state.blogArticles.findIndex((item) => item.id === id);

  if (articleIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到博客文章：${id}`
    };
  }

  const article = state.blogArticles[articleIndex];
  const channels = coerceChannels(input.channels) || state.workspaceSetting.enabledChannels || ["wechat"];
  const products = coerceProducts(input.products) || state.workspaceSetting.enabledProducts || ["joto_brand"];
  const channel = channels[0] || "wechat";
  const product = article.title.includes("唯客") || article.title.includes("护栏") ? "weike_guardrails" : products[0] || "joto_brand";
  const contentType: ContentType = article.geoResult === "miss" ? "faq" : article.seoIssueCount >= 2 ? "technical" : "scenario";
  const planContext = buildTaskPlanContext(product, contentType, article.candidateReason || `官网博客问题：${article.title || article.url}`);
  const task: ContentTask = {
    id: createId("task"),
    weeklyPlanId: state.weeklyPlan.id,
    publishDate: typeof input.publishDate === "string" && input.publishDate.trim() ? input.publishDate.trim() : state.weeklyPlan.weekStart,
    channel,
    product,
    title: `渠道补强：${article.title}`,
    contentType,
    targetKeywords: Array.from(new Set([...buildTaskKeywords(product, contentType), "官网博客补强", article.geoResult === "miss" ? "GEO 未命中" : "SEO 优化"])),
    primaryDistilledTerm: planContext.primaryDistilledTerm,
    sourceProblem: planContext.sourceProblem,
    officialLinkTarget: planContext.officialLinkTarget,
    titleReason: planContext.reason,
    riskNote: planContext.riskNote,
    evidenceNeed: planContext.evidenceNeed,
    confidence: planContext.confidence,
    status: "planned",
    qaSummary: `来源博客候选池：${article.candidateReason || article.url}`
  };
  task.titleSourceAttributions = buildContentTaskTitleSourceAttributions(state, task, {
    businessSignal: {
      key: "blog_diagnosis",
      label: "官网博客诊断",
      sourceProblem: planContext.sourceProblem,
      summary: article.candidateReason || `官网博客问题：${article.title || article.url}`,
      referenceId: article.id
    }
  });
  const nextArticle: BlogArticle = {
    ...article,
    candidateStatus: "planned",
    candidateReason: article.candidateReason || "已从博客候选池生成渠道补强任务。",
    candidateAddedAt: article.candidateAddedAt || nowIso(),
    sourceWeek: normalizeReportWeek(input.sourceWeek, state.weeklyPlan.weekStart)
  };

  state.blogArticles[articleIndex] = nextArticle;
  state.tasks = [...state.tasks, task];
  state.weeklyPlan = {
    ...state.weeklyPlan,
    targetTotalCount: state.tasks.length
  };
  saveWithEvent(state, "blog_candidate_content_task_created", `Created content task ${task.id} from blog candidate ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "已从博客候选主题生成渠道补强任务。",
    data: {
      article: nextArticle,
      task
    }
  };
}

export async function runGeoTests(input: Record<string, unknown>): Promise<WorkflowResult<{ results: GeoTestResult[] }>> {
  const state = readWorkbenchState();
  const testCategory = input.testCategory === "dynamic_exploration" ? "dynamic_exploration" : "baseline_fixed";
  const platforms = (Array.isArray(input.platforms) && input.platforms.length ? input.platforms : geoPlatformOptions)
    .map(normalizeGeoPlatformName)
    .filter((item): item is GeoPlatformName => Boolean(item));
  const promptGroups = (
    Array.isArray(input.promptGroups) && input.promptGroups.length
      ? input.promptGroups
      : typeof input.promptGroup === "string"
        ? [input.promptGroup]
        : ["品牌认知"]
  ).filter((item): item is GeoTestResult["promptGroup"] => geoPromptGroupOptions.includes(item as GeoTestResult["promptGroup"]));
  const promptOverrides =
    input.prompts && typeof input.prompts === "object" && !Array.isArray(input.prompts)
      ? (input.prompts as Partial<Record<GeoTestResult["promptGroup"], unknown>>)
      : {};
  const fallbackPrompt = typeof input.prompt === "string" ? input.prompt : undefined;
  const distilledTermIds = Array.isArray(input.distilledTermIds) ? input.distilledTermIds.map(String).filter(Boolean) : [];
  const matrixDistilledTermIds = distilledTermIds.length ? distilledTermIds : [undefined];

  if (!platforms.length || !promptGroups.length) {
    return {
      ok: false,
      status: "pending_input",
      message: "请至少选择一个 GEO 平台和一个问题组。"
    };
  }

  const createdAt = nowIso();
  const sourceWeek = normalizeReportWeek(input.sourceWeek, state.weeklyPlan.weekStart);
  const results: GeoTestResult[] = [];

  for (const platform of platforms) {
    const providerKey = getProviderKeyForPlatform(platform);
    for (const promptGroup of promptGroups) {
      const promptValue = promptOverrides[promptGroup];
      const basePrompt = typeof promptValue === "string" && promptValue.trim() ? promptValue.trim() : fallbackPrompt || defaultGeoPrompts[promptGroup];

      for (const distilledTermId of matrixDistilledTermIds) {
        const prompt = buildGeoPrompt(basePrompt, distilledTermId);
        const providerRequest = {
          provider: providerKey,
          systemPrompt: "你是企业 AI 应用选型助手。请直接回答用户问题，保留你会自然提到的服务商、产品和来源链接。",
          userPrompt: prompt,
          temperature: 0.2
        };
        const { aiResult, retryCount } = await callGeoAiProviderWithRetry(providerRequest);
        const configMessage = aiResult.missingConfig?.length
          ? `模型配置缺失：${aiResult.missingConfig.join("、")}。未调用真实模型，也未生成假命中。`
          : "";
        const retryMessage =
          retryCount > 0 && aiResult.errorMessage ? `已间隔 ${geoTestRetryDelayMs}ms 重试 ${retryCount} 次，仍失败：${aiResult.errorMessage}` : aiResult.errorMessage;
        const snapshot = aiResult.content || retryMessage || configMessage;
        const citedUrls = aiResult.ok ? extractUrls(snapshot) : [];
        const partialResult = {
          mentionedJoto: aiResult.ok && snapshot.includes("JOTO"),
          mentionedWeike: aiResult.ok && snapshot.includes("唯客"),
          citedOfficialUrl: aiResult.ok && snapshot.includes("jotoai.com"),
          competitorAppeared: aiResult.ok ? detectCompetitorAppeared(snapshot) : false,
          executionStatus: aiResult.status
        };
        const citationLevel = getGeoCitationLevel({ ...partialResult, citedUrls });
        const issueType = getGeoIssueType({ ...partialResult, citationLevel });
        const accuracyStatus = getGeoAccuracyStatus(partialResult);

        results.push({
          id: createId("geo"),
          platform,
          testCategory,
          promptGroup,
          distilledTermIds: distilledTermId ? [distilledTermId] : undefined,
          prompt,
          ...partialResult,
          citedUrls,
          citationLevel,
          issueType,
          suggestedAction: getGeoSuggestedAction({ issueType, citationLevel }),
          accuracyStatus,
          reviewStatus: getGeoReviewStatus({ accuracyStatus, executionStatus: aiResult.status }),
          answerSnapshot: snapshot,
          manualOverride: false,
          dataConfidence: aiResult.ok ? "real" : "pending",
          providerKey,
          modelName: aiResult.model,
          testedAt: createdAt,
          sourceWeek,
          errorMessage: retryMessage || configMessage || undefined
        });
      }
    }
  }

  state.geoResults = [...results, ...state.geoResults].slice(0, 100);
  saveWithEvent(state, "geo_tests_created", `Created ${results.length} GEO test records.`);
  const pendingConfigCount = results.filter((result) => result.executionStatus === "pending_config").length;
  const failedCount = results.filter((result) => result.executionStatus === "failed").length;
  const matrixSize = platforms.length * promptGroups.length * matrixDistilledTermIds.length;
  const categoryLabel = testCategory === "baseline_fixed" ? "基线固定问题组" : "动态蒸馏词探索";
  const matrixDescription =
    testCategory === "baseline_fixed"
      ? `${platforms.length} 个平台 × ${promptGroups.length} 个固定问题组 = ${matrixSize} 条`
      : `${platforms.length} 个平台 × ${promptGroups.length} 个问题组 × ${matrixDistilledTermIds.length} 个蒸馏词 = ${matrixSize} 条`;
  const status =
    pendingConfigCount === results.length
      ? "pending_config"
      : failedCount === results.length
        ? "failed"
        : "success";
  const statusSuffix = pendingConfigCount
    ? `其中 ${pendingConfigCount} 条待配置，未生成假命中。`
    : failedCount
      ? `其中 ${failedCount} 条执行失败，请查看详情。`
      : "全部完成。";

  return {
    ok: true,
    status,
    message: `GEO 测试记录已创建：${categoryLabel}，${matrixDescription}。${statusSuffix}`,
    data: { results }
  };
}

type GeoAiProviderRequest = Parameters<typeof callAiProvider>[0];
type GeoAiProviderResult = Awaited<ReturnType<typeof callAiProvider>>;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryGeoAiResult(result: GeoAiProviderResult) {
  if (result.status !== "failed") {
    return false;
  }

  return /超时|网络连接失败|timeout|fetch failed|econnreset|etimedout|econnrefused|und_err/i.test(result.errorMessage || "");
}

async function callGeoAiProviderWithRetry(request: GeoAiProviderRequest): Promise<{ aiResult: GeoAiProviderResult; retryCount: number }> {
  let aiResult = await callAiProvider(request);
  let retryCount = 0;

  while (retryCount < geoTestMaxRetries && shouldRetryGeoAiResult(aiResult)) {
    retryCount += 1;
    await wait(geoTestRetryDelayMs);
    aiResult = await callAiProvider(request);
  }

  return { aiResult, retryCount };
}

export function overrideGeoResult(id: string, input: Record<string, unknown>): WorkflowResult<{ result: GeoTestResult }> {
  const state = readWorkbenchState();
  const resultIndex = state.geoResults.findIndex((item) => item.id === id);

  if (resultIndex < 0) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 GEO 测试结果：${id}`
    };
  }

  const result: GeoTestResult = {
    ...state.geoResults[resultIndex],
    mentionedJoto: typeof input.mentionedJoto === "boolean" ? input.mentionedJoto : state.geoResults[resultIndex].mentionedJoto,
    mentionedWeike: typeof input.mentionedWeike === "boolean" ? input.mentionedWeike : state.geoResults[resultIndex].mentionedWeike,
    citedOfficialUrl: typeof input.citedOfficialUrl === "boolean" ? input.citedOfficialUrl : state.geoResults[resultIndex].citedOfficialUrl,
    competitorAppeared:
      typeof input.competitorAppeared === "boolean" ? input.competitorAppeared : state.geoResults[resultIndex].competitorAppeared,
    manualOverride: true
  };

  result.accuracyStatus = getGeoAccuracyStatus({
    mentionedJoto: result.mentionedJoto,
    citedOfficialUrl: result.citedOfficialUrl,
    competitorAppeared: result.competitorAppeared,
    executionStatus: result.executionStatus
  });
  result.citationLevel = getGeoCitationLevel(result);
  result.issueType = getGeoIssueType({ ...result, citationLevel: result.citationLevel });
  result.suggestedAction = getGeoSuggestedAction({ issueType: result.issueType, citationLevel: result.citationLevel });
  result.reviewStatus = "manual_confirmed";

  state.geoResults[resultIndex] = result;
  saveWithEvent(state, "geo_result_overridden", `Manual override applied to GEO result ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "GEO 判断已人工修正，原始回答快照未被覆盖。",
    data: { result }
  };
}

export function addGeoResultToCandidatePool(id: string): WorkflowResult<{ article: BlogArticle; result: GeoTestResult }> {
  const state = readWorkbenchState();
  const result = state.geoResults.find((item) => item.id === id);

  if (!result) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 GEO 测试结果：${id}`
    };
  }

  if (result.mentionedJoto && result.citedOfficialUrl) {
    return {
      ok: false,
      status: "pending_input",
      message: "该 GEO 结果已经命中 JOTO 且引用官网，暂不需要进入博客候选池。"
    };
  }

  const existingIndex = state.blogArticles.findIndex((article) => article.id === `geo-candidate-${result.id}`);
  const candidate: BlogArticle = {
    id: `geo-candidate-${result.id}`,
    title: `补强 GEO 问题：${result.prompt}`,
    url: `geo://result/${result.id}`,
    indexedStatus: "unknown",
    seoIssueCount: result.citedOfficialUrl ? 0 : 1,
    geoResult: result.mentionedJoto ? "partial" : "miss",
    dataConfidence: result.dataConfidence || "imported",
    lastCrawledAt: result.testedAt || nowIso(),
    candidateStatus: "candidate",
    candidateReason: `来自 ${result.platform} 的 GEO 测试：${result.mentionedJoto ? "提及 JOTO 但链路不足" : "未提及 JOTO"}；${result.citedOfficialUrl ? "已引用官网" : "未引用官网"}。`,
    candidateAddedAt: nowIso(),
    sourceWeek: result.sourceWeek || state.weeklyPlan.weekStart
  };

  if (existingIndex >= 0) {
    state.blogArticles[existingIndex] = {
      ...state.blogArticles[existingIndex],
      ...candidate
    };
  } else {
    state.blogArticles = [candidate, ...state.blogArticles];
  }

  saveWithEvent(state, "geo_result_added_to_candidate_pool", `Added GEO result ${id} to blog candidate pool.`);

  return {
    ok: true,
    status: "success",
    message: "GEO 未命中主题已加入博客候选池。",
    data: {
      article: candidate,
      result
    }
  };
}

export function createContentTaskFromGeoGap(id: string): WorkflowResult<{ task: ContentTask; result: GeoTestResult }> {
  const state = readWorkbenchState();
  const result = state.geoResults.find((item) => item.id === id);

  if (!result) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 GEO 测试结果：${id}`
    };
  }

  const product: ProductKey = result.mentionedWeike || result.promptGroup === "产品场景" ? "weike_guardrails" : "joto_brand";
  const contentType: ContentType = result.mentionedJoto ? "faq" : "brand";
  const planContext = buildTaskPlanContext(product, contentType, `GEO 缺口：${result.prompt}`);
  const task: ContentTask = {
    id: createId("task"),
    weeklyPlanId: state.weeklyPlan.id,
    publishDate: state.weeklyPlan.weekStart,
    channel: state.workspaceSetting.enabledChannels[0] || "wechat",
    product,
    title: buildTaskTitle(state.tasks.length, contentType),
    contentType,
    targetKeywords: [...buildTaskKeywords(product, contentType), "GEO 补强"],
    primaryDistilledTerm: planContext.primaryDistilledTerm,
    sourceProblem: planContext.sourceProblem,
    officialLinkTarget: planContext.officialLinkTarget,
    titleReason: `来自 ${result.platform} 的 GEO 问题缺口，用于补强 AI 回答中对品牌、产品或官网信源的认知。`,
    riskNote: result.mentionedJoto ? "已提到品牌但官网引用不足，正文需要加强官方信源。" : "AI 回答未提到品牌，标题需要避免自夸，先回答用户选型问题。",
    evidenceNeed: result.citedOfficialUrl ? "需要补充官网内容证据和更清晰的业务解释。" : "需要补充官网信源、品牌事实和可引用链接。",
    confidence: 0.7,
    status: "planned",
    qaSummary: `来源 GEO 测试：${result.platform} / ${result.promptGroup}`
  };
  task.titleSourceAttributions = buildContentTaskTitleSourceAttributions(state, task, {
    businessSignal: {
      key: "geo_gap",
      label: "GEO 问题缺口",
      sourceProblem: planContext.sourceProblem,
      summary: `${result.platform} / ${result.promptGroup} 下存在品牌提及或官网引用缺口。`,
      referenceId: result.id
    }
  });

  state.tasks = [task, ...state.tasks];
  state.weeklyPlan = {
    ...state.weeklyPlan,
    targetTotalCount: state.tasks.length
  };
  saveWithEvent(state, "geo_gap_content_task_created", `Created content task ${task.id} from GEO result ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "GEO 问题缺口已加入周计划草稿。",
    data: {
      task,
      result
    }
  };
}

export function createKnowledgeBaseFromGeoGap(id: string): WorkflowResult<{ knowledgeBase: KnowledgeBase; result: GeoTestResult }> {
  const state = readWorkbenchState();
  const result = state.geoResults.find((item) => item.id === id);

  if (!result) {
    return {
      ok: false,
      status: "failed",
      message: `未找到 GEO 测试结果：${id}`
    };
  }

  const name = `GEO 补充资料：${result.prompt.slice(0, 24)}`;
  const contentPreview = [
    `来源平台：${result.platform}`,
    `问题组：${result.promptGroup}`,
    `用户问题：${result.prompt}`,
    `当前问题：${result.mentionedJoto ? "已提及 JOTO" : "未提及 JOTO"}；${result.citedOfficialUrl ? "已引用官网" : "未引用官网"}；${result.competitorAppeared ? "竞品出现" : "竞品未明显占位"}。`,
    `回答摘要：${result.answerSnapshot || "暂无回答快照"}`,
    result.citedUrls?.length ? `引用来源：${result.citedUrls.join("、")}` : "引用来源：暂无"
  ].join("\n");
  const idValue = createId("kb");
  const chunks = splitKnowledgeContent(contentPreview, idValue, name, `geo://result/${result.id}`);
  const knowledgeBase: KnowledgeBase = normalizeKnowledgeBase({
    id: idValue,
    name,
    type: "official_blog",
    trustLevel: "medium",
    status: "enabled",
    usageScope: "GEO 问题缺口补充、官网信源补强、周计划选题参考",
    lastSyncedAt: nowIso(),
    sourceType: "manual",
    sourceUrl: `geo://result/${result.id}`,
    contentPreview,
    chunks,
    productExpressionSource: false,
    autoCrawl: {
      enabled: false,
      weekday: 1,
      hour: 9,
      lastCrawledAt: nowIso(),
      nextCrawlAt: addDaysFromNow(7, 9)
    }
  });

  state.knowledgeBases = [knowledgeBase, ...state.knowledgeBases];
  saveWithEvent(state, "geo_gap_knowledge_base_created", `Created knowledge base ${knowledgeBase.id} from GEO result ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "GEO 问题缺口已转为知识库补充资料。",
    data: {
      knowledgeBase,
      result
    }
  };
}

export function importBotLog(input: Record<string, unknown>): WorkflowResult<{ summaries: BotVisitSummary[] }> {
  const result = parseBotLogInput(input);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: result.message
    };
  }

  const state = readWorkbenchState();
  state.botVisits = result.summaries;
  saveWithEvent(state, "bot_log_imported", `Imported ${result.rows.length} log rows and created ${result.summaries.length} bot summaries.`);

  return {
    ok: true,
    status: "success",
    message: result.message,
    data: { summaries: result.summaries }
  };
}

export async function runWorkbenchPipeline(input: RunPipelineInput = {}): Promise<WorkflowResult<{ run: PipelineRunRecord }>> {
  const startedAt = nowIso();
  const steps: PipelineStepResult[] = [];

  if (!input.skipBlog) {
    const result = await syncBlogArticles(input.blog || {});
    steps.push(summarizePipelineStep("sync_blog", result));
  }

  if (!input.skipLog) {
    const logPayload = {
      sourceType: "demo_csv",
      filePath: "data/demo-ai-bot-log.csv",
      ...(input.log || {})
    };
    const result = importBotLog(logPayload);
    steps.push(summarizePipelineStep("import_log", result));
  }

  if (!input.skipChannelMetrics) {
    const channelPayload = {
      filePath: "imports/channel-metrics-smoke.csv",
      ...(input.channelMetrics || {})
    };
    const result = importChannelMetricsForPublishRecords(channelPayload);
    steps.push(summarizePipelineStep("import_channel_metrics", result));
  }

  if (!input.skipGeo) {
    const result = await runGeoTests(input.geo || {});
    steps.push(summarizePipelineStep("run_geo_tests", result));
  }

  const week = typeof input.week === "string" && input.week.trim() ? input.week.trim() : readWorkbenchState().weeklyPlan.weekStart;
  getWeeklyReport(week);
  steps.push({
    name: "read_weekly_report",
    ok: true,
    status: "success",
    message: `已读取 ${week} 周报快照。`,
    fatal: false
  });

  const fatalSteps = steps.filter((step) => step.fatal);
  const pendingSteps = steps.filter((step) => step.status === "pending_config" || step.status === "pending_input");
  const run: PipelineRunRecord = {
    id: createId("pipeline"),
    status: fatalSteps.length ? "failed" : pendingSteps.length ? "partial" : "success",
    startedAt,
    finishedAt: nowIso(),
    steps,
    week,
    summary: getDashboardSummary()
  };
  const state = readWorkbenchState();
  state.pipelineRuns = [run, ...(state.pipelineRuns || [])].slice(0, 20);
  saveWithEvent(state, "pipeline_run_finished", `Pipeline ${run.id} finished with status ${run.status}.`);

  return {
    ok: fatalSteps.length === 0,
    status: fatalSteps.length ? "failed" : pendingSteps.length ? "pending_config" : "success",
    message:
      run.status === "success"
        ? "Pipeline 已完成。"
        : run.status === "partial"
          ? "Pipeline 已部分完成，仍有步骤等待外部配置或输入。"
          : "Pipeline 执行失败，请查看步骤结果。",
    missingConfig: Array.from(new Set(steps.flatMap((step) => step.missingConfig || []))),
    data: { run }
  };
}

export function exportPipelineRuns() {
  const state = readWorkbenchState();
  const runs = state.pipelineRuns || [];
  const csv = [
    "id,status,startedAt,finishedAt,week,stepName,stepStatus,stepMessage,missingConfig",
    ...runs.flatMap((run) =>
      run.steps.map((step) =>
        [
          run.id,
          run.status,
          run.startedAt,
          run.finishedAt,
          run.week,
          step.name,
          step.status,
          `"${step.message.replace(/"/g, '""')}"`,
          `"${(step.missingConfig || []).join(";")}"`
        ].join(",")
      )
    )
  ].join("\n");

  return {
    ok: true,
    status: "success" as const,
    message: `已导出 ${runs.length} 次 Pipeline 运行记录。`,
    data: {
      runs,
      csv,
      exportedAt: nowIso()
    }
  };
}

function createInternalBaseline(current: number, healthyThreshold: number) {
  if (current === 0) return 0;
  return current >= healthyThreshold ? Math.max(0, current - 6) : Math.min(100, current + 6);
}

function getWeeklyTasksForReport(state: WorkbenchState, week: string) {
  const weekEnd = addDays(week, 6);

  return state.tasks.filter((task) => task.publishDate >= week && task.publishDate <= weekEnd);
}

function isDateInReportWeek(value: string | undefined, week: string) {
  if (!value) return false;
  const date = value.slice(0, 10);
  const weekEnd = addDays(week, 6);

  return date >= week && date <= weekEnd;
}

function isSameReportWeek(value: string | undefined, week: string) {
  return Boolean(value && value.slice(0, 10) === week);
}

function getWeeklyBlogDiagnosticsForReport(state: WorkbenchState, week: string) {
  return state.blogArticles.filter((article) => isSameReportWeek(article.sourceWeek, week) || (!article.sourceWeek && isDateInReportWeek(article.candidateAddedAt || article.lastCrawledAt, week)));
}

function getWeeklyGeoResultsForReport(state: WorkbenchState, week: string) {
  return state.geoResults.filter((result) => isSameReportWeek(result.sourceWeek, week) || (!result.sourceWeek && isDateInReportWeek(result.testedAt, week)));
}

function getWeeklyPublishRecordsForReport(state: WorkbenchState, week: string) {
  const weeklyTaskIds = new Set(getWeeklyTasksForReport(state, week).map((task) => task.id));
  const draftTaskIdByDraftId = new Map(state.drafts.map((draft) => [draft.id, draft.taskId]));

  return state.publishRecords.filter((record) => {
    if (record.sourceWeek) return isSameReportWeek(record.sourceWeek, week);
    if (record.plannedPublishDate && isDateInReportWeek(record.plannedPublishDate, week)) return true;
    const taskId = draftTaskIdByDraftId.get(record.draftId);
    if (taskId && weeklyTaskIds.has(taskId)) return true;
    return isDateInReportWeek(record.publishedAt, week);
  });
}

function getQualitySignalStatus(count: number, total: number): WeeklyPlanQualitySignal["status"] {
  if (!count) return "normal";
  if (total && count / total >= 0.3) return "blocked";
  return "attention";
}

function uniqExamples(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 3);
}

function buildWeeklyPlanQualityFeedback(state: WorkbenchState, week: string): WeeklyPlanQualityFeedback {
  const weeklyTasks = getWeeklyTasksForReport(state, week);
  const totalPlanItems = weeklyTasks.length;
  const rejectedTasks = weeklyTasks.filter((task) => task.status === "rejected" || task.rejectionRecords?.length);
  const riskAcceptedTasks = weeklyTasks.filter((task) => task.riskAcceptanceRecords?.length);
  const manualEditedTasks = weeklyTasks.filter((task) => task.editRecords?.some((record) => record.source === "manual"));
  const regeneratedTitleTasks = weeklyTasks.filter((task) => task.editRecords?.some((record) => record.source === "ai_regenerate" && record.field === "title"));
  const lowConfidencePlannedTasks = weeklyTasks.filter((task) => task.status === "planned" && (task.confidence ?? 1) < 0.65);
  const reviewRequiredTasks = weeklyTasks.filter((task) => task.status === "planned" && getContentTaskReviewReasons(task).length);
  const confirmedCount = weeklyTasks.filter((task) =>
    ["confirmed", "generated", "approved", "queued", "published", "url_filled", "measured"].includes(task.status)
  ).length;

  const signals: WeeklyPlanQualitySignal[] = [
    {
      key: "rejected_titles",
      label: "标题 / 选题被驳回",
      count: rejectedTasks.length,
      status: getQualitySignalStatus(rejectedTasks.length, totalPlanItems),
      summary: rejectedTasks.length
        ? "存在被人工驳回的计划项，说明标题、选题或本周目标匹配度需要回流检查。"
        : "本周没有计划项被驳回。",
      nextStep: rejectedTasks.length ? "汇总驳回原因，优先检查标题生成规则、产品表达规则包和本周目标输入。" : "继续观察下周驳回率。",
      examples: uniqExamples(
        rejectedTasks.flatMap((task) =>
          (task.rejectionRecords || []).map((record) => `${task.title}：${record.reason}`)
        )
      )
    },
    {
      key: "risk_accepted",
      label: "高风险被人工接受",
      count: riskAcceptedTasks.length,
      status: getQualitySignalStatus(riskAcceptedTasks.length, totalPlanItems),
      summary: riskAcceptedTasks.length
        ? "存在人工接受风险后确认的计划项，说明部分风险可被业务接受，但原因需要沉淀。"
        : "本周没有高风险计划项被人工接受。",
      nextStep: riskAcceptedTasks.length ? "区分证据已补齐、渠道允许、业务上接受三类原因，并回流风险规则。" : "保持风险接受原因记录。",
      examples: uniqExamples(
        riskAcceptedTasks.flatMap((task) =>
          (task.riskAcceptanceRecords || []).map((record) => `${task.title}：${record.note}`)
        )
      )
    },
    {
      key: "manual_edits",
      label: "人工编辑计划字段",
      count: manualEditedTasks.length,
      status: getQualitySignalStatus(manualEditedTasks.length, totalPlanItems),
      summary: manualEditedTasks.length
        ? "存在人工修改标题、渠道、产品或证据等字段，说明 AI 输入或规则需要校准。"
        : "本周计划字段没有明显人工编辑记录。",
      nextStep: manualEditedTasks.length ? "按字段聚合修改原因，优先检查被频繁修改的字段。" : "继续保持轻量编辑留痕。",
      examples: uniqExamples(
        manualEditedTasks.flatMap((task) =>
          (task.editRecords || [])
            .filter((record) => record.source === "manual")
            .map((record) => `${task.title}：${record.label}`)
        )
      )
    },
    {
      key: "title_regenerated",
      label: "标题被重新生成",
      count: regeneratedTitleTasks.length,
      status: getQualitySignalStatus(regeneratedTitleTasks.length, totalPlanItems),
      summary: regeneratedTitleTasks.length ? "存在重新生成标题，说明原始标题可读性、渠道适配或点击价值不足。" : "本周没有标题重新生成记录。",
      nextStep: regeneratedTitleTasks.length ? "对比重生成前后标题，提炼更适合本周目标的标题模式。" : "继续观察重生成率。",
      examples: uniqExamples(
        regeneratedTitleTasks.flatMap((task) =>
          (task.editRecords || [])
            .filter((record) => record.source === "ai_regenerate" && record.field === "title")
            .map((record) => `${record.before || task.title} -> ${record.after || task.title}`)
        )
      )
    },
    {
      key: "low_confidence_review",
      label: "未达确认阈值待复核",
      count: lowConfidencePlannedTasks.length,
      status: getQualitySignalStatus(lowConfidencePlannedTasks.length, totalPlanItems),
      summary: lowConfidencePlannedTasks.length ? "仍有计划项未达到自动确认阈值，不能进入批量确认。" : "本周没有未达确认阈值的待复核计划项。",
      nextStep: lowConfidencePlannedTasks.length ? "补证据、改标题或驳回；不要直接批量确认。" : "保持批量确认阈值。",
      examples: uniqExamples(lowConfidencePlannedTasks.map((task) => `${task.title}：未达确认阈值`))
    }
  ];

  const modelLearningSignals = signals
    .filter((signal) => signal.count > 0)
    .map((signal) => `${signal.label} ${signal.count} 条：${signal.nextStep}`);

  return {
    totalPlanItems,
    confirmedCount,
    rejectedCount: rejectedTasks.length,
    riskAcceptedCount: riskAcceptedTasks.length,
    manualEditCount: manualEditedTasks.length,
    regeneratedTitleCount: regeneratedTitleTasks.length,
    lowConfidencePlannedCount: lowConfidencePlannedTasks.length,
    reviewRequiredCount: reviewRequiredTasks.length,
    signals,
    modelLearningSignals
  };
}

function buildRecommendationOutcomes(state: WorkbenchState, week: string): WeeklyRecommendationOutcome[] {
  const decisions = state.weeklyReportSuggestionDecisions.filter((item) => item.week === week);
  const weeklyPublishRecords = getWeeklyPublishRecordsForReport(state, week);
  const weeklyPlanItemCount = getWeeklyTasksForReport(state, week).length || state.weeklyPlan.targetTotalCount;
  const weeklyGeoResults = getWeeklyGeoResultsForReport(state, week);
  const publishedCount = weeklyPublishRecords.filter((item) => item.publishStatus === "published" || item.publishStatus === "url_filled").length;
  const dataReturnedCount = weeklyPublishRecords.filter((item) => item.channelMetrics).length;
  const publishCompletionRate = weeklyPlanItemCount ? Math.round((publishedCount / weeklyPlanItemCount) * 100) : 0;
  const dataReturnRate = publishedCount ? Math.round((dataReturnedCount / publishedCount) * 100) : 0;
  const totalViews = weeklyPublishRecords.reduce((sum, item) => sum + (item.channelMetrics?.views || 0), 0);
  const geoHitRate = weeklyGeoResults.length ? Math.round((weeklyGeoResults.filter((item) => item.mentionedJoto).length / weeklyGeoResults.length) * 100) : 0;
  const officialCitationRate = weeklyGeoResults.length
    ? Math.round(
        (weeklyGeoResults.filter((item) => item.citedOfficialUrl || item.citationLevel === "official_site_direct" || item.citationLevel === "official_content").length /
          weeklyGeoResults.length) *
          100
      )
    : 0;
  const completionRateDelta = publishCompletionRate - createInternalBaseline(publishCompletionRate, 80);
  const dataReturnRateDelta = dataReturnRate - createInternalBaseline(dataReturnRate, 80);
  const channelPerformanceDelta = totalViews ? totalViews - Math.max(0, totalViews - 120) : 0;
  const geoHitDelta = weeklyGeoResults.length ? geoHitRate - createInternalBaseline(geoHitRate, 60) : undefined;
  const officialCitationDelta = weeklyGeoResults.length ? officialCitationRate - createInternalBaseline(officialCitationRate, 50) : undefined;

  return decisions.map((decision) => {
    const evaluationStatus =
      decision.status === "rejected" ? "not_applicable" : publishedCount && dataReturnedCount ? "measured" : "waiting_next_week";
    const hasPositiveExecutionSignal = completionRateDelta >= 0 && dataReturnRateDelta >= 0;
    const modelLearningSignal =
      evaluationStatus === "not_applicable"
        ? "建议未被采纳，优先学习拒绝原因和适用边界。"
        : evaluationStatus === "waiting_next_week"
          ? "建议已处理，等待下一周发布和回传数据后再评估。"
          : decision.status === "partially_adopted"
            ? "部分采纳，保留方向但降低自动加量权重。"
            : hasPositiveExecutionSignal
              ? "采纳后执行信号正向，可提高相似建议权重。"
              : "采纳后执行未改善，后续建议需要收敛发布量或补证据。";

    return {
      id: `recommendation-outcome-${decision.id}`,
      week,
      suggestion: decision.suggestion,
      decisionStatus: decision.status,
      evaluationStatus,
      completionRateDelta: evaluationStatus === "measured" ? completionRateDelta : undefined,
      dataReturnRateDelta: evaluationStatus === "measured" ? dataReturnRateDelta : undefined,
      channelPerformanceDelta: evaluationStatus === "measured" ? channelPerformanceDelta : undefined,
      geoHitDelta: evaluationStatus === "measured" ? geoHitDelta : undefined,
      officialCitationDelta: evaluationStatus === "measured" ? officialCitationDelta : undefined,
      failureReason: decision.status === "rejected" || decision.status === "partially_adopted" ? decision.reason || "未填写原因" : undefined,
      modelLearningSignal,
      evaluatedAt: nowIso()
    };
  });
}

function buildWeeklyReportFromState(state: WorkbenchState, week: string) {
  const weeklyPublishRecords = getWeeklyPublishRecordsForReport(state, week);
  const weeklyBlogDiagnostics = getWeeklyBlogDiagnosticsForReport(state, week);
  const weeklyGeoResults = getWeeklyGeoResultsForReport(state, week);
  const planQualityFeedback = buildWeeklyPlanQualityFeedback(state, week);
  const targetTotalCount = planQualityFeedback.totalPlanItems || state.weeklyPlan.targetTotalCount;
  const published = weeklyPublishRecords.filter((item) => item.publishStatus !== "queued").length;
  const geoHits = weeklyGeoResults.filter((item) => item.mentionedJoto).length;
  const botPv = state.botVisits.reduce((sum, item) => sum + item.pv, 0);
  const geoSummary = weeklyGeoResults.length ? `；GEO 提及 JOTO ${geoHits}/${weeklyGeoResults.length}` : "";
  const distilledTermMatrix: WeeklyReportDistilledTermMatrixRow[] = state.distilledTerms.map((term) => {
    const relatedTasks = state.tasks.filter((task) => task.primaryDistilledTerm === term.term || task.targetKeywords.includes(term.term));
    const coveredContentTypes = Array.from(new Set([...relatedTasks.map((task) => task.contentType), ...(term.coveredContentTypes || [])]));
    const relatedGeoResults = weeklyGeoResults.filter((result) => result.distilledTermIds?.includes(term.id) || result.prompt.includes(term.term));
    const geoHitCount = relatedGeoResults.filter((result) => result.mentionedJoto).length;
    const competitorOccupied = term.competitorOccupied || relatedGeoResults.some((result) => result.competitorAppeared);

    return {
      id: term.id,
      term: term.term,
      contentCoverage: relatedTasks.length,
      typeCompleteness: `${coveredContentTypes.length}/5`,
      geoLift: term.geoLift || (relatedGeoResults.length ? Math.round((geoHitCount / relatedGeoResults.length) * 100) : 0),
      competitorOccupied,
      nextSuggestion:
        coveredContentTypes.length < 3
          ? "下周补内容类型，优先 FAQ / 对比 / 案例。"
          : competitorOccupied
            ? "补对比和差异化内容，减少竞品占位。"
            : "保持发布节奏，继续观察 GEO 命中波动。"
    };
  });

  const hasGeoGap = weeklyGeoResults.some((item) => item.executionStatus !== "failed" && (!item.mentionedJoto || !item.citedOfficialUrl));
  const hasBlogAction = weeklyBlogDiagnostics.some((item) => item.candidateStatus === "candidate" || item.geoResult !== "hit" || item.seoIssueCount > 0);
  const nextWeekSuggestions = [
    "继续写已经完成 URL 回填且表现稳定的主题。",
    ...(hasGeoGap ? ["补强本周 GEO 未命中主题，优先进入渠道选题而不是直接进入博客创作。"] : []),
    ...(hasBlogAction ? ["把本周 SEO 问题较多的官网博客加入候选池，等博客创作职责明确后再处理。"] : []),
    "先补齐本周未发布、未回填 URL 或未回传数据的任务，再决定是否提高下周发布量。"
  ];

  return {
    week,
    targetTotalCount,
    executiveSummary: `本周计划 ${targetTotalCount} 篇，已发布 ${published} 篇${geoSummary}；AI 访问量 ${botPv}。`,
    publishRecords: weeklyPublishRecords,
    blogDiagnostics: weeklyBlogDiagnostics,
    geoResults: weeklyGeoResults,
    distilledTerms: state.distilledTerms,
    distilledTermMatrix,
    promptTemplates: state.promptVersions,
    nextWeekSuggestions,
    nextWeekSuggestionItems: buildNextWeekSuggestionItems(state, week, nextWeekSuggestions),
    suggestionDecisions: state.weeklyReportSuggestionDecisions.filter((item) => item.week === week),
    recommendationOutcomes: buildRecommendationOutcomes(state, week),
    planQualityFeedback,
    dataSource: state.runtime.storage
  };
}

type BuiltWeeklyReport = ReturnType<typeof buildWeeklyReportFromState>;

function createWeeklyReportSnapshot(report: BuiltWeeklyReport): WeeklyReportSnapshot {
  const {
    nextWeekSuggestionItems: _nextWeekSuggestionItems,
    suggestionDecisions: _suggestionDecisions,
    recommendationOutcomes: _recommendationOutcomes,
    ...snapshotBase
  } = report;

  return {
    ...snapshotBase,
    createdAt: nowIso()
  };
}

function hydrateWeeklyReportSnapshot(state: WorkbenchState, snapshot: WeeklyReportSnapshot) {
  return {
    ...snapshot,
    nextWeekSuggestionItems: buildNextWeekSuggestionItems(state, snapshot.week, snapshot.nextWeekSuggestions),
    suggestionDecisions: state.weeklyReportSuggestionDecisions.filter((item) => item.week === snapshot.week),
    recommendationOutcomes: buildRecommendationOutcomes(state, snapshot.week)
  };
}

function shouldRefreshWeeklyReportSnapshot(snapshot: WeeklyReportSnapshot, report: BuiltWeeklyReport) {
  const hasNewPublishRecord = report.publishRecords.some((record) => !snapshot.publishRecords.some((item) => item.id === record.id));
  const hasNewBlogDiagnostic = report.blogDiagnostics.some((article) => !snapshot.blogDiagnostics.some((item) => item.id === article.id));
  const hasNewGeoResult = report.geoResults.some((result) => !snapshot.geoResults.some((item) => item.id === result.id));

  return (
    hasNewPublishRecord ||
    hasNewBlogDiagnostic ||
    hasNewGeoResult ||
    report.targetTotalCount > snapshot.targetTotalCount ||
    report.planQualityFeedback.signals.length > snapshot.planQualityFeedback.signals.length
  );
}

export function getWeeklyReport(week: string) {
  const state = readWorkbenchState();
  const existingSnapshot = state.weeklyReportSnapshots.find((item) => item.week === week);

  if (existingSnapshot) {
    const report = buildWeeklyReportFromState(state, week);

    if (shouldRefreshWeeklyReportSnapshot(existingSnapshot, report)) {
      const snapshot = createWeeklyReportSnapshot(report);
      state.weeklyReportSnapshots = [snapshot, ...state.weeklyReportSnapshots.filter((item) => item.week !== week)].slice(0, 104);
      saveWithEvent(state, "weekly_report_snapshot_refreshed", `Refreshed weekly report snapshot for ${week}.`);

      return hydrateWeeklyReportSnapshot(state, snapshot);
    }

    return hydrateWeeklyReportSnapshot(state, existingSnapshot);
  }

  const report = buildWeeklyReportFromState(state, week);
  const snapshot = createWeeklyReportSnapshot(report);
  state.weeklyReportSnapshots = [snapshot, ...state.weeklyReportSnapshots.filter((item) => item.week !== week)].slice(0, 104);
  saveWithEvent(state, "weekly_report_snapshot_created", `Created weekly report snapshot for ${week}.`);

  return hydrateWeeklyReportSnapshot(state, snapshot);
}

type WeeklyReportResponse = ReturnType<typeof getWeeklyReport>;

export function filterWeeklyReportForRole(report: WeeklyReportResponse, role: WorkspaceRole) {
  if (canViewAiGovernance(role)) {
    return report;
  }

  const {
    promptTemplates: _promptTemplates,
    suggestionDecisions: _suggestionDecisions,
    recommendationOutcomes: _recommendationOutcomes,
    planQualityFeedback: _planQualityFeedback,
    ...businessReport
  } = report;

  return businessReport;
}

export function getWeeklyReportForRole(week: string, role: WorkspaceRole) {
  return filterWeeklyReportForRole(getWeeklyReport(week), role);
}

export function createNextWeeklyPlanFromReport(week: string, input: Record<string, unknown> = {}) {
  const sourceReport = getWeeklyReport(week);
  const state = readWorkbenchState();
  const template = getActivePromptVersion(state, "weekly_plan_generation");
  const nextWeekStart = typeof input.weekStart === "string" && input.weekStart.trim() ? input.weekStart.trim() : addDays(week, 7);
  const days = clampNumber(input.days, state.workspaceSetting.defaultWeeklyDays, 1, 7);
  const dailyCount = clampNumber(input.dailyCount, state.workspaceSetting.defaultDailyCount, 1, 10);
  const channels = coerceChannels(input.channels) || state.workspaceSetting.enabledChannels;
  const products = coerceProducts(input.products) || state.workspaceSetting.enabledProducts;
  const suggestions = sourceReport.nextWeekSuggestions.length
    ? sourceReport.nextWeekSuggestions
    : ["延续本周表现稳定的主题，并优先补强 GEO 未命中内容。"];
  const tasks: ContentTask[] = [];

  for (let day = 0; day < days; day += 1) {
    for (let count = 0; count < dailyCount; count += 1) {
      const index = tasks.length;
      const channel = channels[index % channels.length];
      const product = products[index % products.length];
      const contentType = coerceContentType(index);
      const suggestion = suggestions[index % suggestions.length];
      const businessSignal: WeeklyPlanTaskSignal = {
        key: "weekly_report",
        label: "周报建议",
        sourceProblem: suggestion,
        summary: `来自周报建议：${suggestion}`,
        referenceId: createWeeklySuggestionId(week, index % suggestions.length)
      };
      const planContext = buildTaskPlanContext(product, contentType, suggestion);

      const task: ContentTask = {
        id: createId("task"),
        weeklyPlanId: `wp-${nextWeekStart}`,
        publishDate: addDays(nextWeekStart, day),
        channel,
        product,
        title: buildTaskTitle(index, contentType),
        contentType,
        targetKeywords: [...buildTaskKeywords(product, contentType), "周报建议"],
        primaryDistilledTerm: planContext.primaryDistilledTerm,
        sourceProblem: planContext.sourceProblem,
        officialLinkTarget: planContext.officialLinkTarget,
        titleReason: planContext.reason,
        riskNote: planContext.riskNote,
        evidenceNeed: planContext.evidenceNeed,
        confidence: planContext.confidence,
        status: "planned",
        qaSummary: `来源周报 ${week}：${suggestion}；${template.name} ${template.version}。`
      };
      task.titleSourceAttributions = buildContentTaskTitleSourceAttributions(state, task, {
        businessSignal,
        promptVersion: template.version
      });
      tasks.push(task);
    }
  }

  const nextWeeklyPlanId = `wp-${nextWeekStart}`;
  state.weeklyPlan = {
    id: nextWeeklyPlanId,
    weekStart: nextWeekStart,
    weekEnd: addDays(nextWeekStart, 6),
    targetTotalCount: tasks.length,
    status: "draft",
    generationSource: buildWeeklyPlanGenerationSource(state, template, [])
  };
  state.tasks = [
    ...state.tasks.filter((task) => task.weeklyPlanId !== nextWeeklyPlanId && !isDateInWeek(task.publishDate, nextWeekStart)),
    ...tasks
  ];

  saveWithEvent(state, "next_week_plan_created_from_report", `Created ${tasks.length} planned tasks from weekly report ${week}.`);

  return {
    ok: true,
    status: "success" as const,
    message: `已根据 ${week} 周报生成下周计划草稿。`,
    data: {
      sourceWeek: week,
      weeklyPlan: state.weeklyPlan,
      tasks,
      suggestions
    }
  };
}

export function decideWeeklyReportSuggestion(
  week: string,
  suggestionId: string,
  input: Record<string, unknown>
): WorkflowResult<{ decision: WeeklyReportSuggestionDecision; report: ReturnType<typeof getWeeklyReport> }> {
  const state = readWorkbenchState();
  const status = input.status;

  if (status !== "adopted" && status !== "partially_adopted" && status !== "rejected") {
    return {
      ok: false,
      status: "failed",
      message: "请提供有效的建议处理状态：adopted / partially_adopted / rejected。"
    };
  }

  const report = getWeeklyReport(week);
  const suggestionItem = report.nextWeekSuggestionItems.find((item) => item.id === suggestionId);

  if (!suggestionItem) {
    return {
      ok: false,
      status: "failed",
      message: `未找到周报建议：${suggestionId}`
    };
  }

  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined;
  const decision: WeeklyReportSuggestionDecision = {
    id: suggestionId,
    week,
    suggestion: suggestionItem.suggestion,
    status,
    reason,
    decidedAt: nowIso()
  };

  state.weeklyReportSuggestionDecisions = [
    decision,
    ...state.weeklyReportSuggestionDecisions.filter((item) => item.id !== suggestionId)
  ].slice(0, 200);
  saveWithEvent(state, "weekly_report_suggestion_decided", `Suggestion ${suggestionId} marked as ${status}.`);

  return {
    ok: true,
    status: "success",
    message: status === "adopted" ? "建议已采纳。" : status === "partially_adopted" ? "建议已标记为部分采纳。" : "建议已拒绝。",
    data: {
      decision,
      report: getWeeklyReport(week)
    }
  };
}

export function extractDistilledTermFromQuestion(input: Record<string, unknown>): WorkflowResult<{ term?: DistilledTerm; ruleDraft?: DistilledTermRuleDraft; discarded?: boolean; confidence: number }> {
  const question = typeof input.question === "string" ? input.question.trim() : "";

  if (!question) {
    return {
      ok: false,
      status: "pending_input",
      message: "请先输入一个真实搜索问题。"
    };
  }

  const state = readWorkbenchState();
  const candidate = extractDistilledTermCandidate(question, state.distilledTermExtractionRules);
  const confidence = Math.min(Math.max(candidate.confidence, 0), 1);

  if (confidence < 0.65) {
    if (candidate.draft) {
      const ruleDraft = upsertDistilledTermRuleDraft(state, candidate.draft);
      saveWithEvent(state, "distilled_term_rule_draft_created", `Created distilled term rule draft ${ruleDraft.id} from search question.`);

      return {
        ok: true,
        status: "success",
        message: `已生成待确认规则建议「${ruleDraft.ruleName}」，确认后同类问题可自动入池。`,
        data: {
          ruleDraft,
          confidence
        }
      };
    }

    saveWithEvent(state, "distilled_term_candidate_discarded", `Discarded low-confidence distilled term candidate from question.`);

    return {
      ok: true,
      status: "success",
      message: "候选词未通过入池阈值，已按规则直接丢弃。",
      data: {
        discarded: true,
        confidence
      }
    };
  }

  const existing = state.distilledTerms.find((term) => term.term === candidate.term);

  if (existing) {
    const nextTerm: DistilledTerm = {
      ...existing,
      status: existing.status === "disabled" ? "active" : existing.status,
      validationStatus: "auto_validated",
      sourceQuestion: question,
      confidence: Math.max(existing.confidence || 0, confidence),
      generationMode: "search_question",
      level: candidate.level || existing.level,
      product: existing.product || candidate.product,
      generatedAt: nowIso()
    };
    state.distilledTerms = normalizeDistilledTerms([nextTerm, ...state.distilledTerms.filter((term) => term.id !== existing.id)]);
    saveWithEvent(state, "distilled_term_reactivated", `Reused distilled term ${nextTerm.id} from question.`);

    return {
      ok: true,
      status: "success",
      message: `蒸馏词「${nextTerm.term}」已存在，已更新来源问题和入池记录。`,
      data: {
        term: nextTerm,
        confidence
      }
    };
  }

  const term: DistilledTerm = {
    id: createId("term"),
    term: candidate.term,
    level: candidate.level || inferDistilledTermLevel(`${candidate.term} ${question}`),
    source: "搜索问题自动提取",
    sourceQuestion: question,
    product: candidate.product || inferDistilledTermProduct(`${candidate.term} ${question}`),
    confidence,
    generationMode: "search_question",
    generatedAt: nowIso(),
    validationStatus: "auto_validated",
    modelConsensusCount: confidence >= 0.75 ? 3 : 2,
    status: "active",
    coveredContentTypes: [],
    geoLift: 0,
    competitorOccupied: false
  };

  state.distilledTerms = normalizeDistilledTerms([term, ...state.distilledTerms]);
  saveWithEvent(state, "distilled_term_auto_pooled", `Auto pooled distilled term ${term.id} from search question.`);

  return {
    ok: true,
    status: "success",
    message: `已从搜索问题提取并入池蒸馏词「${term.term}」。`,
    data: {
      term,
      confidence
    }
  };
}

function normalizeAutoPoolSource(value: unknown): DistilledTermAutoPoolSource {
  return value === "knowledge_base" || value === "geo_gap" || value === "all" ? value : "all";
}

function getKnowledgeBaseDistilledTermCandidates(state: WorkbenchState): DistilledTermAutoPoolCandidate[] {
  return state.knowledgeBases.flatMap((knowledgeBase) => {
    const normalized = normalizeKnowledgeBase(knowledgeBase);
    const rulePackage = normalized.productExpressionRuleDraft;

    if (normalized.status !== "enabled" || rulePackage?.status !== "active") {
      return [];
    }

    return (rulePackage.distilledTermSuggestions || [])
      .map((term) => term.trim())
      .filter(Boolean)
      .map((term) => ({
        term,
        source: `知识库规则包：${normalized.name}`,
        sourceQuestion: `知识库资料补强：${normalized.usageScope || normalized.name}`,
        sourceAssetId: normalized.id,
        generationMode: "knowledge_base" as const,
        confidence: 0.76,
        product: inferDistilledTermProduct(`${term} ${normalized.name} ${normalized.usageScope || ""}`),
        coveredContentTypes: [],
        modelConsensusCount: 2
      }));
  });
}

function getGeoPromptGroupFallbackTerm(promptGroup: GeoTestResult["promptGroup"]) {
  if (promptGroup === "产品场景" || promptGroup === "FAQ") return "AI 护栏";
  if (promptGroup === "对比") return "企业级交付";
  return "Dify 企业版服务商";
}

function getGeoGapDistilledTermCandidates(state: WorkbenchState): DistilledTermAutoPoolCandidate[] {
  return state.geoResults
    .filter((result) => result.executionStatus !== "failed" && result.executionStatus !== "pending_config" && (!result.mentionedJoto || !result.citedOfficialUrl))
    .flatMap((result) => {
      const terms = result.distilledTermIds?.length
        ? result.distilledTermIds.map(getDistilledTermLabel)
        : [extractDistilledTermCandidate(result.prompt).confidence >= 0.65 ? extractDistilledTermCandidate(result.prompt).term : getGeoPromptGroupFallbackTerm(result.promptGroup)];

      return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean))).map((term) => ({
        term,
        source: `GEO 缺口：${result.platform} / ${result.promptGroup}`,
        sourceQuestion: result.prompt,
        sourceAssetId: result.id,
        generationMode: "geo_gap" as const,
        confidence: 0.72,
        product: inferDistilledTermProduct(`${term} ${result.prompt}`),
        coveredContentTypes: result.promptGroup === "FAQ" ? ["faq" as const] : result.promptGroup === "对比" ? ["comparison" as const] : [],
        modelConsensusCount: 2
      }));
    });
}

function upsertDistilledTermFromCandidate(state: WorkbenchState, candidate: DistilledTermAutoPoolCandidate) {
  const existing = state.distilledTerms.find((term) => term.term === candidate.term);
  const generatedAt = nowIso();

  if (existing) {
    const source = existing.source.includes(candidate.source) ? existing.source : `${existing.source}；${candidate.source}`;
    const nextTerm: DistilledTerm = {
      ...existing,
      source,
      status: existing.status === "disabled" ? "active" : existing.status,
      validationStatus: "auto_validated",
      confidence: Math.max(existing.confidence || 0, candidate.confidence),
      generationMode: existing.generationMode === "manual_seed" || !existing.generationMode ? candidate.generationMode : existing.generationMode,
      sourceQuestion: existing.sourceQuestion || candidate.sourceQuestion,
      sourceAssetId: existing.sourceAssetId || candidate.sourceAssetId,
      product: existing.product || candidate.product,
      coveredContentTypes: existing.coveredContentTypes?.length ? existing.coveredContentTypes : candidate.coveredContentTypes || [],
      modelConsensusCount: Math.max(existing.modelConsensusCount || 0, candidate.modelConsensusCount || 2),
      generatedAt
    };
    state.distilledTerms = normalizeDistilledTerms([nextTerm, ...state.distilledTerms.filter((term) => term.id !== existing.id)]);

    return { term: nextTerm, created: false };
  }

  const term: DistilledTerm = {
    id: createId("term"),
    term: candidate.term,
    level: inferDistilledTermLevel(`${candidate.term} ${candidate.sourceQuestion || ""}`),
    source: candidate.source,
    sourceQuestion: candidate.sourceQuestion,
    sourceAssetId: candidate.sourceAssetId,
    product: candidate.product,
    confidence: Math.min(Math.max(candidate.confidence, 0), 1),
    generationMode: candidate.generationMode,
    generatedAt,
    validationStatus: "auto_validated",
    modelConsensusCount: candidate.modelConsensusCount || 2,
    status: "active",
    coveredContentTypes: candidate.coveredContentTypes || [],
    geoLift: 0,
    competitorOccupied: candidate.generationMode === "geo_gap"
  };
  state.distilledTerms = normalizeDistilledTerms([term, ...state.distilledTerms]);

  return { term, created: true };
}

export function autoPoolDistilledTerms(input: Record<string, unknown>): WorkflowResult<{ terms: DistilledTerm[]; createdCount: number; reusedCount: number; skippedCount: number; source: DistilledTermAutoPoolSource }> {
  const state = readWorkbenchState();
  const source = normalizeAutoPoolSource(input.source);
  const candidates = [
    ...(source === "knowledge_base" || source === "all" ? getKnowledgeBaseDistilledTermCandidates(state) : []),
    ...(source === "geo_gap" || source === "all" ? getGeoGapDistilledTermCandidates(state) : [])
  ];
  const uniqueCandidates = candidates.filter((candidate, index, list) => list.findIndex((item) => item.term === candidate.term) === index);
  const terms: DistilledTerm[] = [];
  let createdCount = 0;
  let reusedCount = 0;

  for (const candidate of uniqueCandidates) {
    const result = upsertDistilledTermFromCandidate(state, candidate);
    terms.push(result.term);

    if (result.created) {
      createdCount += 1;
    } else {
      reusedCount += 1;
    }
  }

  saveWithEvent(state, "distilled_terms_auto_pooled", `Auto pooled ${createdCount} distilled terms from ${source}; reused ${reusedCount}.`);

  return {
    ok: true,
    status: "success",
    message: createdCount
      ? `已自动入池 ${createdCount} 个蒸馏词，复用 ${reusedCount} 个已有词。`
      : reusedCount
        ? `没有新增蒸馏词，已复用 ${reusedCount} 个已有词。`
        : "当前没有可自动入池的蒸馏词来源。",
    data: {
      terms,
      createdCount,
      reusedCount,
      skippedCount: Math.max(candidates.length - uniqueCandidates.length, 0),
      source
    }
  };
}

export function activateDistilledTermRuleDraft(id: string): WorkflowResult<{ ruleDraft: DistilledTermRuleDraft; rule: DistilledTermExtractionRule; term: DistilledTerm }> {
  const state = readWorkbenchState();
  const draft = state.distilledTermRuleDrafts.find((item) => item.id === id);

  if (!draft) {
    return {
      ok: false,
      status: "failed",
      message: `未找到规则建议：${id}`
    };
  }

  if (draft.status !== "pending") {
    return {
      ok: false,
      status: "failed",
      message: "只有待确认规则建议可以确认生效。"
    };
  }

  const activatedAt = nowIso();
  const existingRule = state.distilledTermExtractionRules.find((rule) => rule.status === "active" && rule.mappedTerm === draft.mappedTerm);
  const rule: DistilledTermExtractionRule = existingRule
    ? {
        ...existingRule,
        patterns: Array.from(new Set([...existingRule.patterns, ...draft.patterns])),
        sourceQuestions: Array.from(new Set([...(existingRule.sourceQuestions || []), ...draft.sourceQuestions])),
        confidence: Math.max(existingRule.confidence, draft.confidence),
        riskNote: existingRule.riskNote || draft.riskNote
      }
    : {
        id: createId("distilled-rule"),
        ruleName: draft.ruleName,
        mappedTerm: draft.mappedTerm,
        level: draft.level,
        product: draft.product,
        patterns: draft.patterns,
        source: "question_rule_draft",
        sourceQuestions: draft.sourceQuestions,
        riskNote: draft.riskNote,
        confidence: Math.max(draft.confidence, 0.66),
        status: "active",
        createdAt: draft.createdAt,
        activatedAt
      };

  state.distilledTermExtractionRules = normalizeDistilledTermExtractionRules([
    rule,
    ...state.distilledTermExtractionRules.filter((item) => item.id !== rule.id)
  ]);

  const termResult = upsertDistilledTermFromCandidate(state, {
    term: draft.mappedTerm,
    source: `规则建议确认：${draft.ruleName}`,
    sourceQuestion: draft.sourceQuestions[0],
    generationMode: "search_question",
    confidence: Math.max(draft.confidence, 0.66),
    product: draft.product,
    coveredContentTypes: [],
    modelConsensusCount: 2
  });
  const activatedDraft: DistilledTermRuleDraft = {
    ...draft,
    status: "active",
    activatedAt,
    activatedRuleId: rule.id
  };
  state.distilledTermRuleDrafts = normalizeDistilledTermRuleDrafts(state.distilledTermRuleDrafts.map((item) => (item.id === id ? activatedDraft : item)));
  saveWithEvent(state, "distilled_term_rule_draft_activated", `Activated distilled term rule draft ${id}.`);

  return {
    ok: true,
    status: "success",
    message: `规则建议「${draft.ruleName}」已生效，并已同步蒸馏词「${termResult.term.term}」。`,
    data: {
      ruleDraft: activatedDraft,
      rule,
      term: termResult.term
    }
  };
}

export function discardDistilledTermRuleDraft(id: string): WorkflowResult<{ ruleDraft: DistilledTermRuleDraft }> {
  const state = readWorkbenchState();
  const draft = state.distilledTermRuleDrafts.find((item) => item.id === id);

  if (!draft) {
    return {
      ok: false,
      status: "failed",
      message: `未找到规则建议：${id}`
    };
  }

  if (draft.status !== "pending") {
    return {
      ok: false,
      status: "failed",
      message: "只有待确认规则建议可以放弃。"
    };
  }

  const discardedDraft: DistilledTermRuleDraft = {
    ...draft,
    status: "discarded",
    discardedAt: nowIso()
  };
  state.distilledTermRuleDrafts = normalizeDistilledTermRuleDrafts(state.distilledTermRuleDrafts.map((item) => (item.id === id ? discardedDraft : item)));
  saveWithEvent(state, "distilled_term_rule_draft_discarded", `Discarded distilled term rule draft ${id}.`);

  return {
    ok: true,
    status: "success",
    message: `规则建议「${draft.ruleName}」已放弃。`,
    data: {
      ruleDraft: discardedDraft
    }
  };
}

export function archiveDistilledTerm(id: string): WorkflowResult<{ term: DistilledTerm }> {
  const state = readWorkbenchState();
  const term = state.distilledTerms.find((item) => item.id === id);

  if (!term) {
    return {
      ok: false,
      status: "failed",
      message: `未找到蒸馏词：${id}`
    };
  }

  const archivedTerm: DistilledTerm = {
    ...term,
    status: "watching",
    archivedAt: nowIso()
  };

  state.distilledTerms = state.distilledTerms.map((item) => (item.id === id ? archivedTerm : item));
  saveWithEvent(state, "distilled_term_archived", `Archived distilled term ${id}.`);

  return {
    ok: true,
    status: "success",
    message: `蒸馏词「${archivedTerm.term}」已归档为观察状态。`,
    data: {
      term: archivedTerm
    }
  };
}

export function deleteDistilledTerm(id: string): WorkflowResult<{ term: DistilledTerm }> {
  const state = readWorkbenchState();
  const term = state.distilledTerms.find((item) => item.id === id);

  if (!term) {
    return {
      ok: false,
      status: "failed",
      message: `未找到蒸馏词：${id}`
    };
  }

  const disabledTerm: DistilledTerm = {
    ...term,
    status: "disabled",
    validationStatus: "disabled",
    archivedAt: nowIso()
  };

  state.distilledTerms = state.distilledTerms.map((item) => (item.id === id ? disabledTerm : item));
  saveWithEvent(state, "distilled_term_deleted", `Deleted distilled term ${id}.`);

  return {
    ok: true,
    status: "success",
    message: `蒸馏词「${disabledTerm.term}」已删除。`,
    data: {
      term: disabledTerm
    }
  };
}

function getGeoBusinessDiagnosis(result: GeoTestResult) {
  const executionStatus = result.executionStatus || "success";

  if (executionStatus === "pending_config") {
    return "模型配置未就绪，当前结果不能用于业务判断。";
  }

  if (executionStatus === "failed") {
    return result.errorMessage || "GEO 测试执行失败，需要先排查模型调用或网络配置。";
  }

  if (!result.mentionedJoto) {
    return "AI 回答没有提到 JOTO，说明当前问题下品牌认知入口不足。";
  }

  if (!result.citedOfficialUrl) {
    return "AI 回答提到了 JOTO，但没有引用官网，需要补强官方信源。";
  }

  if (result.competitorAppeared) {
    return "AI 回答已提到我们并引用官网，但竞品仍在同一答案中占位，需要继续观察竞争表达。";
  }

  return "品牌提及和官网引用较稳定，后续继续观察波动。";
}

function getGeoBusinessNextAction(result: GeoTestResult) {
  const executionStatus = result.executionStatus || "success";

  if (executionStatus === "pending_config") {
    return "先联系工作台运营补齐模型配置，再重跑该平台和问题组。";
  }

  if (executionStatus === "failed") {
    return "先排查失败原因，确认模型可用后重跑；必要时人工修正判断字段。";
  }

  if (!result.mentionedJoto) {
    return "转为周计划补强任务，或进入博客候选池补内容入口。";
  }

  if (!result.citedOfficialUrl) {
    return "补知识库或官网内容证据，再安排渠道内容引导官网引用。";
  }

  if (result.competitorAppeared) {
    return "在下次周计划中增加对比、选型和可信证据类内容。";
  }

  return "暂不新增动作，进入周报持续观察。";
}

export function exportGeoResultBusinessMarkdown(id: string) {
  const state = readWorkbenchState();
  const result = state.geoResults.find((item) => item.id === id);

  if (!result) {
    return {
      ok: false,
      status: "failed" as const,
      message: `未找到 GEO 测试结果：${id}`
    };
  }

  const exportedAt = nowIso();
  const citationLevel = getGeoCitationLevel(result);
  const businessResult = {
    id: result.id,
    platform: result.platform,
    promptGroup: result.promptGroup,
    prompt: result.prompt,
    brandVisibility: result.mentionedJoto ? "AI 提到了 JOTO" : "AI 没提到 JOTO",
    productVisibility: result.mentionedWeike ? "产品被正确提到" : "产品未被提到",
    officialSource: result.citedOfficialUrl ? "官网被引用" : "官网未被引用",
    citationLevel,
    competitorStatus: result.competitorAppeared ? "竞品出现" : "未明显占位",
    diagnosis: getGeoBusinessDiagnosis(result),
    nextAction: getGeoBusinessNextAction(result),
    exportedAt
  };
  const markdown = [
    `# GEO 业务详情 - ${result.platform}`,
    "",
    "## 1. 测试对象",
    "",
    `- 平台：${result.platform}`,
    `- 问题组：${result.promptGroup}`,
    `- 用户问题：${result.prompt}`,
    "",
    "## 2. 业务判断",
    "",
    `- 品牌可见：${businessResult.brandVisibility}`,
    `- 产品可见：${businessResult.productVisibility}`,
    `- 官网信源：${businessResult.officialSource}`,
    `- 引用层级：${citationLevel}`,
    `- 竞品占位：${businessResult.competitorStatus}`,
    "",
    "## 3. 问题结论",
    "",
    businessResult.diagnosis,
    "",
    "## 4. 下一步动作",
    "",
    businessResult.nextAction,
    "",
    "## 5. 导出说明",
    "",
    `- 导出时间：${exportedAt}`,
    "- 本导出只包含业务判断和问题缺口，不包含原始回答、原始引用链接、引用排名、模型调用轨迹或完整内部提问模板。"
  ].join("\n");

  return {
    ok: true,
    status: "success" as const,
    message: "GEO 业务详情 Markdown 已导出。",
    data: {
      id,
      format: "markdown",
      markdown,
      businessResult,
      exportedAt
    }
  };
}

function markdownCell(value: unknown) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function boolLabel(value: boolean) {
  return value ? "是" : "否";
}

function createWeeklySuggestionId(week: string, index: number) {
  return `weekly-suggestion-${week}-${index + 1}`;
}

function buildNextWeekSuggestionItems(state: Pick<WorkbenchState, "weeklyReportSuggestionDecisions">, week: string, suggestions: string[]) {
  return suggestions.map((suggestion, index) => {
    const id = createWeeklySuggestionId(week, index);
    const decision = state.weeklyReportSuggestionDecisions.find((item) => item.id === id);

    return {
      id,
      suggestion,
      decisionStatus: decision?.status,
      decisionReason: decision?.reason,
      decidedAt: decision?.decidedAt
    };
  });
}

function formatChannelMetrics(record: PublishRecord) {
  if (!record.channelMetrics) {
    return "-";
  }

  const metrics = record.channelMetrics;
  return [
    `展现 ${metrics.impressions ?? 0}`,
    `阅读 ${metrics.views ?? 0}`,
    `点赞 ${metrics.likes ?? 0}`,
    `收藏 ${metrics.favorites ?? 0}`,
    `评论 ${metrics.comments ?? 0}`,
    `转发 ${metrics.shares ?? 0}`
  ].join(" / ");
}

export function exportWeeklyReportMarkdown(week: string) {
  const report = getWeeklyReport(week);
  const exportedAt = nowIso();
  const publishRows = report.publishRecords.length
    ? report.publishRecords.map((record) =>
        [
          markdownCell(channelLabels[record.channel]),
          markdownCell(record.title),
          markdownCell(record.publishStatus),
          markdownCell(record.publishedUrl),
          markdownCell(formatChannelMetrics(record))
        ].join(" | ")
      )
    : ["- | - | - | - | -"];
  const blogRows = report.blogDiagnostics.length
    ? report.blogDiagnostics.map((article) =>
        [
          markdownCell(article.title),
          markdownCell(article.indexedStatus),
          markdownCell(article.seoIssueCount),
          markdownCell(article.geoResult),
          markdownCell(article.candidateStatus || "none")
        ].join(" | ")
      )
    : ["- | - | - | - | -"];
  const geoRows = report.geoResults.length
    ? report.geoResults.map((result) =>
        [
          markdownCell(result.platform),
          markdownCell(result.prompt),
          markdownCell(boolLabel(result.mentionedJoto)),
          markdownCell(boolLabel(result.mentionedWeike)),
          markdownCell(boolLabel(result.citedOfficialUrl)),
          markdownCell(result.executionStatus || "success")
        ].join(" | ")
      )
    : ["- | - | - | - | - | -"];
  const suggestionRows = report.nextWeekSuggestions.map((item, index) => `${index + 1}. ${item}`);
  let sectionIndex = 1;
  const markdownParts = [
    `# JOTO GTM 周报 - ${report.week}`,
    "",
    `## ${sectionIndex++}. 管理层摘要`,
    "",
    report.executiveSummary,
    "",
    `## ${sectionIndex++}. 渠道执行复盘`,
    "",
    "| 渠道 | 标题 | 状态 | URL | 指标 |",
    "|---|---|---|---|---|",
    ...publishRows,
    ""
  ];

  if (report.blogDiagnostics.length) {
    markdownParts.push(
      `## ${sectionIndex++}. 官网博客诊断`,
      "",
      "| 标题 | 索引状态 | SEO 问题数 | GEO 结果 | 候选状态 |",
      "|---|---|---|---|---|",
      ...blogRows,
      ""
    );
  }

  if (report.geoResults.length) {
    markdownParts.push(
      `## ${sectionIndex++}. GEO 测试概览`,
      "",
      "| 平台 | 用户问题 | 提及 JOTO | 提及唯客 | 引用官网 | 执行状态 |",
      "|---|---|---|---|---|---|",
      ...geoRows,
      ""
    );
  }

  markdownParts.push(
    `## ${sectionIndex++}. 下周建议`,
    "",
    ...suggestionRows,
    "",
    `## ${sectionIndex++}. 数据说明`,
    "",
    `- 数据来源：${report.dataSource}`,
    `- 导出时间：${exportedAt}`,
    "- Demo / imported / real 数据需要按页面标签区分，不要把 Demo 指标当作正式策略判断。"
  );
  const markdown = markdownParts.join("\n");

  return {
    ok: true,
    status: "success" as const,
    message: "周报 Markdown 已导出。",
    data: {
      week,
      format: "markdown",
      markdown,
      report,
      exportedAt
    }
  };
}
