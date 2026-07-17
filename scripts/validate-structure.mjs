import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const canonicalWorkbenchRoot = process.env.WORKBENCH_CANONICAL_ROOT || join(root, "..", "工作台");
const checks = [];

function resolveFilePath(filePath) {
  const projectPath = join(root, filePath);
  if (existsSync(projectPath)) return projectPath;

  const canonicalPath = join(canonicalWorkbenchRoot, filePath);
  if (filePath.startsWith("docs/") && existsSync(canonicalPath)) return canonicalPath;

  return projectPath;
}

function read(filePath) {
  const fullPath = resolveFilePath(filePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function addFileCheck(label, filePath) {
  const resolvedPath = resolveFilePath(filePath);
  const projectPath = join(root, filePath);
  checks.push({ label, pass: existsSync(resolvedPath), detail: resolvedPath === projectPath ? filePath : `${filePath} via ${canonicalWorkbenchRoot}` });
}

function addContentCheck(label, filePath, needles) {
  const content = read(filePath);
  const missing = needles.filter((needle) => !content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && missing.length === 0,
    detail: missing.length ? `${filePath} missing: ${missing.join(", ")}` : filePath
  });
}

function addAbsentCheck(label, filePath, needles) {
  const content = read(filePath);
  const present = needles.filter((needle) => content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && present.length === 0,
    detail: present.length ? `${filePath} should not include: ${present.join(", ")}` : filePath
  });
}

function addRegexCheck(label, filePath, patterns) {
  const content = read(filePath);
  const missing = patterns.filter((pattern) => !pattern.test(content));
  checks.push({
    label,
    pass: Boolean(content) && missing.length === 0,
    detail: missing.length ? `${filePath} missing expected pattern` : filePath
  });
}

[
  "docs/usage.md",
  "docs/V4-06-24/v4-workbench-development-prd.md",
  "docs/V4-06-24/v4-development-task-plan.md",
  "src/lib/prompt-templates.ts",
  "src/lib/client-state.ts",
  "src/app/page.tsx",
  "src/app/weekly-plan/page.tsx",
  "src/app/today/page.tsx",
  "src/app/drafts/[taskId]/page.tsx",
  "src/app/publish/page.tsx",
  "src/app/geo-test/page.tsx",
  "src/app/geo-test/[id]/page.tsx",
  "src/app/blog-monitor/page.tsx",
  "src/app/knowledge/page.tsx",
  "src/app/distilled-terms/page.tsx",
  "src/app/weekly-report/page.tsx",
  "src/app/ai-config/page.tsx",
  "src/app/real-integration/page.tsx",
  "src/components/GovernanceEntry.tsx",
  "src/lib/repositories/mysql-bridge.ts",
  "src/app/api/weekly-plans/[id]/route.ts",
  "src/app/api/weekly-reports/[week]/route.ts",
  "src/app/api/weekly-reports/[week]/suggestions/[id]/route.ts",
  "src/app/api/distilled-terms/extract/route.ts",
  "src/app/api/distilled-terms/auto-pool/route.ts",
  "src/app/api/distilled-terms/[id]/route.ts",
  "scripts/smoke-pages.mjs",
  "scripts/smoke-browser.mjs",
  "scripts/smoke-browser-isolated.mjs",
  "scripts/smoke-workflow.mjs",
  "scripts/smoke-workflow-isolated.mjs",
  "scripts/v5-knowledge-workflow-policy.test.mjs",
  "src/lib/v5-knowledge-workflow-policy.ts",
  "docs/V5 07-07/01-真实开发准入审计与流程规则映射.md",
  "src/app/api/content-tasks/[id]/published/route.ts",
  "src/app/api/content-tasks/[id]/url/route.ts",
  "src/app/api/content-tasks/[id]/review/route.ts",
  "src/app/api/content-tasks/[id]/generate/route.ts",
  "src/app/api/content-tasks/batch-generate/route.ts",
  "src/app/api/geo-tests/run/route.ts",
  "src/app/api/distribution/wechatsync/status/route.ts",
  "src/app/api/distribution/wechatsync/check-auth/route.ts",
  "src/app/api/publish-records/[id]/distribution-targets/route.ts",
  "src/app/api/distribution-targets/[id]/send-draft/route.ts",
  "src/app/api/publish-schedules/route.ts",
  "src/app/api/publish-schedules/[id]/run/route.ts",
  "src/app/api/direct-publish/route.ts",
  "src/lib/wechatsync-client.ts",
  "src/lib/publish-adapters/index.ts",
  "src/lib/publish-adapters/types.ts"
].forEach((filePath) => addFileCheck(`required file: ${filePath}`, filePath));

[
  "src/app/monthly-matrix/page.tsx",
  "src/app/monthly-matrix/strategy/page.tsx",
  "src/app/monthly-matrix/batch-generation/page.tsx",
  "src/app/monthly-strategy/page.tsx",
  "src/app/batch-generation/page.tsx",
  "src/app/exceptions/page.tsx",
  "src/app/publish-schedule/page.tsx",
  "src/app/publish-schedule/daily-execution/page.tsx",
  "src/app/daily-execution/page.tsx",
  "src/app/monthly-review/page.tsx",
  "src/components/MonthlyMatrixTable.tsx",
  "src/components/BatchGenerationMatrixTable.tsx",
  "src/components/MonthlyPlanConfigPanel.tsx",
  "src/components/EvidenceGateTag.tsx",
  "src/components/PublishStatusTag.tsx",
  "src/components/ExceptionQueuePreview.tsx",
  "src/components/ScheduleCalendarLite.tsx",
  "src/components/V5StatusRail.tsx",
  "src/lib/v5-ui-mock-data.ts",
  "src/lib/v5/monthly-workspace-contracts.ts",
  "src/lib/v5/monthly-contracts.ts",
  "src/lib/v5/monthly-repository.ts",
  "src/lib/v5/monthly-service.ts",
  "src/lib/v5/monthly-plan-repository.ts",
  "src/lib/v5/monthly-plan-service.ts",
  "src/lib/v5/monthly-workspace-governance.ts",
  "src/lib/v5/monthly-workspace-read-model.ts",
  "src/lib/v5/use-monthly-workspace.ts",
  "src/app/api/v5/monthly-workspace/route.ts",
  "src/app/api/v5/monthly-plans/[month]/route.ts"
].forEach((filePath) => addFileCheck(`v5 ui file: ${filePath}`, filePath));

addContentCheck("v5 navigation entries", "src/components/AppShell.tsx", [
  "月度内容矩阵",
  "/batch-generation",
  "批量生成中心",
  "/daily-execution",
  "当日执行",
  "月度复盘",
  "数据回传",
  "知识库",
  "AI 配置",
  "GEO 测试",
  "月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘"
]);

addAbsentCheck("v5 merged flow routes not top-level nav", "src/components/AppShell.tsx", [
  "href=\"/monthly-strategy\"",
  "href=\"/monthly-matrix/strategy\"",
  "href=\"/monthly-matrix/batch-generation\"",
  "href=\"/exceptions\"",
  "href=\"/publish-schedule\"",
  "href=\"/publish-schedule/daily-execution\""
]);

addAbsentCheck("v5 replaced v4 routes not primary navigation", "src/components/AppShell.tsx", [
  "href=\"/weekly-plan\"",
  "href=\"/today\"",
  "href=\"/weekly-report\""
]);

addAbsentCheck("agent foundation removed from navigation", "src/components/AppShell.tsx", ["/agent-foundation", "Agent 底座"]);
addAbsentCheck("agent foundation removed from route labels", "src/lib/permissions.ts", ["/agent-foundation", "Agent 底座"]);
addAbsentCheck("agent foundation removed from page smoke", "scripts/smoke-pages.mjs", ["/agent-foundation", "agent_foundation_page"]);

addContentCheck("v5 route labels", "src/lib/permissions.ts", [
  "/monthly-strategy",
  "/monthly-matrix",
  "/monthly-matrix/strategy",
  "/monthly-matrix/batch-generation",
  "/batch-generation",
  "/exceptions",
  "/publish-schedule",
  "/publish-schedule/daily-execution",
  "/daily-execution",
  "/monthly-review"
]);

addContentCheck("v5 monthly matrix page shell", "src/app/monthly-matrix/page.tsx", [
  "月度内容矩阵",
  "月度计划配置",
  "月度策略包审核",
  "生成策略包",
  "确认策略包",
  "GEO 测试分配",
  "策略可行不等于正文可生成",
  "MonthlyStrategyTable",
  "strategyTermHits",
  "进入批量生成中心",
  "useMonthlyWorkspace",
  "尚未配置本月业务目标",
  "MonthlyPlanConfigPanel"
]);

addAbsentCheck("v5 monthly kpi rail no duplicate period", "src/app/monthly-matrix/page.tsx", ['label: "月份"']);
addAbsentCheck("v5 strategy package has no article title table", "src/components/MonthlyMatrixTable.tsx", ["文章标题", "人工排程", "plannedPublishAt"]);

addContentCheck("v5 monthly manual configuration", "src/components/MonthlyPlanConfigPanel.tsx", [
  "月度计划配置",
  "产品由已治理的产品表达规则包带出",
  "monthlyProductionReady",
  "isSelectablePackage",
  "mode=\"multiple\"",
  "发布渠道",
  "文章数量",
  "GEO 基线比例",
  "ratioAdjustmentReason",
  "月度总量",
  "当前可用规则包",
  "不能进入生产池",
  "保存配置",
  "monthly-plan-save-button",
  "已保存到 V5 数据源"
]);

addContentCheck("v5 monthly workspace api contract", "src/lib/v5/monthly-workspace-contracts.ts", [
  "V5MonthlyWorkspace",
  "MonthlyWorkspaceReadModel",
  "V5GovernanceSource",
  "governanceData",
  "formal",
  "V5MonthlyPlanRecord",
  "SaveMonthlyPlanRequest",
  "V5ApiEnvelope",
  "expectedVersion"
]);

addAbsentCheck("v5 formal monthly contract has no ui dto", "src/lib/v5/monthly-contracts.ts", [
  "V5MonthlyWorkspace",
  "MonthlyWorkspaceReadModel",
  "SaveMonthlyPlanRequest",
  "V5ApiEnvelope",
  "RulePackageOption"
]);

addContentCheck("v5 formal monthly contract source", "src/lib/v5/monthly-contracts.ts", [
  "V5MonthlyPlan",
  "V5MonthlyProductionReadiness",
  "V5ProductionPoolEntry"
]);

addContentCheck("v5 monthly repository boundary", "src/lib/v5/monthly-repository.ts", [
  "V5_MONTHLY_STATE_PATH",
  "data/v5-monthly-workbench.json",
  "readV5MonthlyState",
  "updateV5MonthlyState",
  "temporaryPath",
  "rename(temporaryPath, statePath)",
  "idempotency",
  "auditLog"
]);

addContentCheck("v5 monthly service guards", "src/lib/v5/monthly-service.ts", [
  "WORKBENCH_STATE_PATH",
  "seed_fallback",
  "WRITE_ROLES",
  "assertWritableRole",
  "validateMonthlyPlan",
  "expectedVersion",
  "IDEMPOTENCY_KEY_REUSED",
  "MONTHLY_PLAN_VERSION_CONFLICT"
]);

addContentCheck("v5 formal monthly plan repository", "src/lib/v5/monthly-plan-repository.ts", [
  "monthly-contracts",
  "getV5GovernancePool",
  "readV5MonthlyPlanRecord",
  "SELECT * FROM monthly_plan WHERE plan_month = ? LIMIT 1"
]);

addContentCheck("v5 formal monthly plan service", "src/lib/v5/monthly-plan-service.ts", [
  "monthly-contracts",
  "readV5MonthlyPlanRecord",
  "getV5MonthlyPlan"
]);

addContentCheck("v5 monthly workspace governance adapter", "src/lib/v5/monthly-workspace-governance.ts", [
  "monthly-contracts",
  "getV5MonthlyPlan",
  "getV5MonthlyProductionReadiness",
  "getV5MonthlyProductionPool",
  "pending_config",
  "monthlyProductionReady"
]);

addContentCheck("v5 monthly workspace read model adapter", "src/lib/v5/monthly-workspace-read-model.ts", [
  "monthly-contracts",
  "getMonthlyWorkspaceBase",
  "loadMonthlyWorkspaceGovernance",
  "getMonthlyWorkspaceReadModel",
  "governanceData",
  "formal"
]);

addContentCheck("v5 monthly read api", "src/app/api/v5/monthly-workspace/route.ts", [
  "force-dynamic",
  "getMonthlyWorkspaceReadModel",
  "cache-control",
  "no-store"
]);

addContentCheck("v5 monthly write api", "src/app/api/v5/monthly-plans/[month]/route.ts", [
  "PUT",
  "parseSaveMonthlyPlanRequest",
  "saveV5MonthlyPlan",
  "x-idempotency-key"
]);

addContentCheck("v5 strategy page merged redirect", "src/app/monthly-matrix/strategy/page.tsx", [
  "redirect",
  "/monthly-matrix#strategy-package"
]);

addContentCheck("v5 strategy old route redirects", "src/app/monthly-strategy/page.tsx", [
  "redirect",
  "/monthly-matrix#strategy-package"
]);

addAbsentCheck("v4 ai config unchanged by v5 ui", "src/app/ai-config/page.tsx", ["V5GovernanceLogTabs", "V5 治理日志"]);

addContentCheck("v5 batch page shell", "src/app/batch-generation/page.tsx", [
  "批量生成中心",
  "批量确认标题与矩阵",
  "批量生成当月可生成内容",
  "Final Evidence Gate",
  "内容任务",
  "Tabs",
  "BatchGenerationMatrixTable",
  "ScheduleCalendarLite",
  "ExceptionQueuePreview",
  "只生成通过正式准入的矩阵项",
  "异常项保留原状态和原因"
]);

addContentCheck("v5 batch grouped task list", "src/components/BatchGenerationMatrixTable.tsx", [
  "按产品分组",
  "按渠道分组",
  "按状态分组",
  "按内容类型分组",
  "按主蒸馏词分组",
  "全部收起",
  "v5-task-title-single-line",
  "Tooltip",
  "Collapse",
  "batch-task-search"
]);

addContentCheck("v5 schedule full calendar details", "src/components/ScheduleCalendarLite.tsx", [
  "人工排程日历",
  "悬浮日期查看具体排程",
  "trigger={[\"hover\", \"click\"]}",
  "v5-calendar-status-summary",
  "schedule-day-",
  "未排程内容"
]);

addContentCheck("v5 batch and schedule responsive styles", "src/app/globals.css", [
  ".v5-grouped-task-list",
  ".v5-task-title-single-line",
  ".v5-stage-strip",
  ".v5-calendar-status-summary",
  ".v5-calendar-popover-content",
  ".v5-unscheduled-collapse"
]);

addContentCheck("v5 batch nested route redirects", "src/app/monthly-matrix/batch-generation/page.tsx", [
  "redirect",
  "/batch-generation"
]);

addContentCheck("v5 exception old route redirects", "src/app/exceptions/page.tsx", [
  "redirect",
  "/batch-generation#exceptions"
]);

addContentCheck("v5 publish schedule old route redirects", "src/app/publish-schedule/page.tsx", [
  "redirect",
  "/batch-generation#schedule"
]);

addContentCheck("v5 daily execution page shell", "src/app/daily-execution/page.tsx", [
  "当日执行",
  "昨日",
  "今日",
  "明日",
  "本月已发布",
  "本月待发布",
  "已排程待发布",
  "未排程",
  "发布执行视图",
  "URL 不在本页呈现",
  "PublishStatusTag"
]);

addAbsentCheck("v5 daily execution has no planning or generation actions", "src/app/daily-execution/page.tsx", [
  "月度计划配置",
  "批量生成当月可生成内容",
  "回填 URL",
  "确认 URL"
]);

addContentCheck("v5 daily execution nested route redirects", "src/app/publish-schedule/daily-execution/page.tsx", [
  "redirect",
  "/daily-execution"
]);

addContentCheck("v5 monthly review page shell", "src/app/monthly-review/page.tsx", [
  "月度复盘",
  "蒸馏词和产品",
  "baseline",
  "exploration",
  "GEO 缺口",
  "主蒸馏词月度结果",
  "下月候选调整",
  "Agent 草稿 · 人工确认"
]);

addContentCheck("v5 evidence gate labels", "src/components/EvidenceGateTag.tsx", [
  "可生成",
  "自动降级后可生成",
  "需补证据",
  "已阻断",
  "待配置",
  "需人工确认"
]);

addContentCheck("v5 mock data boundary", "src/lib/v5-ui-mock-data.ts", [
  "demo / mock，待接入真实 V5 后端",
  "MonthlyPlanGroupQuota",
  "StrategyTermHit",
  "BatchQueueItem",
  "ExceptionItem",
  "ScheduleDraftItem",
  "DailyExecutionItem",
  "MonthlyTermReview",
  "NextMonthCandidate",
  "PublishStatus",
  "MonthlyPlanConfig",
  "rulePackageOptions",
  "strategyTermHits",
  "exceptionItems",
  "scheduleDraftItems",
  "batchQueueItems",
  "dailyExecutionItems",
  "monthlyTermReviews",
  "nextMonthCandidates"
]);

addAbsentCheck("v5 connected pages no direct mock imports", "src/app/monthly-matrix/page.tsx", ["v5-ui-mock-data", "v5DemoLabel"]);
addAbsentCheck("v5 batch page no direct mock imports", "src/app/batch-generation/page.tsx", ["v5-ui-mock-data", "v5DemoLabel"]);
addAbsentCheck("v5 monthly config no real backend calls", "src/components/MonthlyPlanConfigPanel.tsx", ["fetch(", "/api/"]);
addContentCheck("v5 batch single formal generation call", "src/app/batch-generation/page.tsx", [
  "fetch(",
  "/api/v5/content-tasks/",
  "prepare-and-generate",
  "x-idempotency-key",
  "generatingTaskId",
  "问题已处理，重新尝试"
]);
addAbsentCheck("v5 batch keeps bulk generation disabled", "src/app/batch-generation/page.tsx", ["/api/content-tasks/batch-generate"]);
addAbsentCheck("v5 daily execution no real backend calls", "src/app/daily-execution/page.tsx", ["fetch(", "/api/"]);
addAbsentCheck("v5 monthly review no real backend calls", "src/app/monthly-review/page.tsx", ["fetch(", "/api/"]);

addContentCheck("dashboard scoped v5 replacement", "src/app/page.tsx", [
  "首页数据看板",
  "V5 月度生产概览",
  "本月内容矩阵",
  "样例已生成",
  "异常待处理",
  "V5 生产数据与现有运行态分开呈现",
  "保留能力运行态",
  "V4 保持不变",
  "待回填 URL",
  "待数据回传",
  "博客监控",
  "GEO 测试",
  "主流程与保留能力"
]);
addAbsentCheck("dashboard focused business queue", "src/app/page.tsx", [
  "本周内容生产和发布执行队列的总览",
  "官网博客与 GEO 概览",
  "Pipeline 运行记录"
]);

addContentCheck("weekly plan v4 preview only", "src/app/weekly-plan/page.tsx", [
  "周计划生成预览",
  "正文统一到今日发布页批量生成",
  "主蒸馏词",
  "来源问题",
  "官网链接目标",
  "证据需求",
  "AI 自动生成发布矩阵",
  "发布矩阵异常",
  "getPublishMatrixIssues",
  "matrixBlockingIssues",
  "全周发布量不能为 0",
  "单日发布量超过 5 篇",
  "handleSavePublishMatrix",
  "/api/weekly-plans/${weeklyPlan.id}",
  "保存周发布设置",
  "生成来源摘要",
  "generationSource",
  "weekly-source-grid",
  "generationSignalStatusLabels",
  "标题来源归因",
  "renderTitleSourceAttributions",
  "titleSourceAttributions",
  "驳回计划项",
  "重新入池",
  "renderRejectionRecords",
  "rejectionRecords",
  "/api/content-tasks/${rejectingTask.id}/review",
  "按来源归因筛选",
  "按反馈信号筛选",
  "sourceFilterLabels",
  "feedbackFilterLabels",
  "taskMatchesFeedbackFilter",
  "筛选结果",
  "批量确认",
  "批量确认前复核",
  "可确认",
  "需复核",
  "getConfirmReviewReasons",
  "batchConfirmSummary",
  "weekly-plan-generate-form",
  "weekly-plan-table-filters",
  "mode",
  "编辑记录",
  "editRecords",
  "接受风险并确认",
  "riskAcceptanceReason",
  "风险确认记录",
  "riskAcceptanceRecords",
  "确认建议",
  "未达确认阈值",
  "getConfirmGuidance"
]);
addAbsentCheck("weekly plan no body generation", "src/app/weekly-plan/page.tsx", ["正文预览", "发布队列", "覆盖草稿"]);
addAbsentCheck("weekly plan no provider wording", "src/app/weekly-plan/page.tsx", ["AI Provider"]);
addAbsentCheck("weekly plan no confidence score in frontend", "src/app/weekly-plan/page.tsx", [
  "置信度",
  "低置信度",
  "置信度低于 65%",
  "Math.round((record.confidence"
]);

addContentCheck("today owns publish closure", "src/app/today/page.tsx", [
  "今日发布",
  "批量生成正文",
  "selectedGeneratableIds",
  "evidenceByTaskId",
  "selectedChunkIdsByTask",
  "getEvidenceReview",
  "getBatchEvidenceReview",
  "missingEvidenceReview",
  "requireEvidence",
  "ApiRequestError",
  "serverMissingEvidenceByTask",
  "handleServerMissingEvidence",
  "服务端证据复核未通过",
  "证据完整性复核",
  "本地兜底稿",
  "产品表达规则包",
  "getProductExpressionRuleForTask",
  "today-brief-rule-package-",
  "today-brief-rule-source-",
  "today-brief-rule-version-",
  "today-brief-rule-summary-",
  "platformDraftVariants",
  "distributionTargets",
  "ensurePlatformDraftTargets",
  "handleWritePlatformDrafts",
  "handleBatchWritePlatformDrafts",
  "renderDistributionTargetTags",
  "文章质量",
  "质量问题",
  "平台草稿",
  "写入平台草稿箱",
  "只会写入平台草稿箱，不会正式发布，也不会自动回填 URL。",
  "today-write-platform-drafts-",
  "today-write-platform-drafts-confirm-",
  "/api/content-tasks/batch-generate",
  "/api/publish-records/${record.id}/distribution-targets",
  "/api/distribution-targets/${target.id}/send-draft",
  "/api/content-tasks/${task.id}/published",
  "/api/content-tasks/${urlTask.id}/url",
  "确认已发布",
  "回填正式发布 URL",
  "去数据回传",
  "today-confirm-published-",
  "today-fill-url-",
  "today-url-input"
]);
addAbsentCheck("today no technical fallback label", "src/app/today/page.tsx", ["已 fallback", "AI Provider", "Provider 配置"]);
addAbsentCheck("today no visible chunk wording", "src/app/today/page.tsx", ["选择 Chunk", "所选 Chunk", "知识库 Chunk"]);
addAbsentCheck("today no single-row generate api", "src/app/today/page.tsx", ["handleGenerateTask", "确认生成这篇稿件？", "`/api/content-tasks/${taskId}/generate`"]);

addContentCheck("distribution draft data model", "src/lib/types.ts", [
  "DistributionPlatformKey",
  "DistributionTargetStatus",
  "DistributionTargetErrorCode",
  "PlatformDraftVariant",
  "DistributionTarget",
  "mock\" | \"real"
]);

addContentCheck("direct publish data model", "src/lib/types.ts", [
  "DirectPublishPlatformKey",
  "PublishScheduleStatus",
  "PublishAttemptStatus",
  "PublishFailureCode",
  "PlatformPublishPayload",
  "PublishSchedule",
  "PublishAttempt",
  "published_verified",
  "published_pending_url",
  "manual_takeover_required",
  "pendingCsvReturn"
]);

addContentCheck("distribution labels and channel mapping", "src/lib/labels.ts", [
  "distributionPlatformLabels",
  "fixedDistributionPlatforms",
  "channelDistributionTargets",
  "distributionTargetStatusLabels",
  "distributionTargetStatusColors",
  "wechat: [\"weixin\"]",
  "zhihu_toutiao_general: [\"zhihu\"]"
]);

addContentCheck("distribution store invariant", "src/lib/workbench-store.ts", [
  "platformDraftVariants: PlatformDraftVariant[]",
  "distributionTargets: DistributionTarget[]",
  "normalizePlatformDraftVariants",
  "normalizeDistributionTargets",
  "createDistributionTargetsForPublishRecord",
  "getWechatsyncStatus",
  "checkDistributionPlatformAuth",
  "sendDistributionTargetDraft",
  "buildPlatformVariantFromDraft",
  "ensurePlatformDraftVariant",
  "distribution_draft_created",
  "只有待发布状态的记录可以写入平台草稿箱。"
]);

addContentCheck("direct publish store invariant", "src/lib/workbench-store.ts", [
  "publishSchedules: PublishSchedule[]",
  "publishAttempts: PublishAttempt[]",
  "normalizePublishSchedules",
  "normalizePublishAttempts",
  "createPublishSchedules",
  "runPublishSchedule",
  "runDuePublishSchedules",
  "direct_publish_attempt_finished",
  "正式发布排程已创建",
  "published_pending_url"
]);

addContentCheck("direct publish adapter contract", "src/lib/publish-adapters/index.ts", [
  "WechatDirectPublishAdapter",
  "JuejinDirectPublishAdapter",
  "CsdnDirectPublishAdapter",
  "ZhihuDirectPublishAdapter",
  "checkAuth",
  "validatePayload",
  "publish(",
  "verify(",
  "DIRECT_PUBLISH_ENABLED",
  "manual_takeover_required",
  "pendingCsvReturn"
]);

addContentCheck("direct publish api contract", "scripts/smoke-workflow.mjs", [
  "direct_publish_schedule_create",
  "direct_publish_run_due",
  "direct_publish_four_platform_attempts",
  "/api/publish-schedules",
  "/api/direct-publish",
  "published_pending_url"
]);

addContentCheck("wechatsync client mock boundary", "src/lib/wechatsync-client.ts", [
  "WECHATSYNC_ENABLED",
  "WECHATSYNC_MOCK",
  "mock",
  "disabled",
  "getWechatsyncRuntimeStatus",
  "checkWechatsyncAuth",
  "sendWechatsyncDraft",
  "local-mock://"
]);

addContentCheck("draft preview qa only", "src/app/drafts/[taskId]/page.tsx", [
  "草稿 AI 二次质检",
  "保存并运行 AI 二次质检",
  "draft-editor-stage",
  "draft-editor-main",
  "draft-inline-risk-panel",
  "draft-risk-rail",
  "showInlineRiskPreview",
  "showRiskRail",
  "正文风险定位",
  "本地规则稿",
  "AI 生成",
  "keepReasonCategory",
  "pendingKeepReasonCategory",
  "保留原因分类",
  "删除",
  "AI改写",
  "保留高风险片段",
  "返回修改前",
  "复制全文",
  "copyAllowed",
  "请先保存并运行 AI 二次质检"
]);
addAbsentCheck("draft no internal qa fields in frontend", "src/app/drafts/[taskId]/page.tsx", [
  "AI Provider",
  "Provider",
  "Prompt",
  "issueCode",
  "ruleHit",
  "置信度",
  "confidence",
  "trace"
]);
addAbsentCheck("draft no publish queue entry", "src/app/drafts/[taskId]/page.tsx", ["确认加入发布队列", "handleApproveDraft", "router.push(\"/publish\")", "重新生成稿件"]);

addContentCheck("data return page only", "src/app/publish/page.tsx", [
  "数据回传",
  "这里只负责把渠道数据匹配到已发布文章",
  "/api/channel-metrics/import",
  "手动补录渠道指标",
  "getDataReturnStatus",
  "回今日发布",
  "待数据回传"
]);
addAbsentCheck("data return no publish confirmation", "src/app/publish/page.tsx", ["handleMarkPublished", "/published", "回填发布 URL", "handleFillUrl"]);

addContentCheck("geo v3 diagnostic", "src/app/geo-test/page.tsx", [
  "测试范围",
  "测试频率与自动化",
  "诊断摘要",
  "问题组",
  "Drawer",
  "selectedDistilledTermIds",
  "testCategory",
  "baseline_fixed",
  "dynamic_exploration",
  "GEO 测试拆成 2:8 两类",
  "蒸馏词默认全选",
  "citationLevelLabels",
  "引用层级",
  "问题类型",
  "建议动作",
  "getFrequencySuggestion",
  "看失败详情",
  "distilledTermIds: activeDistilledTermIds"
]);
addAbsentCheck("geo main no prompt group wording", "src/app/geo-test/page.tsx", ["Prompt 组", "Provider", "补齐 Provider"]);
addAbsentCheck("geo no binary official citation filter", "src/app/geo-test/page.tsx", ["officialCitationFilter", "按官网引用筛选"]);
addAbsentCheck("geo main no raw snapshot modal", "src/app/geo-test/page.tsx", [
  "snapshotResult",
  "setSnapshotResult",
  "回答快照",
  "查看快照",
  "answerSnapshot",
  "citedUrls.join"
]);

addContentCheck("geo v4 detail subpage", "src/app/geo-test/[id]/page.tsx", [
  "GEO 详情",
  "AI 回答摘要",
  "引用来源",
  "竞品提及",
  "内容动作",
  "原始数据",
  "getGeoBusinessConclusion",
  "getGeoNextStep",
  "问题组：",
  "复制业务详情",
  "转周计划",
  "补知识库",
  "入候选池",
  "原始数据仅用于排查和追溯"
]);
addAbsentCheck("geo detail no prompt group wording", "src/app/geo-test/[id]/page.tsx", ["Prompt 组", "Provider", "补齐 Provider"]);
addAbsentCheck("geo business export no prompt group wording", "src/lib/workbench-store.ts", ["Prompt 组"]);

addContentCheck("blog monitor v3 diagnosis first", "src/app/blog-monitor/page.tsx", [
  "GEO 健康分",
  "引用准备不足",
  "引用片段不足",
  "问题分布",
  "官网信源状态",
  "优先处理问题",
  "getBlogAuditIndicators",
  "AI 可读取性",
  "标题与正文可提取性",
  "问答结构完整度",
  "引用片段准备度",
  "博客明细"
]);
addAbsentCheck("blog monitor no visible technical diagnostic wording", "src/app/blog-monitor/page.tsx", [
  "Chunk 不足",
  "Chunk 准备度",
  "GEO optimizer",
  "AI Bot PV",
  "AI crawler 可访问性",
  "FAQ / Schema 完整度"
]);

addContentCheck("knowledge import subpage and matrix entry", "src/app/knowledge/page.tsx", [
  "管理内容资产",
  "/knowledge/import",
  "导入资料",
  "批量选择",
  "合并知识库",
  "批量向量化",
  "编辑详情",
  "删除",
  "rowSelection",
  "handleMergeSelected"
]);
addAbsentCheck("knowledge no visible trust filter", "src/app/knowledge/page.tsx", ["可信等级", "trustLevelFilter", "trustLevelLabels"]);
addAbsentCheck("knowledge list no visible chunk wording", "src/app/knowledge/page.tsx", ["title: \"Chunk\"", "生成 Chunk", "资产和 Chunk"]);

addContentCheck("knowledge detail focused tabs", "src/app/knowledge/[id]/page.tsx", [
  "编辑详情",
  "编辑基础信息",
  "重新向量化",
  "内容预览",
  "追加资料",
  "切片与向量化记录",
  "关联蒸馏词",
  "更新记录",
  "保存并重新切片",
  "确认解析并向量化",
  "pending_config",
  "handleAppendSources",
  "handleVectorize"
]);
addAbsentCheck("knowledge detail no visible chunk wording", "src/app/knowledge/[id]/page.tsx", [
  "个 Chunk",
  "证据 Chunk",
  "查看来源 Chunk",
  "产品表达规则包来源 Chunk",
  "来源 Chunk",
  "还没有 Chunk",
  "暂无可用来源 Chunk",
  "confidence >= 0.65"
]);

addContentCheck("knowledge import pages", "src/app/knowledge/import/page.tsx", [
  "URL 导入",
  "文档导入",
  "服务端解析器",
  "/knowledge/import/url",
  "/knowledge/import/document",
  "/knowledge/vectorize",
  "/knowledge/rule-packages"
]);
addContentCheck("knowledge import rule package linkage", "src/app/knowledge/import/url/page.tsx", [
  "规则包处理方式",
  "关联已有规则包",
  "linkedProductExpressionRulePackageId",
  "productExpressionRulePackageMode"
]);
addContentCheck("knowledge document import rule package linkage", "src/app/knowledge/import/document/page.tsx", [
  "规则包处理方式",
  "关联已有规则包",
  "linkedProductExpressionRulePackageId",
  "productExpressionRulePackageMode",
  "/api/knowledge-bases/parse-documents",
  "FormData"
]);
addContentCheck("knowledge document parser api", "src/app/api/knowledge-bases/parse-documents/route.ts", [
  "parseKnowledgeDocumentsFromFormData",
  "multipart/form-data",
  "failedCount"
]);
addContentCheck("knowledge document parser service", "src/lib/knowledge-document-parser.ts", [
  "execFile",
  "mammoth",
  "parse-pdf-text.mjs",
  "parseKnowledgeDocumentFile",
  ".docx",
  ".pdf"
]);
addContentCheck("knowledge url blog index expansion", "src/lib/workbench-store.ts", [
  "isLoadingOnlyKnowledgeText",
  "expandBlogIndexFromSitemap",
  "isLikelyBlogIndexUrl",
  "startKnowledgeSiteImportJob",
  "startKnowledgeAutoImport",
  "importedUrls",
  "正在加载文章",
  "/sitemap.xml",
  "\\/articles\\/"
]);
addContentCheck("knowledge auto import api", "src/app/api/knowledge-bases/[id]/auto-import/route.ts", [
  "startKnowledgeAutoImport",
  "pending_input"
]);
addContentCheck("knowledge pdf parser subprocess", "scripts/parse-pdf-text.mjs", [
  "PDFParse",
  "getText",
  "JSON.stringify"
]);
addContentCheck("knowledge vectorize page", "src/app/knowledge/vectorize/page.tsx", [
  "切片与向量化",
  "待解析知识库列表",
  "Embedding 模型",
  "检索策略",
  "确认解析",
  "pending_config",
  "/api/knowledge-bases/vectorize"
]);
addContentCheck("knowledge rule packages page", "src/app/knowledge/rule-packages/page.tsx", [
  "产品表达规则包",
  "新建规则包",
  "产品名称",
  "选择已有知识库",
  "关联导入资料",
  "linkedProductExpressionRulePackageId",
  "允许表达",
  "禁止表达",
  "确认生效",
  "回滚上一版本"
]);

addContentCheck("knowledge product expression api role guard", "src/app/api/knowledge-bases/[id]/product-expression/route.ts", [
  "canManageProductExpressionRules",
  "readWorkbenchState",
  "403",
  "activateProductExpressionRuleDraft",
  "regenerateProductExpressionRuleDraft",
  "rollbackProductExpressionRuleDraft",
  "discardProductExpressionRuleDraft",
  "action === \"discard\""
]);

addContentCheck("distilled terms v4 pool and actions", "src/app/distilled-terms/page.tsx", [
  "蒸馏词池",
  "自动入池来源",
  "知识库生成",
  "GEO 缺口生成",
  "待确认规则",
  "从搜索问题提取蒸馏词",
  "/api/distilled-terms/extract",
  "/api/distilled-terms/auto-pool",
  "/api/distilled-terms/rule-drafts/",
  "达到阈值自动入池",
  "未通过阈值直接丢弃",
  "待确认规则建议",
  "generationModeLabels",
  "validationStatusLabels",
  "handleAutoPoolTerms",
  "handleActivateRuleDraft",
  "handleDiscardRuleDraft",
  "入池方式",
  "入池结果",
  "来源资产",
  "候选词未通过入池阈值，已直接丢弃。",
  "handleArchiveTerm",
  "handleDeleteTerm",
  "来源问题",
  "使用记录",
  "distilled-auto-pool-knowledge",
  "distilled-auto-pool-geo",
  "distilled-auto-pool-all",
  "distilled-question-input",
  "distilled-extract-button",
  "distilled-rule-draft-card",
  "distilled-rule-draft-activate-",
  "distilled-rule-draft-discard-",
  "distilled-term-table",
  "distilled-term-generation-mode-",
  "distilled-term-detail-",
  "distilled-term-detail-source-question"
]);

addContentCheck("distilled term rule draft api contract", "src/app/api/distilled-terms/rule-drafts/[id]/route.ts", [
  "activateDistilledTermRuleDraft",
  "discardDistilledTermRuleDraft",
  "export async function PATCH",
  "export function DELETE",
  "status: result.ok ? 200 : 400"
]);

addAbsentCheck("distilled terms no confidence score in frontend", "src/app/distilled-terms/page.tsx", [
  "置信度",
  "confidence {",
  "formatConfidence"
]);

addContentCheck("distilled term extract api threshold", "src/app/api/distilled-terms/extract/route.ts", [
  "extractDistilledTermFromQuestion",
  "readRequestPayload",
  "status: result.ok ? 200 : 400"
]);

addContentCheck("distilled term auto pool api contract", "src/app/api/distilled-terms/auto-pool/route.ts", [
  "autoPoolDistilledTerms",
  "readRequestPayload",
  "status: result.ok ? 200 : 400"
]);

addContentCheck("distilled term action api explicit archive delete", "src/app/api/distilled-terms/[id]/route.ts", [
  "archiveDistilledTerm",
  "deleteDistilledTerm",
  "action !== \"archive\"",
  "不支持的蒸馏词操作",
  "status: 400",
  "export function DELETE"
]);

addContentCheck("weekly plan consumes pooled distilled terms", "src/lib/workbench-store.ts", [
  "distilledTermSignals",
  "primaryDistilledTerm: item.term",
  "product: item.product",
  "buildTaskPlanContext(product, contentType, businessSignal?.sourceProblem, businessSignal?.primaryDistilledTerm)",
  "targetKeywords: planContext.targetKeywords",
  "state.distilledTerms = normalizeDistilledTerms([nextTerm, ...state.distilledTerms.filter((term) => term.id !== existing.id)])",
  "autoPoolDistilledTerms",
  "getKnowledgeBaseDistilledTermCandidates",
  "getGeoGapDistilledTermCandidates",
  "defaultDistilledTermExtractionRules",
  "distilledTermSemanticTemplates",
  "upsertDistilledTermRuleDraft",
  "activateDistilledTermRuleDraft",
  "discardDistilledTermRuleDraft",
  "generationMode: \"knowledge_base\"",
  "generationMode: \"geo_gap\""
]);

addContentCheck("smoke workflow distilled term lifecycle", "scripts/smoke-workflow.mjs", [
  "distilled_term_low_confidence_discarded",
  "distilled_term_search_question_auto_pool",
  "distilled_term_rule_draft_created",
  "distilled_term_rule_draft_activated",
  "distilled_term_knowledge_base_auto_pool",
  "distilled_term_geo_gap_auto_pool",
  "distilled_term_patch_rejects_unsupported_action",
  "distilled_term_archive",
  "distilled_term_delete",
  "/api/distilled-terms/extract",
  "/api/distilled-terms/auto-pool",
  "不支持的蒸馏词操作。"
]);

addContentCheck("distribution api route contracts", "src/app/api/distribution/wechatsync/status/route.ts", [
  "getWechatsyncStatus",
  "force-dynamic",
  "export async function GET"
]);
addContentCheck("distribution auth api route contracts", "src/app/api/distribution/wechatsync/check-auth/route.ts", [
  "readRequestPayload",
  "checkDistributionPlatformAuth",
  "export async function POST"
]);
addContentCheck("distribution target preparation api route contracts", "src/app/api/publish-records/[id]/distribution-targets/route.ts", [
  "readRequestPayload",
  "createDistributionTargetsForPublishRecord",
  "params.id",
  "export async function POST"
]);
addContentCheck("distribution send draft api route contracts", "src/app/api/distribution-targets/[id]/send-draft/route.ts", [
  "sendDistributionTargetDraft",
  "params.id",
  "export async function POST"
]);
addContentCheck("smoke workflow distribution draft lifecycle", "scripts/smoke-workflow.mjs", [
  "distribution_wechatsync_status",
  "distribution_wechatsync_auth_check",
  "distribution_target_prepare",
  "distribution_target_send_draft",
  "distribution_draft_keeps_publish_record_queued",
  "/api/distribution/wechatsync/status",
  "/api/distribution/wechatsync/check-auth",
  "/api/publish-records/${record.id}/distribution-targets",
  "/api/distribution-targets/${preparedTarget.id}/send-draft",
  "publishStatus === \"queued\""
]);

addContentCheck("weekly report v4 matrix", "src/app/weekly-report/page.tsx", [
  "进入周计划生成预览",
  "内容增长视角",
  "工作台运营视角",
  "canViewAiGovernance",
  "canManageWeeklyReportSuggestions",
  "canViewOpsReport",
  "canDecideWeeklySuggestions",
  "showOpsView",
  "workspaceSetting.currentRole",
  "targetTotalCount",
  "reportTargetTotalCount",
  "const reportPromptTemplates = canViewOpsReport ? activeReport?.promptTemplates || [] : []",
  "本周基础 KPI",
  "发布完成率",
  "数据回传率",
  "AI 复盘结论",
  "下周建议",
  "带入周计划草稿",
  "handleCreateNextPlan",
  "/api/weekly-reports/${activeReport.week}/next-plan",
  "建议失败原因 Top 5",
  "decisionReasons",
  "填写原因",
  "模块执行情况",
  "计划质量反馈详情",
  "planQualityFeedback",
  "recommendationOutcomes",
  "内部学习样本",
  "进入 AI 配置"
]);

addContentCheck("weekly report current week fallback filters", "src/app/weekly-report/page.tsx", [
  "filterPublishRecordsForReport",
  "filterBlogDiagnosticsForReport",
  "filterGeoResultsForReport",
  "fallbackReportPublishRecords",
  "fallbackReportBlogDiagnostics",
  "fallbackReportGeoResults",
  "weeklyPlan.weekStart",
  "activeReport?.geoResults || fallbackReportGeoResults"
]);

addContentCheck("weekly report conditional geo summary", "src/lib/workbench-store.ts", [
  "const geoSummary = weeklyGeoResults.length",
  "已发布 ${published} 篇${geoSummary}；AI 访问量"
]);
addAbsentCheck("dashboard and weekly report no visible ai bot pv wording", "src/app/page.tsx", ["AI Bot PV", "AI Bot 日志", "Demo PV"]);
addAbsentCheck("weekly report no visible ai bot pv wording", "src/app/weekly-report/page.tsx", ["AI Bot 指标", "Demo Bot PV"]);
addAbsentCheck("weekly report store no ai bot pv summary", "src/lib/workbench-store.ts", ["AI Bot PV"]);

addContentCheck("weekly report geo drawer business fields", "src/app/weekly-report/page.tsx", [
  "getGeoBusinessGap",
  "getGeoBusinessNextStep",
  "官网引用情况",
  "问题缺口",
  "下一步动作",
  "`/geo-test/${record.id}`",
  "AI 可见度变化"
]);

addAbsentCheck("weekly report no raw technical main modules", "src/app/weekly-report/page.tsx", [
  "固定 Prompt 模板",
  "GEO 测试明细\" style",
  "蒸馏词矩阵复盘\" style",
  "openDetailDrawer(\"prompt\")",
  "内部 Prompt 版本",
  "detailDrawer === \"prompt\"",
  "建议后验评估详情",
  "openDetailDrawer(\"recommendation_outcomes\")",
  "detailDrawer === \"recommendation_outcomes\"",
  "rawReasons",
  "activeReport?.promptTemplates || promptTemplates",
  "import { promptTemplates",
  "Prompt 版本",
  "Prompt / AI 配置",
  "模型 trace",
  "证据 Chunk",
  "完成率变化",
  "回传率变化",
  "渠道表现变化",
  "GEO 变化",
  "官网引用变化",
  "模型学习信号",
  "AI Provider",
  "const reportGeoResults = activeReport?.geoResults || geoResults;",
  "本周没有 GEO 动作，周报不展示 GEO 复盘模块。",
  "title: \"引用层级\""
]);

addContentCheck("weekly report api role filter", "src/app/api/weekly-reports/[week]/route.ts", [
  "getWeeklyReportForRole",
  "readWorkbenchState",
  "state.workspaceSetting.currentRole",
  "force-dynamic"
]);

addContentCheck("weekly report suggestion api role filter", "src/app/api/weekly-reports/[week]/suggestions/[id]/route.ts", [
  "canManageWeeklyReportSuggestions",
  "403",
  "decideWeeklyReportSuggestion",
  "filterWeeklyReportForRole",
  "readWorkbenchState",
  "state.workspaceSetting.currentRole"
]);

addContentCheck("role aware governance entry", "src/components/GovernanceEntry.tsx", [
  "canViewRoute",
  "切换角色",
  "/ai-config",
  "/settings"
]);
addAbsentCheck("global no prompt bubbles", "src/components/AppShell.tsx", ["Tooltip", "Popover"]);
addAbsentCheck("governance entry no prompt bubbles", "src/components/GovernanceEntry.tsx", ["Tooltip", "Popover"]);

addContentCheck("role route boundary business wording", "src/components/AppShell.tsx", [
  "当前角色无权进入此页面",
  "内部治理配置和排查信息",
  "不会渲染"
]);
addAbsentCheck("role route boundary no prompt wording", "src/components/AppShell.tsx", [
  "Prompt、模型日志、规则包"
]);

addContentCheck("client fallback least privilege", "src/lib/client-state.ts", [
  "initialSnapshot",
  "usingFallback",
  "currentRole: \"content_publisher\"",
  "promptVersions: []"
]);
addAbsentCheck("client fallback no governance seed", "src/lib/client-state.ts", [
  "import { promptTemplates }",
  "currentRole: \"workbench_operator\"",
  "promptTemplates.map"
]);

addContentCheck("smoke pages role preparation", "scripts/smoke-pages.mjs", [
  "resolveCurrentRole",
  "setCurrentRole(\"workbench_operator\")",
  "setCurrentRole(previousRole)",
  "/api/workspace-settings",
  "target.path.startsWith(\"/api/\")",
  "hasHtmlShell"
]);

addContentCheck("smoke browser role preparation", "scripts/smoke-browser.mjs", [
  "resolveCurrentRole",
  "setCurrentRole(\"workbench_operator\")",
  "setCurrentRole(previousRole)",
  "prepareValidPublishMatrix",
  "prepare_weekly_publish_matrix",
  "assertAiConfigRestrictedRole",
  "ai_config_restricted_content_publisher",
  "当前角色无权进入此页面",
  "Prompt、模型日志、规则包",
  "wait_workspace_role_loaded",
  "工作台运营 / 质量评估",
  "child.kill()",
  "45000",
  "Unable to find clickable",
  "/api/workspace-settings"
]);

addContentCheck("smoke browser responsive high-density pages", "scripts/smoke-browser.mjs", [
  "normalizeScope",
  "full\", \"roles\", \"content\", \"responsive\", \"publish",
  "scope: smokeScope",
  "shouldRunRoles",
  "shouldRunContent",
  "shouldRunResponsive",
  "shouldRunPublish",
  "setViewport",
  "buildResponsiveAuditExpression",
  "assertResponsiveLayout",
  "beforeAudit",
  "clickButtonByText",
  "clickElementByText",
  "clickElementBySelector",
  "resolveCurrentGeoResultId",
  "resolveActionableGeoGapResult",
  "resolveKnowledgeBaseWithRuleDraftId",
  "ensureVisibleDistilledTerm",
  "resolveDistilledTermByQuestion",
  "generateWeeklyPlanFromDistilledTerm",
  "prepareLowConfidencePlanTask",
  "prepareConfirmedBriefTask",
  "prepareActivatedRulePackageForBrief",
  "prepareConfirmedBriefTaskForRulePackage",
  "prepareDraftRiskReviewTask",
  "resolveDistributionTargetsForTask",
  "businessPageForbiddenText",
  "businessPageBoundaryExpectations",
  "assertBusinessPageBoundary",
  "beforeAssert",
  "dynamicBusinessPageBoundaryExpectations",
  "business_boundary_content_publisher_weekly_plan",
  "business_boundary_content_growth_geo",
  "business_boundary_content_growth_geo_detail",
  "business_boundary_content_growth_weekly_report_publish_drawer",
  "business_boundary_knowledge_manager_knowledge",
  "business_boundary_knowledge_manager_knowledge_detail",
  "business_boundary_knowledge_manager_rule_version_drawer",
  "weekly_plan_batch_confirm_guard_modal",
  "today_brief_drawer_evidence_guard",
  "knowledge_rule_package_today_brief_inheritance",
  "knowledge_rule_package_draft_generation_inheritance",
  "distilled_term_search_question_ui_auto_pool",
  "distilled_term_low_confidence_ui_discarded",
  "distilled_term_weekly_plan_inheritance",
  "geo_gap_detail_to_weekly_plan_inheritance",
  "geo_gap_detail_to_knowledge_inheritance",
  "draft_qa_risk_actions_dom",
  "weekly_report_next_plan_source_inheritance",
  "publish_data_return_manual_metrics_dom_refresh",
  "weekly_report_publish_drawer_metrics_inheritance",
  "find_today_write_platform_drafts_button",
  "click_today_write_platform_drafts",
  "click_today_write_platform_drafts_confirm",
  "today_platform_draft_created_before_publish_confirm",
  "weekly-plan-batch-confirm-button",
  "today-brief-",
  "today-brief-rule-package-",
  "today-brief-rule-source-",
  "today-brief-rule-version-",
  "today-brief-rule-summary-",
  "today-write-platform-drafts-",
  "today-write-platform-drafts-confirm-",
  "distilled-question-input",
  "geo-detail-create-knowledge-button-",
  "knowledge-detail-source-card",
  "knowledge-detail-preview-card",
  "distilled-extract-button",
  "distilled-term-generation-mode-",
  "distilled-term-detail-",
  "distilled-term-detail-source-question",
  "weekly-report-generate-button",
  "weekly-report-next-plan-button",
  "weekly-report-next-plan-confirm",
  "publish-metrics-",
  "publish-metrics-save-button",
  "bodyOverflow",
  "offscreen",
  "textOverflow",
  "responsive_weekly_plan_mobile",
  "responsive_weekly_plan_expanded_mobile",
  "responsive_draft_qa_mobile",
  "responsive_weekly_report_mobile",
  "responsive_weekly_report_drawer_mobile",
  "responsive_geo_detail_mobile",
  "responsive_knowledge_rule_version_drawer_mobile",
  "responsive_knowledge_source_drawer_mobile",
  "responsive_distilled_term_drawer_mobile",
  "responsive_ai_config_call_log_drawer_mobile",
  "responsive_ai_config_prompt_version_drawer_mobile",
  "responsive_ai_config_quality_drawer_mobile",
  "390, 844, false",
  "周计划生成预览",
  "正文 Markdown 编辑",
  "内容增长视角",
  "AI 生成理由",
  "查看发布明细",
  "发布与渠道明细",
  "GEO 详情",
  "产品表达规则包版本差异",
  "产品表达规则包来源片段",
  "蒸馏词详情",
  "调用日志详情",
  "Prompt 版本说明",
  "质检反馈详情",
  "批量确认前复核",
  "未达到自动确认阈值",
  "生成 Brief 与证据选择",
  "正文生成会锁定周计划字段",
  "确认加入周计划草稿",
  "GEO 问题缺口",
  "高风险！问题",
  "保留高风险片段",
  "rawAnswer",
  "rawCitationUrl",
  "citationRank",
  "embeddingSimilarity",
  "ruleHit",
  "issueCode",
  "知识库 Chunk",
  "证据 Chunk"
]);

addContentCheck("package split browser smoke scripts", "package.json", [
  "smoke:browser:roles",
  "smoke:browser:content",
  "smoke:browser:content:isolated",
  "smoke:browser:responsive",
  "smoke:browser:publish",
  "--scope=roles",
  "--scope=content",
  "--scope=responsive",
  "--scope=publish"
]);

addContentCheck("mobile shell responsive css", "src/app/globals.css", [
  "@media (max-width: 760px)",
  ".app-shell.ant-layout-has-sider",
  ".app-shell.ant-layout-has-sider > .ant-layout",
  ".app-shell > .ant-layout-sider",
  ".app-shell .ant-layout-header",
  ".app-shell .ant-layout-content",
  ".ant-drawer-content-wrapper",
  ".ant-tabs-content-holder",
  ".ant-tabs-tabpane",
  ".two-column > .ant-card",
  ".draft-qa-status-card",
  ".report-kpi-value",
  ".weekly-plan-generate-form",
  ".weekly-plan-table-filters",
  ".ant-table-wrapper .ant-table",
  ".ant-table-wrapper .ant-table-container",
  ".report-section > .ant-card",
  ".report-kpi-card .ant-card-body"
]);

addContentCheck("smoke interactions weekly report excludes merged", "scripts/smoke-interactions.mjs", [
  "const weeklyReportInternalExcludes = [",
  "const weeklyReportBusinessExcludes = [",
  "excludes: [...weeklyReportInternalExcludes, ...weeklyReportBusinessExcludes]"
]);

addContentCheck("isolated smoke workflow runner", "scripts/smoke-workflow-isolated.mjs", [
  "WORKBENCH_STATE_PATH",
  "NEXT_DIST_DIR",
  ".next-smoke-workflow-",
  "removeInsideWorkspace",
  "data/workbench-smoke-state.json",
  "3057",
  "scripts/smoke-workflow.mjs",
  "taskkill",
  "recentLogs"
]);
addContentCheck("package isolated smoke script", "package.json", ["smoke:workflow:isolated"]);
addContentCheck("usage isolated smoke docs", "docs/usage.md", ["smoke:workflow:isolated", "data/workbench-smoke-state.json"]);
addContentCheck("readme isolated smoke command", "README.md", ["smoke:workflow:isolated"]);
addContentCheck("isolated browser smoke runner", "scripts/smoke-browser-isolated.mjs", [
  "smoke-browser-isolated",
  "WORKBENCH_STATE_PATH",
  "NEXT_DIST_DIR",
  ".next-smoke-browser-",
  "removeInsideWorkspace",
  "data/workbench-browser-smoke-state.json",
  "scripts/smoke-browser.mjs",
  "--scope"
]);
addContentCheck("package isolated browser smoke script", "package.json", ["smoke:browser:content:isolated", "smoke-browser-isolated.mjs"]);
addContentCheck("usage isolated browser smoke docs", "docs/usage.md", ["smoke:browser:content:isolated", "data/workbench-browser-smoke-state.json"]);
addContentCheck("readme isolated browser smoke command", "README.md", ["smoke:browser:content:isolated"]);

addContentCheck("permissions role helpers", "src/lib/permissions.ts", [
  "workspaceRouteLabels",
  "getDefaultRouteForRole",
  "canViewAiGovernance",
  "canManagePromptVersions",
  "canManageProductExpressionRules",
  "canManageWeeklyReportSuggestions"
]);

addContentCheck("mysql bridge large state buffer", "src/lib/repositories/mysql-bridge.ts", [
  "MYSQL_BRIDGE_MAX_BUFFER_BYTES",
  "bridgeMaxBufferBytes",
  "maxBuffer: bridgeMaxBufferBytes"
]);

addContentCheck("business pages use governance entry", "src/app/real-integration/page.tsx", [
  "GovernanceEntry",
  "真实接入配置属于工作台运营和开发管理员职责"
]);
addContentCheck("real integration business wording", "src/app/real-integration/page.tsx", [
  "模型接入",
  "模型接入试跑",
  "真实测试问题",
  "AI 访问量",
  "AI 访问数据可信度"
]);
addAbsentCheck("real integration no legacy ai bot provider wording", "src/app/real-integration/page.tsx", [
  "AI Provider",
  "AI Bot PV",
  "AI Bot 数据可信度",
  "真实 Prompt",
  "GEO Prompt"
]);

addContentCheck("geo pages use governance entry", "src/app/geo-test/page.tsx", [
  "GovernanceEntry",
  "GEO 模型配置属于工作台运营权限"
]);

addContentCheck("geo detail uses governance entry", "src/app/geo-test/[id]/page.tsx", [
  "GovernanceEntry",
  "GEO 测试配置需要工作台运营或开发管理员处理"
]);

addContentCheck("geo provider retry guard", "src/lib/workbench-store.ts", [
  "geoTestMaxRetries = 1",
  "geoTestRetryDelayMs",
  "callGeoAiProviderWithRetry",
  "shouldRetryGeoAiResult",
  "已间隔"
]);

addContentCheck("ai config v4 call log governance", "src/app/ai-config/page.tsx", [
  "调用日志",
  "产品表达规则包",
  "productExpressionRuleVersion",
  "productExpressionRuleSource",
  "channelLabels",
  "productLabels",
  "contentTypeLabels",
  "buildCountRows",
  "buildDraftQualityRows",
  "failureReasonSummary",
  "productExpressionRuleSummary",
  "promptVersionSummary",
  "qualityAssociationRows",
  "qaBlockedDraftCount",
  "publishedDraftCount",
  "dataReturnedDraftCount",
  "editActionCount",
  "manualEditActionCount",
  "deletedRiskSegmentCount",
  "keptRiskSegmentCount",
  "qaAcceptedActionCount",
  "qaPartialAcceptedActionCount",
  "qaIgnoredActionCount",
  "qaSuspectedFalsePositiveCount",
  "qaSuspectedMissCount",
  "qaIssueRuleSummary",
  "totalChangedCharacterCount",
  "manualEditChangedCharacterCount",
  "rewriteChangedCharacterCount",
  "maxChangedRatio",
  "averageChangedRatio",
  "manualEditAverageChangedRatio",
  "heavyEditCount",
  "editReasonSummary",
  "editReasonCategorySummary",
  "keepRiskReasonCategorySummary",
  "selectedQualityRow",
  "qaDecisionCount",
  "qaAdoptionRate",
  "averageEditRatio",
  "editRatioSamples",
  "运营判断摘要",
  "失败原因 Top 5",
  "质检问题类型 Top 5",
  "规则包使用分布",
  "Prompt 使用分布",
  "质量关联摘要",
  "未记录渠道",
  "未记录产品",
  "未记录蒸馏词",
  "质检通过",
  "发布率",
  "回传率",
  "人工处理动作",
  "人工直接编辑",
  "删除风险片段",
  "保留高风险",
  "质检采纳动作",
  "质检部分采纳",
  "人工忽略质检",
  "疑似误报信号",
  "疑似漏检信号",
  "正文改动字符",
  "平均编辑比例",
  "重度编辑稿件",
  "编辑原因记录",
  "编辑原因 Top 5",
  "编辑原因分类 Top 5",
  "高风险保留原因分类",
  "平均改动",
  "改动强度",
  "编辑原因",
  "原因分类",
  "质检采纳",
  "疑似误报",
  "疑似漏检",
  "质检反馈详情",
  "这里展示的是质检反馈运营信号",
  "反馈动作",
  "问题类型",
  "正文改动比例来自轻量 diff 估算",
  "人工处理",
  "AI 改写",
  "已回传数据",
  "Prompt 版本",
  "输入摘要",
  "不展示密钥、完整 Prompt 原文或模型 trace"
]);

addContentCheck("store business api messages", "src/lib/workbench-store.ts", [
  "未选择知识库证据片段",
  "已选证据片段 ID",
  "候选词未通过入池阈值",
  "已更新来源问题和入池记录"
]);
addAbsentCheck("store no legacy business api messages", "src/lib/workbench-store.ts", [
  "未选择知识库 Chunk",
  "已选证据 Chunk",
  "候选词置信度",
  "来源问题和置信度"
]);
addContentCheck("log import business message", "src/lib/log-import-adapter.ts", ["AI 访问量汇总"]);
addAbsentCheck("log import no ai bot summary", "src/lib/log-import-adapter.ts", ["AI Bot 汇总"]);
addContentCheck("bot visit summary business message", "src/app/api/bot-visit-summary/route.ts", ["AI 访问量指标"]);
addAbsentCheck("bot visit summary no ai bot wording", "src/app/api/bot-visit-summary/route.ts", ["AI Bot 指标"]);
addContentCheck("ai governance business summaries", "src/app/api/ai-governance/route.ts", [
  "AI 访问日志",
  "通过真实模型接入生成正文",
  "本地兜底稿"
]);
addAbsentCheck("ai governance no legacy provider bot summary", "src/app/api/ai-governance/route.ts", [
  "AI Bot 日志",
  "真实 AI Provider",
  "fallback 到本地规则"
]);

addContentCheck("ai config page level governance guard", "src/app/ai-config/page.tsx", [
  "const canViewFullGovernance = governanceData.access?.canViewFullGovernance === true",
  "if (!canViewFullGovernance)",
  "setCapabilities([])",
  "setDiagnostics({})",
  "actions={",
  "canViewFullGovernance ? (",
  "renderRestrictedGovernance()",
  "const pageHeaderTitle = canViewFullGovernance ? \"AI 配置\" : \"治理权限说明\"",
  "当前角色只看到业务引导；发布、复盘和知识库维护在对应页面继续处理。",
  "当前角色不显示模型与规则治理详情",
  "getDefaultRouteForRole",
  "getRouteLabel",
  "去{getRouteLabel(defaultRoute)}",
  "内容发布人员继续处理今日发布、草稿质检和数据回填。"
]);

addContentCheck("ai governance restricted business message", "src/app/api/ai-governance/route.ts", [
  "当前角色只显示受限入口；模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"
]);

addContentCheck("prompt version api restricted business message", "src/app/api/prompt-versions/[id]/route.ts", [
  "当前角色无权查看模型规则版本详情。",
  "当前角色无权回滚模型规则版本。",
  "不支持的模型规则版本动作"
]);

addAbsentCheck("ai config no local prompt fallback", "src/app/ai-config/page.tsx", [
  "import { promptTemplates",
  "payload.data?.promptTemplates || promptTemplates",
  "promptTemplates,"
]);

addContentCheck("ai governance api task dimensions", "src/app/api/ai-governance/route.ts", [
  "taskById",
  "publishRecordByDraftId",
  "taskId",
  "channel",
  "product",
  "contentType",
  "primaryDistilledTerm",
  "editReasonCategoryLabels",
  "keepRiskReasonCategoryLabels",
  "getEditReasonCategory",
  "editActionCount",
  "manualEditActionCount",
  "deleteRiskSegmentCount",
  "keepRiskSegmentCount",
  "qaAcceptedActionCount",
  "qaPartialAcceptedActionCount",
  "qaIgnoredActionCount",
  "qaSuspectedFalsePositiveCount",
  "qaSuspectedMissCount",
  "qaIssueRuleSummary",
  "totalChangedCharacterCount",
  "manualEditChangedCharacterCount",
  "rewriteChangedCharacterCount",
  "maxChangedRatio",
  "averageChangedRatio",
  "manualEditAverageChangedRatio",
  "heavyEditCount",
  "editReasonSummary",
  "editReasonCategorySummary",
  "keepRiskReasonCategorySummary",
  "qaPassed",
  "qaBlockerCount",
  "qaWarningCount",
  "publishStatus",
  "dataReturned",
  "draftSources",
  "canViewFullGovernance"
]);

addContentCheck("types v4 structures", "src/lib/types.ts", [
  "KnowledgeSourceType",
  "KnowledgeChunk",
  "ProductExpressionRuleSnapshot",
  "previousSnapshot",
  "productExpressionRuleVersion",
  "productExpressionRuleSource",
  "WeeklyPlanGenerationSource",
  "WeeklyPlanGenerationSignal",
  "generationSource",
  "ContentTaskTitleSourceAttribution",
  "titleSourceAttributions",
  "ContentTaskRejectionRecord",
  "rejectionRecords",
  "\"rejected\"",
  "ContentTaskEditRecord",
  "ContentTaskRiskAcceptanceRecord",
  "DraftEditAction",
  "DraftRiskKeepReasonCategory",
  "keepReasonCategory",
  "beforeLength",
  "afterLength",
  "changedCharacterCount",
  "changedRatio",
  "editRecords",
  "riskAcceptanceRecords",
  "WeeklyPlanQualitySignal",
  "WeeklyPlanQualityFeedback",
  "DistilledTerm",
  "contentPreview",
  "chunks?: KnowledgeChunk[]",
  "autoCrawl",
  "distilledTermIds",
  "citationLevel",
  "issueType",
  "suggestedAction",
  "WeeklyRecommendationOutcome",
  "WeeklyReportSnapshot",
  "WeeklyReportDistilledTermMatrixRow",
  "sourceWeek",
  "plannedPublishDate"
]);

addContentCheck("store v4 rules", "src/lib/workbench-store.ts", [
  "defaultDistilledTerms",
  "normalizeKnowledgeBase",
  "buildProductExpressionRuleSnapshot",
  "previousSnapshot",
  "getProductExpressionRuleSelection",
  "productExpressionRuleVersion",
  "productExpressionRuleSource",
  "buildContentTaskEditRecords",
  "getContentTaskReviewReasons",
  "appendContentTaskRiskAcceptanceRecord",
  "riskAcceptanceReason",
  "getTextDiffStats",
  "inferKeepRiskReasonCategory",
  "normalizeKeepRiskReasonCategory",
  "changedCharacterCount",
  "changedRatio",
  "hasUsableEvidenceSelection",
  "buildMissingEvidenceItem",
  "getPublishMatrixIssues",
  "patchWeeklyPlan",
  "buildWeeklyPlanGenerationSource",
  "createWeeklyPlanSignal",
  "generationSource",
  "getWeeklyPlanTaskSignals",
  "pickWeeklyPlanTaskSignal",
  "isDateInReportWeek",
  "isSameReportWeek",
  "normalizeReportWeek",
  "buildPublishRecordWeekFields",
  "weeklyReportSnapshots",
  "buildWeeklyReportFromState",
  "createWeeklyReportSnapshot",
  "hydrateWeeklyReportSnapshot",
  "getWeeklyPublishRecordsForReport",
  "getWeeklyBlogDiagnosticsForReport",
  "getWeeklyGeoResultsForReport",
  "sourceWeek",
  "plannedPublishDate",
  "targetTotalCount",
  "filterWeeklyReportForRole",
  "getWeeklyReportForRole",
  "buildContentTaskTitleSourceAttributions",
  "titleSourceAttributions",
  "rejectContentTask",
  "restoreRejectedContentTask",
  "appendContentTaskRejectionRecord",
  "rejectionRecords",
  "discardProductExpressionRuleDraft",
  "buildWeeklyPlanQualityFeedback",
  "planQualityFeedback",
  "empty_total",
  "single_day_too_high",
  "周发布设置已保存",
  "editRecords",
  "splitKnowledgeContent",
  "normalizeDistilledTerms",
  "distilledTerms",
  "promptVersions",
  "getActivePromptVersion",
  "getActivePromptVersion(state, \"weekly_plan_generation\")",
  "getActivePromptVersion({ promptVersions }, \"evidence_selection\")",
  "getActivePromptVersion({ promptVersions }, \"batch_body_generation\")",
  "getActivePromptVersion({ promptVersions }, \"draft_second_qa\")",
  "buildRecommendationOutcomes",
  "recommendationOutcomes",
  "distilledTermMatrix",
  "sectionIndex",
  "用户问题",
  "getGeoCitationLevel",
  "getGeoIssueType",
  "getGeoSuggestedAction"
]);

addAbsentCheck("weekly report markdown no internal signals", "src/lib/workbench-store.ts", ["## 6. 内部优化信号"]);
addAbsentCheck("weekly report markdown no technical prompt label", "src/lib/workbench-store.ts", ["| 平台 | Prompt |"]);

addContentCheck("prompt templates fixed", "src/lib/prompt-templates.ts", [
  "weekly_plan_generation",
  "channel_title",
  "evidence_selection",
  "batch_body_generation",
  "draft_second_qa",
  "version",
  "inputContract",
  "outputContract",
  "failureRules"
]);

addContentCheck("platform expression precheck contract", "src/lib/prompt-templates.ts", [
  "platformContentType",
  "platformExpressionProfileId",
  "titleCategory",
  "targetAudience",
  "evidenceBasis",
  "evidenceSupported",
  "bodyProvable",
  "roleBoundarySafe"
]);

addContentCheck("V5 knowledge workflow policy", "src/lib/v5-knowledge-workflow-policy.ts", [
  "evaluateV5KnowledgeWorkflow",
  "V5_KNOWLEDGE_WORKFLOW_RULES",
  "V5-KB-001",
  "V5-KB-005",
  "V5-KB-009",
  "V5-KB-010",
  "V5-KB-014",
  "V5-KB-015"
]);
addContentCheck("V5 knowledge workflow policy tests", "scripts/v5-knowledge-workflow-policy.test.mjs", [
  "sensitive data blocks claim extraction",
  "approved matrix with final evidence",
  "local preview cannot enter publish schedule",
  "published state requires external success"
]);
addContentCheck("V5 knowledge workflow package script", "package.json", ["test:v5-workflow"]);
addContentCheck("platform expression task fields", "src/lib/types.ts", [
  "platformContentType",
  "platformExpressionProfileId",
  "platformExpressionProfileVersion",
  "titleCategory",
  "targetAudience",
  "titleEvidenceBasis",
  "platformExpressionPrecheck"
]);
addContentCheck("platform expression confirmation guard", "src/lib/workbench-store.ts", [
  "buildPlatformExpressionPreparation",
  "getPlatformExpressionBlockingReasons",
  "平台表达准备未完成或三项前置检查未通过",
  "标题证据依据待补",
  "标题承诺缺少正文来源问题",
  "标题人机角色边界需复核"
]);
addContentCheck("weekly plan platform expression display", "src/app/weekly-plan/page.tsx", [
  "平台表达准备",
  "平台内容类型",
  "标题类别 / 受众",
  "标题证据依据",
  "三项前置检查"
]);

addRegexCheck("new task publish api", "src/app/api/content-tasks/[id]/published/route.ts", [/export\s+async\s+function\s+PATCH/]);
addRegexCheck("new task url api", "src/app/api/content-tasks/[id]/url/route.ts", [/export\s+async\s+function\s+PATCH/]);
addContentCheck("weekly plan matrix save api", "src/app/api/weekly-plans/[id]/route.ts", ["patchWeeklyPlan", "result.ok ? 200 : 400"]);
addContentCheck("new task review api", "src/app/api/content-tasks/[id]/review/route.ts", ["rejectContentTask", "restoreRejectedContentTask", "action === \"restore\"", "action === \"reject\""]);
addContentCheck("single generate evidence guard api", "src/app/api/content-tasks/[id]/generate/route.ts", ["generateDraftForTask", "result.status === \"pending_input\" ? 400 : 404"]);
addContentCheck("batch generate accepts selected ids", "src/app/api/content-tasks/batch-generate/route.ts", ["readRequestPayload", "batchGenerateDrafts(payload)"]);

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  const marker = check.pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${check.label} - ${check.detail}`);
}

console.log("");
console.log(`V4 structure checks: ${checks.length - failed.length}/${checks.length} passed`);

if (failed.length > 0) {
  process.exitCode = 1;
}
