import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const checks = [];

function addFileCheck(label, filePath) {
  checks.push({
    label,
    pass: existsSync(join(root, filePath)),
    detail: filePath
  });
}

function addContentCheck(label, filePath, needles) {
  const fullPath = join(root, filePath);
  const content = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
  const missing = needles.filter((needle) => !content.includes(needle));

  checks.push({
    label,
    pass: missing.length === 0,
    detail: missing.length === 0 ? filePath : `${filePath} missing: ${missing.join(", ")}`
  });
}

function addRegexCheck(label, filePath, patterns) {
  const fullPath = join(root, filePath);
  const content = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
  const missing = patterns.filter((pattern) => !pattern.test(content));

  checks.push({
    label,
    pass: missing.length === 0,
    detail: missing.length === 0 ? filePath : `${filePath} missing expected pattern`
  });
}

const requiredDocs = [
  "README.md",
  "design/low-fi-prototype.md",
  "docs/usage.md",
  "docs/V5-07-20/内容生产规则链路与动态推广确定性解析方案.md"
];

const requiredConfig = [
  "config/channel-rules.json",
  "config/ai-providers.example.json",
  "data/demo-ai-bot-log.csv",
  "scripts/smoke-pages.mjs",
  "scripts/smoke-interactions.mjs",
  "scripts/smoke-browser.mjs",
  "scripts/smoke-workflow.mjs",
  "scripts/v5-content-production-rules.test.mjs",
  "scripts/check-mysql-connection.mjs",
  "scripts/init-mysql-schema.mjs",
  "scripts/mysql-state-store.mjs",
  "src/components/PageErrorState.tsx",
  "src/lib/config-diagnostics.ts",
  "src/lib/ai-provider.ts",
  "src/lib/import-utils.ts",
  "src/lib/blog-sync-adapter.ts",
  "src/lib/log-import-adapter.ts",
  "src/lib/channel-metrics-adapter.ts",
  "src/lib/repositories/mysql-bridge.ts",
  "src/lib/v5/content-production-contracts.ts",
  "src/lib/v5/promotion-resolver.ts",
  "src/lib/v5/production-contract-compiler.ts",
  "src/lib/v5/production-output-validator.ts",
  "src/lib/v5/content-production-service.ts"
];

const requiredPages = [
  "src/app/page.tsx",
  "src/app/monthly-plan/page.tsx",
  "src/app/today/page.tsx",
  "src/app/drafts/[taskId]/page.tsx",
  "src/app/publish/page.tsx",
  "src/app/blog-monitor/page.tsx",
  "src/app/blog-candidates/page.tsx",
  "src/app/monthly-review/page.tsx",
  "src/app/knowledge/page.tsx",
  "src/app/real-integration/page.tsx",
  "src/app/ai-config/page.tsx",
  "src/app/settings/page.tsx"
];

const requiredApiRoutes = [
  "src/app/api/dashboard/summary/route.ts",
  "src/app/api/config-diagnostics/route.ts",
  "src/app/api/runtime-config/status/route.ts",
  "src/app/api/workspace-settings/route.ts",
  "src/app/api/knowledge-bases/route.ts",
  "src/app/api/knowledge-bases/[id]/route.ts",
  "src/app/api/monthly-plans/generate/route.ts",
  "src/app/api/monthly-plans/[id]/route.ts",
  "src/app/api/content-tasks/[id]/route.ts",
  "src/app/api/content-tasks/[id]/generate/route.ts",
  "src/app/api/content-tasks/[id]/regenerate-title/route.ts",
  "src/app/api/content-tasks/batch-generate/route.ts",
  "src/app/api/content-tasks/confirm/route.ts",
  "src/app/api/article-drafts/[id]/route.ts",
  "src/app/api/article-drafts/[id]/approve/route.ts",
  "src/app/api/publish-records/route.ts",
  "src/app/api/publish-records/[id]/published/route.ts",
  "src/app/api/publish-records/[id]/url/route.ts",
  "src/app/api/publish-records/[id]/metrics/route.ts",
  "src/app/api/publish-records/export/route.ts",
  "src/app/api/channel-metrics/import/route.ts",
  "src/app/api/blog-articles/sync/route.ts",
  "src/app/api/blog-articles/[id]/candidate/route.ts",
  "src/app/api/blog-articles/[id]/candidate/task/route.ts",
  "src/app/api/blog-articles/[id]/diagnose/route.ts",
  "src/app/api/log-imports/route.ts",
  "src/app/api/pipeline/run/route.ts",
  "src/app/api/pipeline/runs/export/route.ts",
  "src/app/api/bot-visit-summary/route.ts",
  "src/app/api/monthly-reviews/[month]/route.ts",
  "src/app/api/monthly-reviews/[month]/export/route.ts",
  "src/app/api/monthly-reviews/[month]/next-plan/route.ts",
  "src/app/api/workbench-state/route.ts"
];

const requiredApiMethods = [
  ["src/app/api/dashboard/summary/route.ts", "GET"],
  ["src/app/api/config-diagnostics/route.ts", "GET"],
  ["src/app/api/config-diagnostics/route.ts", "POST"],
  ["src/app/api/runtime-config/status/route.ts", "GET"],
  ["src/app/api/workspace-settings/route.ts", "GET"],
  ["src/app/api/workspace-settings/route.ts", "PATCH"],
  ["src/app/api/knowledge-bases/route.ts", "GET"],
  ["src/app/api/knowledge-bases/route.ts", "POST"],
  ["src/app/api/knowledge-bases/[id]/route.ts", "PATCH"],
  ["src/app/api/monthly-plans/generate/route.ts", "POST"],
  ["src/app/api/monthly-plans/[id]/route.ts", "PATCH"],
  ["src/app/api/content-tasks/[id]/route.ts", "PATCH"],
  ["src/app/api/content-tasks/[id]/route.ts", "DELETE"],
  ["src/app/api/content-tasks/[id]/generate/route.ts", "POST"],
  ["src/app/api/content-tasks/[id]/regenerate-title/route.ts", "POST"],
  ["src/app/api/content-tasks/batch-generate/route.ts", "POST"],
  ["src/app/api/content-tasks/confirm/route.ts", "POST"],
  ["src/app/api/article-drafts/[id]/route.ts", "PATCH"],
  ["src/app/api/article-drafts/[id]/approve/route.ts", "POST"],
  ["src/app/api/publish-records/route.ts", "POST"],
  ["src/app/api/publish-records/[id]/published/route.ts", "PATCH"],
  ["src/app/api/publish-records/[id]/url/route.ts", "PATCH"],
  ["src/app/api/publish-records/[id]/metrics/route.ts", "PATCH"],
  ["src/app/api/publish-records/export/route.ts", "POST"],
  ["src/app/api/channel-metrics/import/route.ts", "POST"],
  ["src/app/api/blog-articles/sync/route.ts", "POST"],
  ["src/app/api/blog-articles/[id]/candidate/route.ts", "POST"],
  ["src/app/api/blog-articles/[id]/candidate/route.ts", "PATCH"],
  ["src/app/api/blog-articles/[id]/candidate/route.ts", "DELETE"],
  ["src/app/api/blog-articles/[id]/candidate/task/route.ts", "POST"],
  ["src/app/api/blog-articles/[id]/diagnose/route.ts", "POST"],
  ["src/app/api/log-imports/route.ts", "POST"],
  ["src/app/api/pipeline/run/route.ts", "POST"],
  ["src/app/api/pipeline/runs/export/route.ts", "GET"],
  ["src/app/api/bot-visit-summary/route.ts", "GET"],
  ["src/app/api/monthly-reviews/[month]/route.ts", "GET"],
  ["src/app/api/monthly-reviews/[month]/export/route.ts", "GET"],
  ["src/app/api/monthly-reviews/[month]/next-plan/route.ts", "POST"],
  ["src/app/api/workbench-state/route.ts", "GET"]
];

const requiredWorkers = [
  "workers/README.md",
  "workers/sync-blog.mjs",
  "workers/import-demo-log.mjs",
  "workers/import-channel-metrics.mjs",
  "workers/run-pipeline.mjs",
  "workers/schedule-pipeline.mjs",
  "workers/worker-utils.mjs",
  "workers/typescript-loader.mjs"
];

const schemaTables = [
  "workspace_setting",
  "knowledge_base",
  "monthly_plan",
  "content_task",
  "article_draft",
  "publish_record",
  "blog_article",
  "blog_diagnosis",
  "log_import_batch",
  "bot_visit_summary",
  "workbench_audit_event",
  "workbench_state_snapshot"
];

for (const filePath of requiredDocs) addFileCheck(`doc: ${filePath}`, filePath);
for (const filePath of requiredConfig) addFileCheck(`config: ${filePath}`, filePath);
for (const filePath of requiredPages) addFileCheck(`page: ${filePath}`, filePath);
for (const filePath of requiredApiRoutes) addFileCheck(`api: ${filePath}`, filePath);
for (const [filePath, method] of requiredApiMethods) {
  addRegexCheck(`api method: ${method} ${filePath}`, filePath, [
    new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`)
  ]);
}
for (const filePath of requiredWorkers) addFileCheck(`worker: ${filePath}`, filePath);

addFileCheck("database schema", "database/schema.sql");
addRegexCheck(
  "schema tables",
  "database/schema.sql",
  schemaTables.map((tableName) => new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${tableName}\\b`))
);
addContentCheck("package scripts", "package.json", [
  "\"dev\"",
  "\"build\"",
  "\"typecheck\"",
  "\"validate:structure\"",
  "\"test:v5-content-production\"",
  "\"smoke:pages\"",
  "\"smoke:interactions\"",
  "\"smoke:browser\"",
  "\"smoke:workflow\"",
  "\"check:mysql\"",
  "\"init:mysql\"",
  "\"worker:sync-blog\"",
  "\"worker:import-log\"",
  "\"worker:import-channel-metrics\"",
  "\"worker:run-pipeline\"",
  "\"worker:schedule-pipeline\""
]);
addContentCheck("usage doc", "docs/usage.md", [
  "推荐试用顺序",
  "运行态数据同步失败",
  "smoke:pages",
  "smoke:interactions",
  "smoke:workflow",
  "真实接入还需要什么"
]);
addContentCheck("readme usage index", "README.md", ["docs/usage.md"]);
addContentCheck("V5 production capability boundary", "README.md", [
  "ProductionContractSnapshot",
  "CTAPlan",
  "当前能力边界",
  "不能宣称用户已经能在页面上完成从知识检索到公开发布的端到端生产"
]);
addContentCheck("V5 content production design", "docs/V5-07-20/内容生产规则链路与动态推广确定性解析方案.md", [
  "FinalEvidencePack",
  "动态推广配置",
  "确定性解析",
  "生成后机器校验",
  "完成定义"
]);
addContentCheck("V5 deterministic promotion resolver", "src/lib/v5/promotion-resolver.ts", [
  "resolvePromotionPlan",
  "promotion_conflict",
  "promotion_required_missing",
  "promotion_claim_missing"
]);
addContentCheck("V5 production contract compiler", "src/lib/v5/production-contract-compiler.ts", [
  "compileProductionContract",
  "FinalEvidencePackSnapshot",
  "contractHash"
]);
addContentCheck("V5 production output validator", "src/lib/v5/production-output-validator.ts", [
  "validateProductionOutput",
  "fact_trace_invalid",
  "cross_channel_similarity",
  "sensitive_output"
]);
addContentCheck("V5 one-repair orchestration", "src/lib/v5/content-production-service.ts", [
  "callWithTechnicalRetries",
  "repairCount",
  "system_recovering"
]);
addContentCheck("V5 production rule tests", "scripts/v5-content-production-rules.test.mjs", [
  "多产品任务按产品、渠道和意图确定性选择 CTA",
  "同业务优先级 CTA 冲突时 fail closed",
  "Provider 技术失败最多重试三次"
]);
addContentCheck("publish record channel metrics", "database/schema.sql", ["channel_metrics JSON"]);
addContentCheck("worker api execution", "workers/worker-utils.mjs", ["postJson", "getJson", "WORKBENCH_BASE_URL"]);
addContentCheck("pipeline worker", "workers/run-pipeline.mjs", ["sync_blog", "import_log", "import_channel_metrics"]);
addContentCheck("page action wiring", "src/app/monthly-plan/page.tsx", ["regenerate-title", "/api/content-tasks/", "/api/content-tasks/confirm"]);
addContentCheck("monthly plan confirmations", "src/app/monthly-plan/page.tsx", ["Popconfirm", "确认生成新的月度计划", "确认重生成标题", "确认批量确认任务", "确认删除这个任务"]);
addContentCheck("content task confirm api", "src/app/api/content-tasks/confirm/route.ts", ["confirmContentTasks"]);
addContentCheck("content task delete api", "src/app/api/content-tasks/[id]/route.ts", ["DELETE", "deleteContentTask"]);
addContentCheck("content task lifecycle store", "src/lib/workbench-store.ts", ["confirmContentTasks", "deleteContentTask", "content_tasks_confirmed", "content_task_deleted"]);
addContentCheck("publish action wiring", "src/app/publish/page.tsx", ["/published", "/api/channel-metrics/import"]);
addContentCheck("publish confirmations", "src/app/publish/page.tsx", ["Popconfirm", "确认标记为已发布"]);
addContentCheck("publish import confirmation", "src/app/publish/page.tsx", ["Popconfirm", "确认导入渠道数据？", "会自动识别中文/英文字段"]);
addContentCheck("publish manual metrics api", "src/app/api/publish-records/[id]/metrics/route.ts", ["updatePublishRecordMetrics", "PATCH"]);
addContentCheck("publish manual metrics store", "src/lib/workbench-store.ts", ["updatePublishRecordMetrics", "publish_record_metrics_updated", "渠道指标已保存到发布台账"]);
addContentCheck("publish manual metrics page", "src/app/publish/page.tsx", [
  "openMetricsModal",
  "handleSaveMetrics",
  "renderMetrics",
  "`/api/publish-records/${metricsRecord.id}/metrics`",
  "method: \"PATCH\"",
  "录入渠道指标",
  "InputNumber",
  "confirmLoading={savingMetrics}",
  "await refresh()"
]);
addContentCheck("publish execution context", "src/app/publish/page.tsx", [
  "publishNextStepLabels",
  "getPublishNextStep",
  "getPublishActionText",
  "renderPublishEntry",
  "draftById",
  "taskById",
  "发布队列共",
  "来源任务",
  "稿件来源",
  "下一步",
  "处理动作",
  "可执行入口",
  "待人工发布",
  "待回填 URL",
  "待录入指标",
  "可复盘",
  "去月度复盘",
  "productLabels",
  "contentTypeLabels"
]);
addContentCheck("candidate pool wiring", "src/app/blog-candidates/page.tsx", ["useWorkbenchSnapshot", "candidateStatus"]);
addContentCheck("candidate pool lifecycle api", "src/app/api/blog-articles/[id]/candidate/route.ts", ["addBlogArticleToCandidatePool", "updateBlogArticleCandidateStatus", "PATCH", "DELETE"]);
addContentCheck("candidate pool lifecycle store", "src/lib/workbench-store.ts", ["updateBlogArticleCandidateStatus", "blog_article_candidate_status_updated", "dismissed"]);
addContentCheck("candidate pool lifecycle schema", "database/schema.sql", ["candidate_status", "candidate_reason", "candidate_added_at"]);
addContentCheck("candidate pool lifecycle page", "src/app/blog-candidates/page.tsx", [
  "handleMarkPlanned",
  "handleDismissCandidate",
  "确认标记为已规划？",
  "确认移出候选池？",
  "`/api/blog-articles/${id}/candidate`",
  "method: \"PATCH\"",
  "method: \"DELETE\"",
  "await refresh()",
  "candidateStatus !== \"dismissed\""
]);
addContentCheck("candidate pool task api", "src/app/api/blog-articles/[id]/candidate/task/route.ts", ["createContentTaskFromBlogCandidate", "POST"]);
addContentCheck("candidate pool task store", "src/lib/workbench-store.ts", ["createContentTaskFromBlogCandidate", "blog_candidate_content_task_created", "渠道补强：", "官网博客补强"]);
addContentCheck("candidate pool task page", "src/app/blog-candidates/page.tsx", [
  "handleCreateContentTask",
  "`/api/blog-articles/${id}/candidate/task`",
  "确认生成渠道补强任务？",
  "loading={creatingTaskId === record.id}",
  "生成任务",
  "await refresh()"
]);
addContentCheck("candidate pool filters", "src/app/blog-candidates/page.tsx", [
  "candidateSourceLabels",
  "candidatePriorityLabels",
  "candidateStatusLabels",
  "sourceFilter",
  "priorityFilter",
  "candidateStatusFilter",
  "dataConfidenceFilter",
  "filteredCandidates",
  "按来源筛选",
  "按优先级筛选",
  "按候选状态筛选",
  "按数据来源筛选",
  "当前筛选没有博客候选主题",
  "清空筛选"
]);
addContentCheck("candidate pool next step", "src/app/blog-candidates/page.tsx", [
  "candidateNextStepLabels",
  "candidateNextStepColors",
  "getCandidateNextStep",
  "getCandidateActionText",
  "renderCandidateEntry",
  "renderCandidateMaintenance",
  "handleAddCandidate",
  "visibleConfirmCount",
  "visibleCreateTaskCount",
  "visibleMarkPlannedCount",
  "visibleReviewSourceCount",
  "highestPriorityCandidate",
  "候选主题共",
  "确认入池",
  "生成任务",
  "标记规划",
  "复查来源",
  "已规划",
  "处理动作",
  "可执行入口",
  "维护",
  "确认加入候选池？",
  "看月度计划"
]);
addContentCheck("pipeline api wiring", "src/app/api/pipeline/run/route.ts", ["runWorkbenchPipeline"]);
addContentCheck("pipeline state persistence", "src/lib/workbench-store.ts", ["pipelineRuns", "runWorkbenchPipeline", "pipeline_run_finished"]);
addContentCheck("dashboard pipeline action", "src/app/page.tsx", ["/api/pipeline/run", "Pipeline 运行记录"]);
addContentCheck("dashboard pipeline filters", "src/app/page.tsx", [
  "pipelineStatusLabels",
  "pipelineStatusFilter",
  "pipelineMonthFilter",
  "filteredPipelineRuns",
  "按运行状态筛选",
  "按月份筛选",
  "当前筛选没有 Pipeline 记录",
  "清空筛选"
]);
addContentCheck("dashboard action queue", "src/app/page.tsx", [
  "DashboardActionItem",
  "dashboardActionStepLabels",
  "dashboardActionStepColors",
  "dashboardActionItems",
  "dashboardActionTotal",
  "highestPriorityAction",
  "draftByTaskId",
  "publishRecordByTaskId",
  "getPlanNextStep",
  "getBlogNextStep",
  "getDashboardActionText",
  "currentAction",
  "entryLabel",
  "执行队列",
  "事项",
  "数量",
  "月度计划待确认",
  "稿件待生成/排查",
  "终稿待处理",
  "发布侧待处理",
  "博客待处置",
  "可进入复盘",
  "当前优先处理",
  "当前状态",
  "下一步",
  "处理动作",
  "可执行入口"
]);
addContentCheck("dashboard overview closure", "src/app/page.tsx", [
  "DashboardOverviewStep",
  "DashboardOverviewItem",
  "dashboardOverviewStepLabels",
  "dashboardOverviewStepColors",
  "dashboardOverviewItems",
  "blogNeedsWorkCount",
  "官网博客概览",
  "博客候选与 SEO/GEO 诊断",
  "AI Bot 日志可信度",
  "当前状态",
  "下一步",
  "处理动作",
  "可执行入口",
  "去博客侧",
  "去导入",
  "去月度复盘"
]);
addContentCheck("dashboard pipeline closure", "src/app/page.tsx", [
  "PipelineRunNextStep",
  "pipelineRunNextStepLabels",
  "pipelineRunNextStepColors",
  "getPipelineRunNextStep",
  "getPipelineRunActionText",
  "getPipelineRunEntry",
  "Pipeline 运行记录",
  "进入月度复盘",
  "补齐缺口",
  "排查后重跑",
  "下一步",
  "处理动作",
  "可执行入口",
  "看接入"
]);
addContentCheck("pipeline export api", "src/app/api/pipeline/runs/export/route.ts", ["exportPipelineRuns"]);
addContentCheck("schedule pipeline worker", "workers/schedule-pipeline.mjs", ["--repeat", "interval-seconds", "/api/pipeline/run"]);
addContentCheck("workspace settings api", "src/app/api/workspace-settings/route.ts", ["getWorkspaceSetting", "saveWorkspaceSetting"]);
addContentCheck("runtime get api dynamic", "src/app/api/workbench-state/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("dashboard summary api dynamic", "src/app/api/dashboard/summary/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("runtime config api dynamic", "src/app/api/runtime-config/status/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("config diagnostics api dynamic", "src/app/api/config-diagnostics/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("knowledge api dynamic", "src/app/api/knowledge-bases/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("workspace settings api dynamic", "src/app/api/workspace-settings/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("pipeline export api dynamic", "src/app/api/pipeline/runs/export/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("monthly report api dynamic", "src/app/api/monthly-reviews/[month]/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("monthly report export api dynamic", "src/app/api/monthly-reviews/[month]/export/route.ts", ['dynamic = "force-dynamic"']);
addContentCheck("settings page persistence", "src/app/settings/page.tsx", ["/api/workspace-settings", "enabledChannels"]);
addContentCheck("settings page grouping", "src/app/settings/page.tsx", [
  "finalReviewModeLabels",
  "logModeLabels",
  "Form.useWatch",
  "当前规则概览",
  "发布节奏与范围",
  "执行与采集规则",
  "恢复当前保存配置"
]);
addContentCheck("settings rule readiness", "src/app/settings/page.tsx", [
  "settingsRuleNextStepLabels",
  "settingsRuleNextStepColors",
  "createSettingsRuleChecks",
  "getSettingsRuleEntry",
  "renderSettingsRuleEntry",
  "settingsRuleChecks",
  "blockingRuleChecks",
  "规则检查",
  "渠道范围",
  "产品范围",
  "周产能",
  "终稿确认",
  "日志接入",
  "下一步",
  "处理动作",
  "可执行入口",
  "规则可用",
  "未选择渠道",
  "配置日志",
  "看真实接入",
  "去月度计划",
  "保存设置"
]);
addContentCheck("knowledge base store", "src/lib/workbench-store.ts", ["createKnowledgeBase", "patchKnowledgeBase", "knowledge_base_updated"]);
addContentCheck("knowledge base api", "src/app/api/knowledge-bases/route.ts", ["createKnowledgeBase", "knowledgeBases"]);
addContentCheck("knowledge base patch api", "src/app/api/knowledge-bases/[id]/route.ts", ["patchKnowledgeBase"]);
addContentCheck("knowledge page persistence", "src/app/knowledge/page.tsx", ["/api/knowledge-bases", "新增知识库", "编辑知识库", "停用"]);
addContentCheck("knowledge page filters", "src/app/knowledge/page.tsx", [
  "knowledgeTypeLabels",
  "trustLevelLabels",
  "typeFilter",
  "trustLevelFilter",
  "statusFilter",
  "filteredKnowledgeBases",
  "visibleKnowledgeBases",
  "getKnowledgeTimestamp",
  "按知识库类型筛选",
  "按可信等级筛选",
  "按启用状态筛选",
  "当前筛选没有知识库条目",
  "清空筛选"
]);
addContentCheck("knowledge readiness next step", "src/app/knowledge/page.tsx", [
  "knowledgeNextStepLabels",
  "knowledgeNextStepColors",
  "getKnowledgeNextStep",
  "getKnowledgeActionText",
  "renderKnowledgeEntry",
  "知识库共",
  "可直接调用",
  "需启用",
  "需补范围",
  "需确认可信度",
  "需补同步记录",
  "仅对比调用",
  "可用性",
  "下一步",
  "处理动作",
  "可执行入口",
  "维护",
  "补信息"
]);
addContentCheck("config diagnostics", "src/lib/config-diagnostics.ts", ["runConfigDiagnostic", "runAllConfigDiagnostics", "pending_config"]);
addContentCheck("config diagnostics api", "src/app/api/config-diagnostics/route.ts", ["runAllConfigDiagnostics", "runConfigDiagnostic"]);
addContentCheck("config status page", "src/app/ai-config/page.tsx", ["复制 .env.local 模板", "能力状态", "missingEnv", "/api/config-diagnostics", "真实接入 Checklist"]);
addContentCheck("config status loading failure", "src/app/ai-config/page.tsx", ["PageErrorState", "配置状态加载失败", "loadConfigStatus", "/api/runtime-config/status"]);
addContentCheck("config status filters", "src/app/ai-config/page.tsx", [
  "capabilityStatusLabels",
  "capabilityStatusFilter",
  "filteredProviders",
  "filteredCapabilities",
  "按配置状态筛选",
  "当前筛选没有 Provider",
  "当前筛选没有能力状态",
  "当前筛选没有真实接入项",
  "清空筛选"
]);
addContentCheck("config status next step", "src/app/ai-config/page.tsx", [
  "capabilityNextStepLabels",
  "capabilityNextStepColors",
  "capabilityQueueSummary",
  "highestPriorityCapability",
  "getCapabilityNextStep",
  "getCapabilityActionText",
  "getCapabilityLink",
  "renderCapabilityEntry",
  "renderCapabilityDiagnosticButton",
  "能力共",
  "待补配置",
  "待执行诊断",
  "诊断失败",
  "本地 fallback",
  "可直接试跑",
  "当前优先处理",
  "下一步",
  "处理动作",
  "可执行入口",
  "诊断",
  "测试连接",
  "看缺口"
]);
addContentCheck("action empty component", "src/components/ActionEmpty.tsx", ["ActionEmpty", "Empty.PRESENTED_IMAGE_SIMPLE"]);
addContentCheck("page error state component", "src/components/PageErrorState.tsx", ["PageErrorState", "运行态数据同步失败", "title", "description", "重试"]);
addContentCheck("workbench snapshot failure state", "src/lib/client-state.ts", ["error", "usingFallback", "运行态数据同步失败"]);
addContentCheck("dashboard error state", "src/app/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("monthly plan error state", "src/app/monthly-plan/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("today error state", "src/app/today/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("publish error state", "src/app/publish/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("blog monitor error state", "src/app/blog-monitor/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("monthly report error state", "src/app/monthly-review/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("knowledge error state", "src/app/knowledge/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("real integration error state", "src/app/real-integration/page.tsx", ["PageErrorState", "onRetry={refresh}"]);
addContentCheck("monthly plan empty state", "src/app/monthly-plan/page.tsx", ["ActionEmpty", "还没有月度计划任务"]);
addContentCheck("monthly plan filters", "src/app/monthly-plan/page.tsx", [
  "statusFilter",
  "channelFilter",
  "productFilter",
  "filteredTasks",
  "按状态筛选",
  "按渠道筛选",
  "按产品筛选",
  "当前筛选没有月度计划任务",
  "清空筛选"
]);
addContentCheck("monthly plan execution context", "src/app/monthly-plan/page.tsx", [
  "draftHandoffLabels",
  "publishHandoffLabels",
  "planNextStepLabels",
  "draftByTaskId",
  "publishRecordByTaskId",
  "getDraftHandoffStatus",
  "getPublishHandoffStatus",
  "getPlanNextStep",
  "getPlanActionText",
  "renderPlanEntry",
  "renderPlanMaintenance",
  "highestPriorityPlanTask",
  "月度计划共",
  "稿件承接",
  "发布承接",
  "下一步",
  "处理动作",
  "可执行入口",
  "维护",
  "待确认",
  "终稿确认",
  "人工发布",
  "回填 URL",
  "录入指标",
  "可复盘",
  "去生成",
  "看 AI 配置",
  "去发布"
]);
addContentCheck("today empty state", "src/app/today/page.tsx", ["ActionEmpty", "今天还没有可处理任务"]);
addContentCheck("today confirmations", "src/app/today/page.tsx", ["Popconfirm", "确认批量生成今日文章", "确认生成这篇稿件"]);
addContentCheck("today task filters", "src/app/today/page.tsx", [
  "statusFilter",
  "channelFilter",
  "productFilter",
  "filteredTodayTasks",
  "按状态筛选",
  "按渠道筛选",
  "按产品筛选",
  "清空筛选",
  "当前筛选没有任务",
  "productLabels"
]);
addContentCheck("today draft readiness", "src/app/today/page.tsx", [
  "draftStatusLabels",
  "generationStatusLabels",
  "draftByTaskId",
  "今日任务共",
  "当前还没有稿件",
  "待生成",
  "重新生成"
]);
addContentCheck("today next step", "src/app/today/page.tsx", [
  "TodayNextStep",
  "todayNextStepLabels",
  "todayNextStepColors",
  "getTodayNextStep",
  "getTodayActionText",
  "publishRecordByTaskId",
  "当前优先",
  "生成/排查",
  "终稿处理",
  "发布承接",
  "可复盘",
  "下一步",
  "处理动作",
  "可执行入口",
  "回月度计划确认",
  "生成稿件",
  "终稿确认",
  "人工发布",
  "去复盘"
]);
addContentCheck("publish empty state", "src/app/publish/page.tsx", ["ActionEmpty", "发布队列还没有终稿"]);
addContentCheck("publish queue filters", "src/app/publish/page.tsx", [
  "publishStatusLabels",
  "statusFilter",
  "channelFilter",
  "filteredPublishRecords",
  "按发布状态筛选",
  "按渠道筛选",
  "当前筛选没有发布记录",
  "清空筛选"
]);
addContentCheck("blog monitor empty state", "src/app/blog-monitor/page.tsx", ["ActionEmpty", "还没有博客监控数据"]);
addContentCheck("blog monitor import confirmations", "src/app/blog-monitor/page.tsx", ["Popconfirm", "确认同步博客内容？", "确认导入博客数据？", "确认导入 AI Bot 日志？"]);
addContentCheck("blog monitor filters", "src/app/blog-monitor/page.tsx", [
  "indexedStatusLabels",
  "geoResultLabels",
  "indexedStatusFilter",
  "geoResultFilter",
  "dataConfidenceFilter",
  "filteredBlogArticles",
  "按收录状态筛选",
  "按 GEO 结果筛选",
  "按数据来源筛选",
  "当前筛选没有博客记录",
  "清空筛选"
]);
addContentCheck("blog monitor next step", "src/app/blog-monitor/page.tsx", [
  "candidateStatusLabels",
  "blogPriorityLabels",
  "blogNextStepLabels",
  "getBlogNextStep",
  "getBlogSuggestionReason",
  "getBlogActionText",
  "renderBlogEntry",
  "博客监控共",
  "待诊断/待优化",
  "候选状态",
  "优先级",
  "建议原因",
  "下一步",
  "处理动作",
  "可执行入口",
  "建议入候选池",
  "继续观察",
  "disabled={candidateLocked}",
  "Link href=\"/blog-candidates\"",
  "Link href=\"/monthly-plan\"",
  "Link href=\"/monthly-review\""
]);
addContentCheck("draft confirmations", "src/app/drafts/[taskId]/page.tsx", ["Popconfirm", "确认重新生成稿件", "确认加入发布队列"]);
addContentCheck("draft context panel", "src/app/drafts/[taskId]/page.tsx", [
  "任务上下文",
  "稿件来源",
  "draftStatusLabels",
  "generationModeLabels",
  "generationStatusLabels",
  "channelLabels",
  "productLabels",
  "contentTypeLabels",
  "statusLabels",
  "存在阻断项，暂不建议入队",
  "disabled={!draft.qaResult.passed}"
]);
addContentCheck("draft next step", "src/app/drafts/[taskId]/page.tsx", [
  "DraftReviewNextStep",
  "DraftPublishHandoff",
  "draftReviewNextStepLabels",
  "draftReviewNextStepColors",
  "draftPublishHandoffLabels",
  "draftPublishHandoffColors",
  "getDraftPublishHandoff",
  "getDraftReviewNextStep",
  "getDraftReviewActionText",
  "renderDraftReviewEntry",
  "下一步判断",
  "发布承接",
  "处理动作",
  "可执行入口",
  "加入发布队列",
  "人工发布",
  "回填 URL",
  "录入指标",
  "去月度复盘"
]);
addContentCheck("monthly report action", "src/app/monthly-review/page.tsx", ["/api/monthly-reviews/", "生成月度复盘", "nextMonthSuggestions"]);
addContentCheck("monthly report markdown export api", "src/app/api/monthly-reviews/[month]/export/route.ts", ["exportMonthlyReviewMarkdown"]);
addContentCheck("monthly report markdown export store", "src/lib/workbench-store.ts", ["exportMonthlyReviewMarkdown", "JOTO GTM 月度复盘", "## 4. 下月建议"]);
addContentCheck("monthly report markdown export page", "src/app/monthly-review/page.tsx", ["handleExportMarkdown", "/export", "navigator.clipboard.writeText", "导出 Markdown", "loading={exportingMarkdown}"]);
addContentCheck("monthly report next plan api", "src/app/api/monthly-reviews/[month]/next-plan/route.ts", ["createNextMonthlyPlanFromReview"]);
addContentCheck("monthly report next plan store", "src/lib/workbench-store.ts", ["createNextMonthlyPlanFromReview", "next_month_plan_created_from_review", "月度复盘建议"]);
addContentCheck("monthly report next plan page", "src/app/monthly-review/page.tsx", ["handleCreateNextPlan", "/next-plan", "生成下月计划草稿", "Popconfirm", "loading={creatingNextPlan}", "await refresh()"]);
addContentCheck("monthly report detail review", "src/app/monthly-review/page.tsx", [
  "reportPublishRecords",
  "reportBlogDiagnostics",
  "renderChannelMetrics",
  "channelMetrics",
  "官网博客诊断复盘",
  "candidateStatus",
  "DataConfidenceTag"
]);
addContentCheck("monthly report detail filters", "src/app/monthly-review/page.tsx", [
  "publishStatusLabels",
  "blogGeoResultLabels",
  "publishStatusFilter",
  "blogGeoResultFilter",
  "filteredReportPublishRecords",
  "filteredReportBlogDiagnostics",
  "按发布状态筛选",
  "按博客 GEO 结果筛选",
  "当前筛选没有渠道执行记录",
  "当前筛选没有博客诊断记录",
  "清空筛选"
]);
addContentCheck("monthly report action queue", "src/app/monthly-review/page.tsx", [
  "ReportActionStep",
  "reportActionStepLabels",
  "reportActionStepColors",
  "createReportActionItems",
  "actionText",
  "reportActionItems",
  "reportActionTotal",
  "highestPriorityReportAction",
  "复盘行动队列",
  "当前行动项",
  "处理动作",
  "处理发布队列",
  "回填 URL",
  "录入指标",
  "处理博客候选",
  "生成下月计划",
  "可执行入口"
]);
addContentCheck("monthly report suggestion closure", "src/app/monthly-review/page.tsx", [
  "MonthlySuggestionStep",
  "MonthlySuggestionAction",
  "monthlySuggestionStepLabels",
  "monthlySuggestionStepColors",
  "createMonthlySuggestionActions",
  "monthlySuggestionActions",
  "renderMonthlySuggestionEntry",
  "下月建议",
  "先生成月度复盘",
  "复核建议",
  "生成计划草稿",
  "建议",
  "下一步",
  "处理动作",
  "可执行入口",
  "生成月度复盘",
  "生成计划",
  "看月度计划"
]);
addContentCheck("real integration page", "src/app/real-integration/page.tsx", [
  "真实接入",
  "/api/config-diagnostics",
  "/api/runtime-config/status",
  "外部配置状态加载失败",
  "外部配置交接表",
  "自动化与模板",
  "NGINX_ACCESS_LOG_PATH",
  "CDN_LOG_EXPORT_PATH"
]);
addContentCheck("real integration filters", "src/app/real-integration/page.tsx", [
  "integrationGroupLabels",
  "integrationStatusLabels",
  "integrationGroupFilter",
  "integrationStatusFilter",
  "filteredIntegrationItems",
  "按接入类型筛选",
  "按配置状态筛选",
  "当前筛选没有真实接入项",
  "清空筛选"
]);
addContentCheck("real integration next step", "src/app/real-integration/page.tsx", [
  "integrationNextStepLabels",
  "integrationNextStepColors",
  "scheduledTaskNextStepLabels",
  "scheduledTaskNextStepColors",
  "getIntegrationNextStep",
  "getIntegrationActionText",
  "getIntegrationEntry",
  "visibleFillConfigCount",
  "visibleRunDiagnosticCount",
  "visibleInspectFailureCount",
  "visibleReadyEntryCount",
  "highestPriorityIntegrationItem",
  "automationPendingCount",
  "highestPriorityScheduledTask",
  "接入缺口共",
  "自动化与模板共",
  "补必填配置",
  "执行诊断",
  "排查失败",
  "验数据库",
  "内容生成试跑",
  "同步博客",
  "导入日志",
  "下一步",
  "处理动作",
  "可执行入口",
  "看配置",
  "去生成",
  "去导入",
  "跑 MySQL 检查",
  "手动试跑",
  "跑 Worker",
  "接定时任务",
  "确认模板"
]);
addContentCheck("real integration sequence closure", "src/app/real-integration/page.tsx", [
  "IntegrationSequenceStep",
  "createIntegrationSequenceSteps",
  "integrationSequenceSteps",
  "本地 JSON 主链路",
  "MySQL 持久化",
  "AI Provider 试跑",
  "博客源与日志源",
  "自动化与模板收口",
  "接入顺序",
  "步骤",
  "状态",
  "证据",
  "下一步",
  "处理动作",
  "可执行入口",
  "继续保留 JSON 主链路可跑",
  "先手动试跑 Pipeline"
]);
addContentCheck("workflow smoke script", "scripts/smoke-workflow.mjs", [
  "/api/config-diagnostics",
  "/api/knowledge-bases",
  "/api/monthly-plans/generate",
  "/api/workspace-settings",
  "/api/pipeline/run",
  "final_state_has_pipeline_runs"
]);
addContentCheck("page smoke script", "scripts/smoke-pages.mjs", [
  "/real-integration",
  "/api/config-diagnostics",
  "/api/monthly-reviews/",
  "/api/monthly-reviews/2026-06-17/export",
  "smoke-pages",
  "workspaceSetting"
]);
addContentCheck("interaction smoke script", "scripts/smoke-interactions.mjs", [
  "smoke-interactions",
  "dashboard_run_pipeline",
  "monthly_plan_generate_confirmed",
  "publish_url_modal",
  "real_integration_diagnostics"
]);
addContentCheck("browser smoke script", "scripts/smoke-browser.mjs", [
  "smoke-browser",
  "monthly_plan_popconfirm_generate",
  "knowledge_modal_create_dom_refresh",
  "publish_url_modal_fill_dom_refresh",
  "data-testid",
  "remote-debugging-port",
  "WebSocket"
]);
addContentCheck("browser smoke stable selectors", "src/app/monthly-plan/page.tsx", [
  "data-testid=\"monthly-plan-generate-button\"",
  "data-testid\": \"monthly-plan-generate-confirm\""
]);
addContentCheck("browser smoke knowledge selectors", "src/app/knowledge/page.tsx", [
  "data-testid=\"knowledge-create-button\"",
  "data-testid=\"knowledge-name-input\"",
  "data-testid=\"knowledge-scope-input\"",
  "data-testid\": \"knowledge-save-button\""
]);
addContentCheck("browser smoke publish selectors", "src/app/publish/page.tsx", [
  "data-testid={`publish-mark-published-${record.id}`}",
  "data-testid\": `publish-mark-published-confirm-${record.id}`",
  "data-testid={`publish-fill-url-${record.id}`}",
  "data-testid=\"publish-url-input\"",
  "data-testid\": \"publish-url-save-button\""
]);

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  const marker = check.pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${check.label} - ${check.detail}`);
}

console.log("");
console.log(`Structure checks: ${checks.length - failed.length}/${checks.length} passed`);

if (failed.length > 0) {
  process.exitCode = 1;
}
