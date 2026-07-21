import {
  blogArticles as seedBlogArticles,
  botVisits as seedBotVisits,
  drafts as seedDrafts,
  knowledgeBases as seedKnowledgeBases,
  publishRecords as seedPublishRecords,
  tasks as seedTasks,
  monthlyPlan as seedMonthlyPlan
} from "./demo-data";
import { callAiProvider, type AiProviderKey } from "./ai-provider";
import { loadBlogArticles } from "./blog-sync-adapter";
import { importChannelMetrics } from "./channel-metrics-adapter";
import { channelLabels, productLabels } from "./labels";
import { parseBotLogInput } from "./log-import-adapter";
import { getWorkbenchRepository } from "./repositories";
import type {
  ArticleDraft,
  BlogArticle,
  BotVisitSummary,
  ChannelKey,
  ContentTask,
  ContentType,
  KnowledgeBase,
  LogMode,
  ProductKey,
  PublishRecord,
  TaskStatus,
  WorkspaceSetting,
  MonthlyPlan
} from "./types";

export interface WorkbenchAuditEvent {
  id: string;
  event: string;
  message: string;
  createdAt: string;
}

export interface PipelineStepResult {
  name: "sync_blog" | "import_log" | "import_channel_metrics" | "read_monthly_report";
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
  month: string;
  summary?: ReturnType<typeof getDashboardSummary>;
}

export interface WorkbenchState {
  runtime: {
    storage: "local_json";
    statePath: string;
    initializedAt: string;
  };
  monthlyPlan: MonthlyPlan;
  workspaceSetting: WorkspaceSetting;
  tasks: ContentTask[];
  drafts: ArticleDraft[];
  publishRecords: PublishRecord[];
  blogArticles: BlogArticle[];
  botVisits: BotVisitSummary[];
  knowledgeBases: KnowledgeBase[];
  pipelineRuns: PipelineRunRecord[];
  auditLog: WorkbenchAuditEvent[];
}

interface GenerateMonthlyPlanInput {
  monthStart?: string;
  monthEnd?: string;
  days?: number;
  dailyCount?: number;
  channels?: ChannelKey[];
  products?: ProductKey[];
}

interface RunPipelineInput {
  skipBlog?: boolean;
  skipLog?: boolean;
  skipChannelMetrics?: boolean;
  month?: string;
  blog?: Record<string, unknown>;
  log?: Record<string, unknown>;
  channelMetrics?: Record<string, unknown>;
}

interface SaveWorkspaceSettingInput {
  defaultPublishDays?: number;
  defaultDailyCount?: number;
  enabledChannels?: ChannelKey[];
  enabledProducts?: ProductKey[];
  finalReviewMode?: WorkspaceSetting["finalReviewMode"];
  logMode?: LogMode;
}

type KnowledgeBaseType = KnowledgeBase["type"];
type KnowledgeBaseTrustLevel = KnowledgeBase["trustLevel"];
type KnowledgeBaseStatus = KnowledgeBase["status"];

interface WorkflowResult<T> {
  ok: boolean;
  status: "success" | "pending_config" | "pending_input" | "failed";
  message: string;
  data?: T;
  missingConfig?: string[];
}

const statePath = process.env.WORKBENCH_STATE_PATH || "data/workbench-state.json";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createInitialWorkspaceSetting(): WorkspaceSetting {
  return {
    id: "workspace-setting-default",
    defaultPublishDays: 5,
    defaultDailyCount: 3,
    enabledChannels: ["wechat", "csdn", "juejin", "zhihu_toutiao_general"],
    enabledProducts: ["joto_brand", "weike_guardrails"],
    finalReviewMode: "default_final",
    logMode: "demo_csv",
    updatedAt: nowIso()
  };
}

export function createInitialWorkbenchState(): WorkbenchState {
  const createdAt = nowIso();

  return {
    runtime: {
      storage: "local_json",
      statePath,
      initializedAt: createdAt
    },
    monthlyPlan: clone(seedMonthlyPlan),
    workspaceSetting: createInitialWorkspaceSetting(),
    tasks: clone(seedTasks),
    drafts: clone(seedDrafts),
    publishRecords: clone(seedPublishRecords),
    blogArticles: clone(seedBlogArticles),
    botVisits: clone(seedBotVisits),
    knowledgeBases: clone(seedKnowledgeBases),
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
  const sanitizedValue = { ...value } as Partial<WorkbenchState> & Record<string, unknown>;
  const sanitizedSetting = { ...(value.workspaceSetting || {}) } as Partial<WorkspaceSetting> & Record<string, unknown>;
  const legacyResultKey = ["geo", "Results"].join("");
  const legacyPlatformKey = ["geo", "Platforms"].join("");
  const legacyPipelineStep = ["run", "geo", "tests"].join("_");

  delete sanitizedValue[legacyResultKey];
  delete sanitizedSetting[legacyPlatformKey];

  const rawMonthlyPlan = value.monthlyPlan || base.monthlyPlan;
  const normalizedMonthStart = getMonthStart(
    typeof rawMonthlyPlan.monthStart === "string" ? rawMonthlyPlan.monthStart : base.monthlyPlan.monthStart
  );
  const normalizedMonthlyPlan: MonthlyPlan = {
    ...base.monthlyPlan,
    ...rawMonthlyPlan,
    id: rawMonthlyPlan.id?.startsWith("mp-") ? rawMonthlyPlan.id : `mp-${normalizedMonthStart}`,
    monthStart: normalizedMonthStart,
    monthEnd: getMonthEnd(normalizedMonthStart)
  };

  return {
    ...base,
    ...sanitizedValue,
    runtime: {
      ...base.runtime,
      ...(value.runtime || {}),
      storage: "local_json",
      statePath
    },
    monthlyPlan: normalizedMonthlyPlan,
    workspaceSetting: value.workspaceSetting ? { ...base.workspaceSetting, ...sanitizedSetting } : base.workspaceSetting,
    tasks: (value.tasks || base.tasks).map((task) => ({
      ...task,
      monthlyPlanId: task.monthlyPlanId?.startsWith("mp-") ? task.monthlyPlanId : normalizedMonthlyPlan.id
    })),
    drafts: value.drafts || base.drafts,
    publishRecords: value.publishRecords || base.publishRecords,
    blogArticles: (value.blogArticles || base.blogArticles).filter((article) => !article.url.startsWith("geo://result/")),
    botVisits: value.botVisits || base.botVisits,
    knowledgeBases: value.knowledgeBases || base.knowledgeBases,
    pipelineRuns: (value.pipelineRuns || base.pipelineRuns).map((run) => ({
      ...run,
      month: run.month || normalizedMonthStart,
      steps: run.steps.filter((step) => (step.name as string) !== legacyPipelineStep)
    })),
    auditLog: value.auditLog || base.auditLog
  };
}

export function readWorkbenchState(): WorkbenchState {
  return getWorkbenchRepository(createInitialWorkbenchState, normalizeWorkbenchState).read();
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
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function getMonthEnd(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function getMonthStart(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}

function getNextMonthStart(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return date.toISOString().slice(0, 10);
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

function coerceProducts(value: unknown): ProductKey[] | undefined {
  const allowed: ProductKey[] = ["joto_brand", "weike_guardrails"];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const products = value.filter((item): item is ProductKey => allowed.includes(item as ProductKey));
  return products.length ? products : undefined;
}

function coerceKnowledgeBaseType(value: unknown, fallback: KnowledgeBaseType): KnowledgeBaseType {
  const allowed: KnowledgeBaseType[] = ["brand", "product", "official_blog", "channel_history", "competitor", "source_site"];
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

function coerceContentType(value: number): ContentType {
  const types: ContentType[] = ["brand", "scenario", "technical", "faq", "comparison", "case"];
  return types[value % types.length];
}

function buildTaskTitle(index: number, channel: ChannelKey, product: ProductKey, contentType: ContentType) {
  const productName = productLabels[product];
  const channelName = channelLabels[channel];
  const titleSeeds: Record<ContentType, string> = {
    brand: "为什么企业选择服务商时要先看长期交付能力",
    scenario: "企业把大模型接入业务流程前，需要先确认哪些风险",
    technical: "从工程角度看 AI 护栏应该放在系统的哪个位置",
    faq: "企业接入 Dify 后还需要 AI 安全护栏吗",
    comparison: "只靠提示词和接入专业护栏的差别在哪里",
    case: "一个内容团队如何用 AI 护栏降低发布风险"
  };

  return `${titleSeeds[contentType]}：${productName} ${channelName}选题 ${index + 1}`;
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

function buildRegeneratedTaskTitle(task: ContentTask) {
  const typeLabel = {
    brand: "品牌认知补强",
    scenario: "业务场景拆解",
    technical: "工程落地解释",
    faq: "常见问题回答",
    comparison: "方案差异判断",
    case: "实践案例复盘"
  } satisfies Record<ContentType, string>;
  const productName = productLabels[task.product];
  const channelName = channelLabels[task.channel];

  return `${productName} ${typeLabel[task.contentType]}：${channelName} 选题 ${Date.now().toString().slice(-4)}`;
}

function runDraftQa(task: ContentTask, content: string) {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (task.product === "joto_brand" && !content.includes("JOTO")) {
    warnings.push("正文缺少 JOTO 品牌词");
  }

  if (task.product === "weike_guardrails" && !content.includes("唯客")) {
    warnings.push("正文缺少唯客产品词");
  }

  if (!content.includes("jotoai.com")) {
    warnings.push("建议补充官网链接");
  }

  if (/最强|绝对领先|永久免费|100%/.test(content)) {
    blockers.push("存在敏感或夸大表达");
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings
  };
}

function createLocalDraft(
  task: ContentTask,
  existingDraft?: ArticleDraft,
  options: { provider?: string; model?: string; status?: "success" | "pending_config" | "failed" } = {}
): ArticleDraft {
  const channelName = channelLabels[task.channel];
  const productName = productLabels[task.product];
  const content = [
    `很多团队在做 ${productName} 相关内容时，容易先从功能点出发，最后写成一篇没有判断的说明文。`,
    `这篇 ${channelName} 文章应该先回答一个真实问题：${task.title}。`,
    `如果把它放回 JOTO 当前的 GTM 工作流里看，内容的作用不是堆关键词，而是帮助读者理解企业接入 AI 能力时需要哪些交付、治理和安全边界。`,
    task.product === "weike_guardrails"
      ? "唯客 AI 护栏适合承担输出安全、风险识别和审计留痕这类稳定治理工作。"
      : "JOTO 的价值应该放在企业级交付、长期运维和 AI 应用治理的完整链路里理解。",
    `后续发布时建议补充官网链接：https://jotoai.com，并根据 ${channelName} 的阅读习惯调整标题和段落密度。`
  ].join("\n\n");
  const qaResult = runDraftQa(task, content);

  return {
    id: existingDraft?.id || createId("draft"),
    taskId: task.id,
    title: task.title,
    summary: `围绕「${task.title}」生成的本地规则稿，后续可切换为真实 AI Provider。`,
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

async function createDraftWithProviderFallback(task: ContentTask, existingDraft?: ArticleDraft) {
  const provider = getContentProviderKey();
  const aiResult = await callAiProvider({
    provider,
    systemPrompt:
      "你是 JOTO GTM 内容工作台的内容生成 Worker。只输出可发布正文，不要输出解释。写作要克制、具体、避免夸大承诺。",
    userPrompt: [
      `渠道：${channelLabels[task.channel]}`,
      `产品：${productLabels[task.product]}`,
      `标题：${task.title}`,
      `内容类型：${task.contentType}`,
      `目标关键词：${task.targetKeywords.join("、")}`,
      "请生成一篇适合该渠道的中文文章，保留真实问题意识，并自然提及 JOTO 或唯客。"
    ].join("\n"),
    temperature: 0.4
  });

  if (aiResult.ok && aiResult.content) {
    const qaResult = runDraftQa(task, aiResult.content);

    return {
      id: existingDraft?.id || createId("draft"),
      taskId: task.id,
      title: task.title,
      summary: `由 ${aiResult.provider} / ${aiResult.model || "unknown model"} 生成的渠道稿。`,
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
        status: "success" as const
      },
      updatedAt: nowIso()
    };
  }

  return createLocalDraft(task, existingDraft, {
    provider: aiResult.provider,
    model: aiResult.model,
    status: aiResult.status
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
  const generated = state.tasks.filter((task) =>
    ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)
  ).length;
  const approved = state.tasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = state.publishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = state.publishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    monthlyPlan: state.monthlyPlan,
    metrics: {
      targetTotal: state.monthlyPlan.targetTotalCount,
      generated,
      approved,
      published,
      pendingUrl,
      aiBotPv: state.botVisits.reduce((sum, item) => sum + item.pv, 0)
    },
    dataSource: state.runtime.storage
  };
}

export function generateMonthlyPlan(input: GenerateMonthlyPlanInput = {}) {
  const state = readWorkbenchState();
  const days = clampNumber(input.days, 20, 1, 31);
  const dailyCount = clampNumber(input.dailyCount, 3, 1, 10);
  const channels: ChannelKey[] = input.channels?.length ? input.channels : ["wechat", "csdn", "juejin", "zhihu_toutiao_general"];
  const products: ProductKey[] = input.products?.length ? input.products : ["joto_brand", "weike_guardrails"];
  const monthStart = getMonthStart(input.monthStart || state.monthlyPlan.monthStart);
  const monthEnd = input.monthEnd || getMonthEnd(monthStart);
  const targetTotalCount = days * dailyCount;
  const tasks: ContentTask[] = [];

  for (let day = 0; day < days; day += 1) {
    for (let count = 0; count < dailyCount; count += 1) {
      const index = tasks.length;
      const channel = channels[index % channels.length];
      const product = products[index % products.length];
      const contentType = coerceContentType(index);
      tasks.push({
        id: createId("task"),
        monthlyPlanId: `mp-${monthStart}`,
        publishDate: addDays(monthStart, day),
        channel,
        product,
        title: buildTaskTitle(index, channel, product, contentType),
        contentType,
        targetKeywords: buildTaskKeywords(product, contentType),
        status: "planned"
      });
    }
  }

  state.monthlyPlan = {
    id: `mp-${monthStart}`,
    monthStart,
    monthEnd,
    targetTotalCount,
    status: "draft"
  };
  state.tasks = tasks;
  state.drafts = [];
  state.publishRecords = [];

  saveWithEvent(state, "monthly_plan_generated", `Generated ${tasks.length} local-rule content tasks.`);

  return {
    monthlyPlan: state.monthlyPlan,
    tasks
  };
}

export function patchMonthlyPlan(id: string, input: Record<string, unknown>) {
  const state = readWorkbenchState();
  const channels = coerceChannels(input.channels);
  const products = coerceProducts(input.products);

  state.monthlyPlan = {
    ...state.monthlyPlan,
    id,
    monthStart: typeof input.monthStart === "string" ? getMonthStart(input.monthStart) : state.monthlyPlan.monthStart,
    monthEnd:
      typeof input.monthEnd === "string"
        ? getMonthEnd(input.monthEnd)
        : typeof input.monthStart === "string"
          ? getMonthEnd(input.monthStart)
          : state.monthlyPlan.monthEnd,
    targetTotalCount: clampNumber(input.targetTotalCount, state.monthlyPlan.targetTotalCount, 1, 200),
    status: typeof input.status === "string" ? (input.status as MonthlyPlan["status"]) : state.monthlyPlan.status
  };

  if (channels || products) {
    state.tasks = state.tasks.map((task, index) => ({
      ...task,
      channel: channels ? channels[index % channels.length] : task.channel,
      product: products ? products[index % products.length] : task.product
    }));
  }

  saveWithEvent(state, "monthly_plan_updated", `Updated monthly plan ${id}.`);

  return {
    monthlyPlan: state.monthlyPlan,
    tasks: state.tasks
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
  const task: ContentTask = {
    ...current,
    publishDate: typeof input.publishDate === "string" && input.publishDate.trim() ? input.publishDate.trim() : current.publishDate,
    channel: channels?.[0] || current.channel,
    product: products?.[0] || current.product,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : current.title,
    contentType: nextContentType,
    targetKeywords: Array.isArray(input.targetKeywords)
      ? input.targetKeywords.map(String).map((item) => item.trim()).filter(Boolean)
      : typeof input.targetKeywords === "string"
        ? input.targetKeywords.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
        : current.targetKeywords,
    status: typeof input.status === "string" ? (input.status as TaskStatus) : current.status
  };

  state.tasks[taskIndex] = task;
  saveWithEvent(state, "content_task_updated", `Updated content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "内容任务已保存到本地持久化状态。",
    data: { task }
  };
}

export function confirmContentTasks(input: Record<string, unknown> = {}): WorkflowResult<{ confirmed: number; tasks: ContentTask[] }> {
  const state = readWorkbenchState();
  const requestedIds = Array.isArray(input.taskIds) ? input.taskIds.map(String).filter(Boolean) : undefined;
  const nextTasks: ContentTask[] = state.tasks.map((task) => {
    const shouldConfirm = requestedIds?.length ? requestedIds.includes(task.id) : task.status === "planned";

    if (!shouldConfirm || task.status !== "planned") {
      return task;
    }

    return {
      ...task,
      status: "confirmed" satisfies TaskStatus,
      qaSummary: "已确认，等待生成"
    };
  });
  const confirmed = nextTasks.filter((task, index) => task.status === "confirmed" && state.tasks[index].status === "planned").length;

  if (confirmed === 0) {
    return {
      ok: false,
      status: "pending_input",
      message: "没有可确认的计划任务，请先生成月度计划或选择计划中任务。",
      data: {
        confirmed,
        tasks: state.tasks
      }
    };
  }

  state.tasks = nextTasks;
  state.monthlyPlan = {
    ...state.monthlyPlan,
    status: "confirmed"
  };
  saveWithEvent(state, "content_tasks_confirmed", `Confirmed ${confirmed} content tasks.`);

  return {
    ok: true,
    status: "success",
    message: `已确认 ${confirmed} 个内容任务，可进入今日任务生成。`,
    data: {
      confirmed,
      tasks: state.tasks
    }
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
  state.monthlyPlan = {
    ...state.monthlyPlan,
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
  const nextSetting: WorkspaceSetting = {
    ...state.workspaceSetting,
    defaultPublishDays: clampNumber(input.defaultPublishDays, state.workspaceSetting.defaultPublishDays, 1, 31),
    defaultDailyCount: clampNumber(input.defaultDailyCount, state.workspaceSetting.defaultDailyCount, 1, 10),
    enabledChannels: coerceChannels(input.enabledChannels) || state.workspaceSetting.enabledChannels,
    enabledProducts: coerceProducts(input.enabledProducts) || state.workspaceSetting.enabledProducts,
    finalReviewMode:
      input.finalReviewMode === "default_final" || input.finalReviewMode === "manual_review"
        ? input.finalReviewMode
        : state.workspaceSetting.finalReviewMode,
    logMode:
      input.logMode === "demo_csv" || input.logMode === "csv_import" || input.logMode === "nginx_log" || input.logMode === "cdn_log"
        ? input.logMode
        : state.workspaceSetting.logMode,
    updatedAt: nowIso()
  };

  state.workspaceSetting = nextSetting;
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

export function createKnowledgeBase(input: Record<string, unknown>): WorkflowResult<{ knowledgeBase: KnowledgeBase }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const usageScope = typeof input.usageScope === "string" ? input.usageScope.trim() : "";

  if (!name) {
    return {
      ok: false,
      status: "pending_input",
      message: "请填写知识库名称。"
    };
  }

  if (!usageScope) {
    return {
      ok: false,
      status: "pending_input",
      message: "请填写调用范围。"
    };
  }

  const state = readWorkbenchState();
  const knowledgeBase: KnowledgeBase = {
    id: createId("kb"),
    name,
    type: coerceKnowledgeBaseType(input.type, "brand"),
    trustLevel: coerceKnowledgeBaseTrustLevel(input.trustLevel, "medium"),
    status: coerceKnowledgeBaseStatus(input.status, "enabled"),
    usageScope,
    lastSyncedAt: typeof input.lastSyncedAt === "string" && input.lastSyncedAt.trim() ? input.lastSyncedAt.trim() : nowIso()
  };

  state.knowledgeBases = [knowledgeBase, ...state.knowledgeBases];
  saveWithEvent(state, "knowledge_base_created", `Created knowledge base ${knowledgeBase.id}.`);

  return {
    ok: true,
    status: "success",
    message: "知识库已新增到本地持久化状态。",
    data: { knowledgeBase }
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
  const knowledgeBase: KnowledgeBase = {
    ...current,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : current.name,
    type: coerceKnowledgeBaseType(input.type, current.type),
    trustLevel: coerceKnowledgeBaseTrustLevel(input.trustLevel, current.trustLevel),
    status: coerceKnowledgeBaseStatus(input.status, current.status),
    usageScope: typeof input.usageScope === "string" && input.usageScope.trim() ? input.usageScope.trim() : current.usageScope,
    lastSyncedAt: typeof input.lastSyncedAt === "string" && input.lastSyncedAt.trim() ? input.lastSyncedAt.trim() : current.lastSyncedAt
  };

  state.knowledgeBases[index] = knowledgeBase;
  saveWithEvent(state, "knowledge_base_updated", `Updated knowledge base ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "知识库已保存到本地持久化状态。",
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

  const task: ContentTask = {
    ...state.tasks[taskIndex],
    title: buildRegeneratedTaskTitle(state.tasks[taskIndex]),
    targetKeywords: buildTaskKeywords(state.tasks[taskIndex].product, state.tasks[taskIndex].contentType)
  };

  state.tasks[taskIndex] = task;
  saveWithEvent(state, "content_task_title_regenerated", `Regenerated title for content task ${id}.`);

  return {
    ok: true,
    status: "success",
    message: "选题标题已重生成。",
    data: { task }
  };
}

export async function generateDraftForTask(taskId: string): Promise<WorkflowResult<{ task: ContentTask; draft: ArticleDraft }>> {
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
  const draft = await createDraftWithProviderFallback(task, existingDraftIndex >= 0 ? state.drafts[existingDraftIndex] : undefined);
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
    message: draft.generationSource?.mode === "ai_provider" ? "已通过真实 AI Provider 生成稿件。" : "已使用本地规则引擎生成稿件；AI Provider 缺配置或调用失败时会自动 fallback。",
    data: {
      task: nextTask,
      draft
    }
  };
}

export async function batchGenerateDrafts(): Promise<WorkflowResult<{ generated: number; tasks: ContentTask[]; drafts: ArticleDraft[] }>> {
  const state = readWorkbenchState();
  let generated = 0;
  const nextTasks: ContentTask[] = [];

  for (const task of state.tasks) {
    if (!["planned", "confirmed", "generated", "qa_failed", "pending_review"].includes(task.status)) {
      nextTasks.push(task);
      continue;
    }

    const existingDraftIndex = state.drafts.findIndex((item) => item.taskId === task.id);
    const draft = await createDraftWithProviderFallback(task, existingDraftIndex >= 0 ? state.drafts[existingDraftIndex] : undefined);
    generated += 1;

    if (existingDraftIndex >= 0) {
      state.drafts[existingDraftIndex] = draft;
    } else {
      state.drafts.push(draft);
    }

    nextTasks.push(updateTaskStatusForDraft(task, draft));
  }

  state.tasks = nextTasks;

  saveWithEvent(state, "draft_batch_generated", `Generated ${generated} local-rule drafts.`);

  return {
    ok: true,
    status: "success",
    message: `已生成 ${generated} 篇稿件；有 Provider 配置时走真实 AI，否则使用本地规则 fallback。`,
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
  const qaResult = task ? runDraftQa(task, content) : current.qaResult;
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

  if (!draft.qaResult.passed) {
    return {
      ok: false,
      status: "failed",
      message: "稿件仍存在阻断项，不能进入发布队列。"
    };
  }

  const finalDraft: ArticleDraft = {
    ...draft,
    status: "final",
    updatedAt: nowIso()
  };
  const taskIndex = state.tasks.findIndex((item) => item.id === finalDraft.taskId);
  const existingRecord = state.publishRecords.find((item) => item.draftId === finalDraft.id);
  const record =
    existingRecord ||
    ({
      id: createId("pub"),
      draftId: finalDraft.id,
      channel: finalDraft.channel,
      title: finalDraft.title,
      publishStatus: "queued"
    } satisfies PublishRecord);

  state.drafts[draftIndex] = finalDraft;

  if (taskIndex >= 0) {
    state.tasks[taskIndex] = {
      ...state.tasks[taskIndex],
      status: "queued" satisfies TaskStatus,
      qaSummary: "已确认终稿，进入发布队列"
    };
  }

  if (!existingRecord) {
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
    publishStatus: "queued"
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

  const record: PublishRecord = {
    ...state.publishRecords[recordIndex],
    publishStatus: "url_filled",
    publishedUrl,
    publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : nowIso(),
    notes: typeof input.notes === "string" ? input.notes : state.publishRecords[recordIndex].notes
  };

  state.publishRecords[recordIndex] = record;

  const draft = state.drafts.find((item) => item.id === record.draftId);
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

  const record: PublishRecord = {
    ...state.publishRecords[recordIndex],
    publishStatus: "published",
    publishedAt: typeof input.publishedAt === "string" ? input.publishedAt : state.publishRecords[recordIndex].publishedAt || nowIso(),
    notes: typeof input.notes === "string" ? input.notes : state.publishRecords[recordIndex].notes
  };

  state.publishRecords[recordIndex] = record;

  const draft = state.drafts.find((item) => item.id === record.draftId);
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
          candidateAddedAt: existing.candidateAddedAt
        }
      : article
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
  const geoIssues = article.geoResult === "miss" ? ["当前 GEO 诊断未命中 JOTO 或唯客"] : [];
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
      ? "GEO 诊断未命中，建议进入博客候选池补强。"
      : article.seoIssueCount > 0
        ? `存在 ${article.seoIssueCount} 个 SEO 问题，建议进入优化候选池。`
        : "人工加入博客候选池。";
  const nextArticle: BlogArticle = {
    ...article,
    candidateStatus: "candidate",
    candidateReason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : fallbackReason,
    candidateAddedAt: nowIso()
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
    candidateAddedAt: (status === "candidate" || status === "planned") && !article.candidateAddedAt ? nowIso() : article.candidateAddedAt
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
  const task: ContentTask = {
    id: createId("task"),
    monthlyPlanId: state.monthlyPlan.id,
    publishDate: typeof input.publishDate === "string" && input.publishDate.trim() ? input.publishDate.trim() : state.monthlyPlan.monthStart,
    channel,
    product,
    title: `渠道补强：${article.title}`,
    contentType,
    targetKeywords: Array.from(new Set([...buildTaskKeywords(product, contentType), "官网博客补强", article.geoResult === "miss" ? "GEO 未命中" : "SEO 优化"])),
    status: "planned",
    qaSummary: `来源博客候选池：${article.candidateReason || article.url}`
  };
  const nextArticle: BlogArticle = {
    ...article,
    candidateStatus: "planned",
    candidateReason: article.candidateReason || "已从博客候选池生成渠道补强任务。",
    candidateAddedAt: article.candidateAddedAt || nowIso()
  };

  state.blogArticles[articleIndex] = nextArticle;
  state.tasks = [...state.tasks, task];
  state.monthlyPlan = {
    ...state.monthlyPlan,
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

  const month = typeof input.month === "string" && input.month.trim() ? input.month.trim() : readWorkbenchState().monthlyPlan.monthStart;
  getMonthlyReview(month);
  steps.push({
    name: "read_monthly_report",
    ok: true,
    status: "success",
    message: `已读取 ${month} 月度复盘快照。`,
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
    month,
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
    "id,status,startedAt,finishedAt,month,stepName,stepStatus,stepMessage,missingConfig",
    ...runs.flatMap((run) =>
      run.steps.map((step) =>
        [
          run.id,
          run.status,
          run.startedAt,
          run.finishedAt,
          run.month,
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

export function getMonthlyReview(month: string) {
  const state = readWorkbenchState();
  const published = state.publishRecords.filter((item) => item.publishStatus !== "queued").length;
  const botPv = state.botVisits.reduce((sum, item) => sum + item.pv, 0);

  return {
    month,
    executiveSummary: `本月度计划 ${state.monthlyPlan.targetTotalCount} 篇，已发布 ${published} 篇；AI Bot PV ${botPv}。`,
    publishRecords: state.publishRecords,
    blogDiagnostics: state.blogArticles,
    nextMonthSuggestions: [
      "继续写已经完成 URL 回填且表现稳定的主题。",
      "根据博客诊断结果补强官网内容，并优先沉淀为候选主题。",
      "把 SEO 问题较多的官网博客加入候选池，等博客创作职责明确后再处理。"
    ],
    dataSource: state.runtime.storage
  };
}

export function createNextMonthlyPlanFromReview(month: string, input: Record<string, unknown> = {}) {
  const state = readWorkbenchState();
  const sourceReport = getMonthlyReview(month);
  const nextMonthStart = getMonthStart(
    typeof input.monthStart === "string" && input.monthStart.trim() ? input.monthStart.trim() : getNextMonthStart(month)
  );
  const days = clampNumber(input.days, state.workspaceSetting.defaultPublishDays, 1, 31);
  const dailyCount = clampNumber(input.dailyCount, state.workspaceSetting.defaultDailyCount, 1, 10);
  const channels = coerceChannels(input.channels) || state.workspaceSetting.enabledChannels;
  const products = coerceProducts(input.products) || state.workspaceSetting.enabledProducts;
  const suggestions = sourceReport.nextMonthSuggestions.length
    ? sourceReport.nextMonthSuggestions
    : ["延续本月表现稳定的主题，并优先补强博客诊断中暴露的问题。"];
  const tasks: ContentTask[] = [];

  for (let day = 0; day < days; day += 1) {
    for (let count = 0; count < dailyCount; count += 1) {
      const index = tasks.length;
      const channel = channels[index % channels.length];
      const product = products[index % products.length];
      const contentType = coerceContentType(index);
      const suggestion = suggestions[index % suggestions.length];
      const baseTitle = buildTaskTitle(index, channel, product, contentType);

      tasks.push({
        id: createId("task"),
        monthlyPlanId: `mp-${nextMonthStart}`,
        publishDate: addDays(nextMonthStart, day),
        channel,
        product,
        title: `${baseTitle}｜${suggestion}`,
        contentType,
        targetKeywords: [...buildTaskKeywords(product, contentType), "月度复盘建议"],
        status: "planned",
        qaSummary: `来源月度复盘 ${month}：${suggestion}`
      });
    }
  }

  state.monthlyPlan = {
    id: `mp-${nextMonthStart}`,
    monthStart: nextMonthStart,
    monthEnd: getMonthEnd(nextMonthStart),
    targetTotalCount: tasks.length,
    status: "draft"
  };
  state.tasks = tasks;
  state.drafts = [];
  state.publishRecords = [];

  saveWithEvent(state, "next_month_plan_created_from_review", `Created ${tasks.length} planned tasks from monthly review ${month}.`);

  return {
    ok: true,
    status: "success" as const,
    message: `已根据 ${month} 月度复盘生成下月计划草稿。`,
    data: {
      sourceMonth: month,
      monthlyPlan: state.monthlyPlan,
      tasks,
      suggestions
    }
  };
}

function markdownCell(value: unknown) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
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

export function exportMonthlyReviewMarkdown(month: string) {
  const report = getMonthlyReview(month);
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
  const suggestionRows = report.nextMonthSuggestions.map((item, index) => `${index + 1}. ${item}`);
  const markdown = [
    `# JOTO GTM 月度复盘 - ${report.month}`,
    "",
    "## 1. 管理层摘要",
    "",
    report.executiveSummary,
    "",
    "## 2. 渠道执行复盘",
    "",
    "| 渠道 | 标题 | 状态 | URL | 指标 |",
    "|---|---|---|---|---|",
    ...publishRows,
    "",
    "## 3. 官网博客诊断",
    "",
    "| 标题 | 索引状态 | SEO 问题数 | GEO 结果 | 候选状态 |",
    "|---|---|---|---|---|",
    ...blogRows,
    "",
    "## 4. 下月建议",
    "",
    ...suggestionRows,
    "",
    "## 5. 数据说明",
    "",
    `- 数据来源：${report.dataSource}`,
    `- 导出时间：${exportedAt}`,
    "- Demo / imported / real 数据需要按页面标签区分，不要把 Demo 指标当作正式策略判断。"
  ].join("\n");

  return {
    ok: true,
    status: "success" as const,
    message: "月度复盘 Markdown 已导出。",
    data: {
      month,
      format: "markdown",
      markdown,
      report,
      exportedAt
    }
  };
}
