import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const canonicalWorkbenchRoot = process.env.WORKBENCH_CANONICAL_ROOT || join(root, "..", "工作台");
const checks = [];
const migratedV5FoundationFiles = new Set([
  "src/app/knowledge/page.tsx",
  "src/app/knowledge/[id]/page.tsx",
  "src/app/distilled-terms/page.tsx",
  "src/app/ai-config/page.tsx",
  "src/app/real-integration/page.tsx"
]);

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
  if (migratedV5FoundationFiles.has(filePath) && !label.startsWith("v5 foundation")) return;
  const content = read(filePath);
  const missing = needles.filter((needle) => !content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && missing.length === 0,
    detail: missing.length ? `${filePath} missing: ${missing.join(", ")}` : filePath
  });
}

function addAbsentCheck(label, filePath, needles) {
  if (migratedV5FoundationFiles.has(filePath) && !label.startsWith("v5 foundation")) return;
  const content = read(filePath);
  const present = needles.filter((needle) => content.includes(needle));
  checks.push({
    label,
    pass: Boolean(content) && present.length === 0,
    detail: present.length ? `${filePath} should not include: ${present.join(", ")}` : filePath
  });
}

function addRegexCheck(label, filePath, patterns) {
  if (migratedV5FoundationFiles.has(filePath) && !label.startsWith("v5 foundation")) return;
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
  "docs/方案与规划/分支二-月度策略与批量生产开发文档.md",
  "src/lib/prompt-templates.ts",
  "src/lib/client-state.ts",
  "src/app/page.tsx",
  "src/app/weekly-plan/page.tsx",
  "src/app/today/page.tsx",
  "src/app/drafts/[taskId]/page.tsx",
  "src/app/publish/page.tsx",
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
  "src/app/monthly-matrix/content-types/page.tsx",
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
  "src/components/ArticleTypeProfileEditor.tsx",
  "src/components/QuestionTypeMatchPanel.tsx",
  "src/components/EvidenceGateTag.tsx",
  "src/components/PublishStatusTag.tsx",
  "src/components/ExceptionQueuePreview.tsx",
  "src/components/ScheduleCalendarLite.tsx",
  "src/components/V5StatusRail.tsx",
  "src/lib/v5-ui-mock-data.ts",
  "src/lib/v5/monthly-workspace-contracts.ts",
  "src/lib/v5/article-type-contracts.ts",
  "src/lib/v5/article-type-repository.ts",
  "src/lib/v5/article-type-semantic-provider.ts",
  "src/lib/v5/article-type-service.ts",
  "src/lib/v5/monthly-contracts.ts",
  "src/lib/v5/monthly-repository.ts",
  "src/lib/v5/monthly-service.ts",
  "src/lib/v5/monthly-strategy-policy.ts",
  "src/lib/v5/monthly-production-service.ts",
  "src/lib/v5/monthly-plan-repository.ts",
  "src/lib/v5/monthly-plan-service.ts",
  "src/lib/v5/monthly-workspace-governance.ts",
  "src/lib/v5/monthly-workspace-read-model.ts",
  "src/lib/v5/use-monthly-workspace.ts",
  "src/app/api/v5/monthly-workspace/route.ts",
  "src/app/api/v5/monthly-plans/[month]/route.ts",
  "src/app/api/v5/article-type-profiles/route.ts",
  "src/app/api/v5/article-type-profiles/[id]/route.ts",
  "src/app/api/v5/article-type-profiles/[id]/activate/route.ts",
  "src/app/api/v5/article-type-profiles/[id]/supplement/route.ts",
  "src/app/api/v5/article-type-profiles/supplement/route.ts",
  "src/app/api/v5/monthly-plans/[month]/type-match/route.ts",
  "src/app/api/v5/monthly-plans/[month]/type-match/confirm/route.ts",
  "src/app/api/v5/monthly-plans/[month]/strategy-preview/route.ts",
  "src/app/api/v5/monthly-plans/[month]/strategy-approval/route.ts",
  "src/app/api/v5/monthly-plans/[month]/schedule/[taskId]/route.ts",
  "data/v5-article-type-templates.json",
  "scripts/v5-monthly-production.test.mjs",
  "scripts/v5-article-types.test.mjs"
].forEach((filePath) => addFileCheck(`v5 ui file: ${filePath}`, filePath));

[
  "src/app/ai-front-test/page.tsx",
  "src/app/ai-front-test/environment/page.tsx",
  "src/components/FrontendCaptureTaskTable.tsx",
  "src/components/NewCaptureTaskDialog.tsx",
  "src/components/CapturedAnswerWorkspace.tsx",
  "src/components/CitationEvidenceDrawer.tsx",
  "src/components/ObservationGapReviewDrawer.tsx",
  "src/components/CaptureComparisonWorkspace.tsx",
  "src/components/CaptureEnvironmentStatus.tsx",
  "src/components/MonthlyQuestionReviewTable.tsx",
  "src/components/MonthlyQuestionReviewDrawer.tsx",
  "src/components/SiteAuditPanel.tsx",
  "src/components/SiteAuditFindingDrawer.tsx",
  "src/lib/v5/observation-contracts.ts",
  "src/lib/v5/observation-repository.ts",
  "src/lib/v5/observation-reference-adapter.ts",
  "src/lib/v5/observation-service.ts",
  "src/lib/v5/monthly-review-contracts.ts",
  "src/lib/v5/monthly-review-service.ts",
  "src/lib/v5/site-audit-contracts.ts",
  "src/lib/v5/site-audit-service.ts",
  "browser-extension/manifest.json",
  "browser-extension/src/service-worker.js",
  "browser-extension/src/adapters/chatgpt.js",
  "browser-extension/src/content/chatgpt.js",
  "capture-runner/src/server.mjs",
  "scripts/v5-observation-review.test.mjs"
].forEach((filePath) => addFileCheck(`v5 observation file: ${filePath}`, filePath));

addContentCheck("v5 navigation entries", "src/components/AppShell.tsx", [
  "月度内容矩阵",
  "/daily-execution",
  "当日执行",
  "月度复盘",
  "AI 前台测试",
  "数据回传",
  "知识库",
  "问题与关键词池",
  "配置管理",
  "月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘"
]);

addAbsentCheck("site audit has no standalone navigation", "src/components/AppShell.tsx", [
  "/site-audit",
  "官网审计"
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
  "/monthly-matrix/content-types",
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
  "配置月度策略",
  "内容策略包",
  "运行生产预检",
  "批准内容策略包",
  "渠道成品总数",
  "MonthlyStrategyTable",
  "进入批量生成中心",
  "useMonthlyWorkspace",
  "尚未配置月度业务目标",
  "/monthly-matrix/strategy",
  "/monthly-matrix/content-types"
]);

addAbsentCheck("v5 monthly kpi rail no duplicate period", "src/app/monthly-matrix/page.tsx", ['label: "月份"']);
addAbsentCheck("v5 strategy package has no article title table", "src/components/MonthlyMatrixTable.tsx", ["文章标题", "人工排程", "plannedPublishAt"]);

addContentCheck("v5 monthly manual configuration", "src/components/MonthlyPlanConfigPanel.tsx", [
  "月度目标与目标问题",
  "AI 推荐内容组合",
  "类型、渠道和配额",
  "规则包、知识库与版本确认",
  "monthlyProductionReady",
  "mode=\"multiple\"",
  "每渠道配额",
  "渠道成品",
  "sameQuotaForAllChannels",
  "channelQuotas",
  "articleTypeProfileVersionId",
  "articleTypePromptConstraintSnapshotHash",
  "typeMatchRunId",
  "知识库",
  "保存月度策略草稿",
  "配额已平衡"
]);

addAbsentCheck("v5 monthly strategy has no standalone expression preset", "src/components/MonthlyPlanConfigPanel.tsx", [
  "文章表达预设",
  "articleExpressionProfileVersionId",
  "articleExpressionPresets"
]);

addContentCheck("v5 article type contracts", "src/lib/v5/article-type-contracts.ts", [
  "ArticleTypeProfileVersion",
  "QuestionTypeMatchRun",
  "QuestionTypeSuggestion",
  "user_input",
  "ai_suggested",
  "user_confirmed",
  "template_inherited"
]);

addContentCheck("v5 article type repository boundary", "src/lib/v5/article-type-repository.ts", [
  "V5_ARTICLE_TYPE_STATE_PATH",
  "data/v5-article-types.json",
  "temporaryPath",
  "rename(temporaryPath, statePath)",
  "idempotency",
  "auditLog"
]);

addContentCheck("v5 article type service guards", "src/lib/v5/article-type-service.ts", [
  "WRITE_ROLES",
  "requireIdempotencyKey",
  "expectedVersion",
  "ARTICLE_TYPE_VERSION_CONFLICT",
  "TYPE_MATCH_VERSION_CONFLICT",
  "pending_config",
  "selectionStatus",
  "selectionSource"
]);

addContentCheck("v5 content type library", "src/app/monthly-matrix/content-types/page.tsx", [
  "内容类型库",
  "系统起始模板不是固定枚举",
  "新建内容类型",
  "编辑新版本",
  "示例问题测试"
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

addContentCheck("v5 strategy workspace page", "src/app/monthly-matrix/strategy/page.tsx", [
  "月度策略工作区",
  "MonthlyPlanConfigPanel",
  "runTypeMatch",
  "confirmTypeMatch",
  "/monthly-matrix/content-types"
]);

addContentCheck("v5 strategy old route redirects", "src/app/monthly-strategy/page.tsx", [
  "redirect",
  "/monthly-matrix#strategy-package"
]);

addAbsentCheck("v4 ai config unchanged by v5 ui", "src/app/ai-config/page.tsx", ["V5GovernanceLogTabs", "V5 治理日志"]);

addContentCheck("v5 batch page shell", "src/app/monthly-matrix/batch-generation/page.tsx", [
  "批量生成中心",
  "生成可用内容",
  "自动检查、修复和恢复",
  "待补资料",
  "Tabs",
  "BatchGenerationMatrixTable",
  "ScheduleCalendarLite",
  "key: \"content\"",
  "key: \"schedule\""
]);

addContentCheck("v5 batch grouped task list", "src/components/BatchGenerationMatrixTable.tsx", [
  "v5-production-group",
  "question",
  "contentType",
  "预览正文",
  "补充资料",
  "Drawer",
  "内容依据",
  "保存并自动复检"
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
  ".v5-production-groups",
  ".v5-production-group",
  ".v5-draft-preview",
  ".v5-monthly-flow-rail",
  ".v5-calendar-status-summary",
  ".v5-calendar-popover-content",
  ".v5-unscheduled-collapse"
]);

addContentCheck("v5 legacy batch route redirects", "src/app/batch-generation/page.tsx", [
  "redirect",
  "/monthly-matrix/batch-generation"
]);

addContentCheck("v5 exception old route redirects", "src/app/exceptions/page.tsx", [
  "redirect",
  "/monthly-matrix/batch-generation"
]);

addContentCheck("v5 publish schedule old route redirects", "src/app/publish-schedule/page.tsx", [
  "redirect",
  "/monthly-matrix/batch-generation#schedule"
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
  "发布后的 URL 与效果数据统一在数据回传中补全",
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
  "问题级视图",
  "MonthlyPlan",
  "已发布内容",
  "指标",
  "AI 前台测试",
  "Proposal",
  "useMonthlyObservationReview"
]);

addContentCheck("v5 frontend capture tabs", "src/app/ai-front-test/page.tsx", [
  "AI 前台测试",
  "采集任务",
  "回答与引用证据",
  "任务对比",
  "立即执行一次",
  "NewCaptureTaskDialog"
]);

addContentCheck("v5 immediate capture only", "src/components/NewCaptureTaskDialog.tsx", [
  "新建单次采集任务",
  "P0 仅立即执行一次",
  "不创建重复频率、固定日期或后台周期计划"
]);
addContentCheck("v5 immediate capture request", "src/lib/v5/use-frontend-capture.ts", [
  "executionMode: \"immediate_once\"",
  "用户发起立即执行的单次 AI 前台测试"
]);
addAbsentCheck("v5 has no fixed capture cadence", "src/components/NewCaptureTaskDialog.tsx", ["D3", "D7", "D14", "D30", "cron", "scheduleAt"]);

addContentCheck("v5 observation service boundaries", "src/lib/v5/observation-service.ts", [
  "SCHEDULED_CAPTURE_NOT_ALLOWED",
  "immediate_once",
  "ADAPTER_UNSUPPORTED",
  "SENSITIVE_CAPTURE_FIELD",
  "monthlyTaskCreated: false",
  "trendConclusionAllowed: false",
  "conditionsMatched",
  "analysisVersion",
  "reviewVersion",
  "needs_login",
  "adapter_mismatch",
  "interrupted",
  "timed_out",
  "capture_failed"
]);

addContentCheck("v5 immutable artifact repository", "src/lib/v5/observation-repository.ts", [
  "sha256",
  "immutable: true",
  "controlled_local",
  "writeFile"
]);

addContentCheck("v5 reference adapter boundary", "src/lib/v5/observation-reference-adapter.ts", [
  "V5_OBSERVATION_REFERENCE_PATH",
  "questions",
  "monthlyPlans",
  "publishedContent"
]);

addContentCheck("v5 comparison warning", "src/components/CaptureComparisonWorkspace.tsx", [
  "同一问题",
  "两次采集条件不一致",
  "不生成趋势结论"
]);

addContentCheck("v5 site audit merged tab", "src/app/blog-monitor/page.tsx", [
  "site-audit",
  "/blog-monitor?tab=site-audit",
  "SiteAuditPanel"
]);
addContentCheck("v5 site audit independent objects", "src/components/SiteAuditPanel.tsx", [
  "不与 AI 前台测试合并状态或总分",
  "不会建立独立导航、独立规划周期或 AI/SEO 综合总分"
]);

addContentCheck("v5 chrome companion boundary", "browser-extension/manifest.json", [
  "manifest_version",
  "127.0.0.1:17321",
  "chatgpt.com"
]);
addAbsentCheck("v5 chrome companion has no credential api", "browser-extension/src/service-worker.js", [
  "chrome.cookies",
  "localStorage",
  "sessionStorage"
]);
addContentCheck("v5 local runner boundary", "capture-runner/src/server.mjs", [
  "127.0.0.1",
  "chrome-extension://",
  "sensitivePaths",
  "forbidden sensitive fields"
]);

addContentCheck("v5 evidence gate labels", "src/components/EvidenceGateTag.tsx", [
  "可生成",
  "自动降级后可生成",
  "需补证据",
  "已阻断",
  "暂不可生成",
  "需人工确认"
]);

addContentCheck("v5 mock data boundary", "src/lib/v5-ui-mock-data.ts", [
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
addContentCheck("v5 formal generation automatically repairs and retries", "src/lib/v5/formal-generation-service.ts", [
  "repairRound <= 2",
  "attempt <= 3",
  "automaticRepairCount",
  "technicalRetryCount",
  "不需要逐条重试"
]);
addAbsentCheck("v5 batch has no quality or exception tabs", "src/app/monthly-matrix/batch-generation/page.tsx", ["key: \"quality\"", "key: \"exceptions\"", "ExceptionQueuePreview"]);
addAbsentCheck("v5 batch business table hides internal fields", "src/components/BatchGenerationMatrixTable.tsx", ["softQualityScore", "hardRuleStatus", "claimCount", "EvidencePack", "Claim"]);
addAbsentCheck("v5 daily execution no real backend calls", "src/app/daily-execution/page.tsx", ["fetch(", "/api/"]);
addContentCheck("v5 monthly review api adapter", "src/lib/v5/use-monthly-observation-review.ts", [
  "/api/v5/monthly-reviews/",
  "/proposals",
  "idempotencyKey"
]);

addContentCheck("dashboard scoped v5 replacement", "src/app/page.tsx", [
  "首页数据看板",
  "本月内容进展",
  "本月内容矩阵",
  "已生成",
  "异常待处理",
  "待回填 URL",
  "待数据回传",
  "博客监控",
  "重点事项"
]);
addAbsentCheck("dashboard hides engineering state copy", "src/app/page.tsx", [
  "V5 月度生产概览",
  "V5 生产数据与现有运行态分开呈现",
  "保留能力运行态",
  "V4 保持不变",
  "demo / mock",
  "数据来源"
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
  "defaultDistilledTermExtractionRules",
  "distilledTermSemanticTemplates",
  "upsertDistilledTermRuleDraft",
  "activateDistilledTermRuleDraft",
  "discardDistilledTermRuleDraft",
  "generationMode: \"knowledge_base\""
]);

addContentCheck("smoke workflow distilled term lifecycle", "scripts/smoke-workflow.mjs", [
  "distilled_term_low_confidence_discarded",
  "distilled_term_search_question_auto_pool",
  "distilled_term_rule_draft_created",
  "distilled_term_rule_draft_activated",
  "distilled_term_knowledge_base_auto_pool",
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
  "进入配置管理"
]);

addContentCheck("weekly report current week fallback filters", "src/app/weekly-report/page.tsx", [
  "filterPublishRecordsForReport",
  "filterBlogDiagnosticsForReport",
  "fallbackReportPublishRecords",
  "fallbackReportBlogDiagnostics",
  "weeklyPlan.weekStart"
]);

addAbsentCheck("dashboard and weekly report no visible ai bot pv wording", "src/app/page.tsx", ["AI Bot PV", "AI Bot 日志", "Demo PV"]);
addAbsentCheck("weekly report no visible ai bot pv wording", "src/app/weekly-report/page.tsx", ["AI Bot 指标", "Demo Bot PV"]);
addAbsentCheck("weekly report store no ai bot pv summary", "src/lib/workbench-store.ts", ["AI Bot PV"]);

addAbsentCheck("weekly report no raw technical main modules", "src/app/weekly-report/page.tsx", [
  "固定 Prompt 模板",
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
  "/configuration",
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
addContentCheck("package article type test script", "package.json", ["test:v5-article-types", "v5-article-types.test.mjs"]);
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
  "连接信息需要工作台运营或管理员处理"
]);
addContentCheck("real integration business wording", "src/app/real-integration/page.tsx", [
  "模型连接",
  "AI 访问量",
  "AI 访问数据"
]);
addAbsentCheck("connection management hides engineering state copy", "src/app/real-integration/page.tsx", [
  "真实接入配置属于",
  "真实接入前的可试运行状态",
  "运行态证据",
  "存储模式：",
  "状态文件：",
  "当前筛选没有真实接入项"
]);
addAbsentCheck("real integration no legacy ai bot provider wording", "src/app/real-integration/page.tsx", [
  "AI Provider",
  "AI Bot PV",
  "AI Bot 数据可信度",
  "真实 Prompt",
  "GEO Prompt"
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
  "sectionIndex"
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

[
  "src/app/questions-keywords/page.tsx",
  "src/app/configuration/page.tsx",
  "src/lib/v5/question-contracts.ts",
  "src/lib/v5/question-service.ts",
  "src/lib/v5/knowledge-workspace-contracts.ts",
  "src/lib/v5/knowledge-workspace-service.ts",
  "src/lib/v5/article-expression-contracts.ts",
  "src/lib/v5/article-expression-service.ts",
  "src/lib/v5/foundation-repository.ts",
  "src/app/api/v5/questions/route.ts",
  "src/app/api/v5/questions/[id]/route.ts",
  "src/app/api/v5/questions/ingest-signals/route.ts",
  "src/app/api/v5/questions/select-monthly/route.ts",
  "src/app/api/v5/question-decision-exceptions/route.ts",
  "src/app/api/v5/question-decision-exceptions/batch-resolve/route.ts",
  "src/app/api/v5/semantic-keywords/route.ts",
  "src/app/api/v5/semantic-keywords/[id]/exclude/route.ts",
  "src/app/api/v5/semantic-keywords/[id]/restore/route.ts",
  "src/app/api/v5/semantic-keywords/[id]/correct-link/route.ts",
  "src/app/api/v5/knowledge-bases/route.ts",
  "src/app/api/v5/knowledge-bases/[id]/route.ts",
  "src/app/api/v5/knowledge-bases/[id]/materials/route.ts",
  "src/app/api/v5/knowledge-bases/[id]/understanding/route.ts",
  "src/app/api/v5/knowledge-bases/[id]/action-items/route.ts",
  "src/app/api/v5/knowledge-action-items/[id]/route.ts",
  "src/app/api/v5/article-expression-profiles/route.ts",
  "src/app/api/v5/article-expression-profiles/[id]/route.ts",
  "src/app/api/v5/article-expression-profiles/[id]/publish/route.ts",
  "src/app/api/v5/configuration/status/route.ts",
  "data/v5-foundation-state.json",
  "scripts/v5-foundation-contracts.test.mjs"
].forEach((filePath) => addFileCheck(`v5 foundation required file: ${filePath}`, filePath));

addContentCheck("v5 foundation question automation", "src/lib/v5/question-service.ts", [
  "AVAILABLE_CONFIDENCE = 0.75",
  "decisionConflictTypes",
  '"subject", "relationship", "safety"',
  "automatic_signal_ingestion",
  "questionVersionId: question.currentVersionId",
  "semantic_keyword_excluded"
]);
addAbsentCheck("v5 foundation keyword has no approval state", "src/lib/v5/question-contracts.ts", ["pending_approval", "roleAssignment", "manual_enable"]);
addContentCheck("v5 foundation question page", "src/app/questions-keywords/page.tsx", [
  "问题与关键词池",
  "系统持续维护",
  "问题库",
  "关键词库",
  "内容覆盖",
  "选择为本月目标问题",
  "全部采用系统建议",
  "无需逐条审核、手动启用或分配角色"
]);
addContentCheck("v5 foundation knowledge page", "src/app/knowledge/page.tsx", ["知识库重点", "创建并导入", "/api/v5/knowledge-bases"]);
addContentCheck("v5 foundation knowledge detail", "src/app/knowledge/[id]/page.tsx", [
  "资料 ${knowledgeBase.materialCount}",
  "系统理解",
  "待处理 ${openActions.length}",
  "sourceSnapshotHash",
  "技术信息",
  "不阻断整个知识库"
]);
addAbsentCheck("v5 foundation knowledge hides governance by default", "src/app/knowledge/[id]/page.tsx", ["Source 数量", "Chunk 数量", "Claim 数量", "完整治理规则"]);
addContentCheck("v5 foundation configuration page", "src/app/configuration/page.tsx", [
  "配置管理",
  "文章表达预设",
  "发布连接",
  "前台测试连接",
  "目标读者（选填）",
  "写作重心（选填）",
  "结构（选填）",
  "禁止风格（选填）",
  "其他（选填）",
  "未填写或无法映射的内容会遵循系统规则",
  "structureModules: modules",
  "凭证不回显"
]);
addAbsentCheck("v5 foundation expression preset has no template enums", "src/app/configuration/page.tsx", [
  "Radio.Group",
  "适用文章类型",
  "适用渠道",
  "读者认知",
  "必须展开"
]);
addContentCheck("v5 foundation compatibility redirects", "src/app/distilled-terms/page.tsx", ["redirect(\"/questions-keywords\")"]);
addContentCheck("v5 foundation ai config redirect", "src/app/ai-config/page.tsx", ["redirect(\"/configuration\")"]);
addContentCheck("v5 foundation integration redirect", "src/app/real-integration/page.tsx", ["redirect(\"/configuration?tab=connections\")"]);
addContentCheck("v5 foundation repository boundary", "src/lib/v5/foundation-repository.ts", [
  "data/v5-foundation-state.json",
  "temporaryPath",
  "renameSync(temporaryPath, path)",
  "idempotency_conflict",
  "appendV5FoundationAudit"
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
