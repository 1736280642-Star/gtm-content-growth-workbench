import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const results = [];

function readSource(filePath) {
  const fullPath = join(root, filePath);

  if (!existsSync(fullPath)) {
    return "";
  }

  return readFileSync(fullPath, "utf8");
}

function getScopedSource(content, start, endMarkers = ["  async function ", "  function ", "  return ("]) {
  const startIndex = content.indexOf(start);

  if (startIndex < 0) {
    return "";
  }

  const candidates = endMarkers
    .map((marker) => content.indexOf(marker, startIndex + start.length))
    .filter((index) => index > startIndex);
  const endIndex = candidates.length ? Math.min(...candidates) : content.length;

  return content.slice(startIndex, endIndex);
}

function assertContract(contract) {
  const content = readSource(contract.file);
  const source = contract.scope ? getScopedSource(content, contract.scope.start, contract.scope.endMarkers) : content;
  const missing = [];

  if (!content) {
    missing.push("file missing");
  }

  if (contract.scope && !source) {
    missing.push(`scope missing: ${contract.scope.start}`);
  }

  for (const needle of contract.includes || []) {
    if (!source.includes(needle)) {
      missing.push(needle);
    }
  }

  for (const pattern of contract.patterns || []) {
    if (!pattern.test(source)) {
      missing.push(pattern.toString());
    }
  }

  results.push({
    name: contract.name,
    file: contract.file,
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : "interaction contract present"
  });
}

const contracts = [
  {
    name: "dashboard_run_pipeline",
    file: "src/app/page.tsx",
    scope: { start: "async function handleRunPipeline()" },
    includes: ["/api/pipeline/run", "setRunningPipeline(true)", "await refresh()", "messageApi.success", "messageApi.error", "setRunningPipeline(false)"]
  },
  {
    name: "dashboard_pipeline_export",
    file: "src/app/page.tsx",
    scope: { start: "async function handleExportPipelineRuns()" },
    includes: ["/api/pipeline/runs/export", "navigator.clipboard.writeText", "messageApi.success", "messageApi.error", "setExportingPipelineRuns(false)"]
  },
  {
    name: "dashboard_pipeline_filters",
    file: "src/app/page.tsx",
    includes: ["pipelineStatusLabels", "pipelineStatusFilter", "pipelineWeekFilter", "filteredPipelineRuns", "按运行状态筛选", "按周次筛选", "当前筛选没有 Pipeline 记录", "清空筛选"]
  },
  {
    name: "dashboard_action_queue",
    file: "src/app/page.tsx",
    includes: [
      "DashboardActionItem",
      "dashboardActionStepLabels",
      "dashboardActionStepColors",
      "dashboardActionItems",
      "dashboardActionTotal",
      "highestPriorityAction",
      "draftByTaskId",
      "publishRecordByTaskId",
      "candidateByGeoResultId",
      "getPlanNextStep",
      "getBlogNextStep",
      "getGeoNextStep",
      "getDashboardActionText",
      "currentAction",
      "entryLabel",
      "执行队列",
      "事项",
      "数量",
      "周计划待确认",
      "稿件待生成/排查",
      "终稿待处理",
      "发布侧待处理",
      "博客待处置",
      "GEO 待处置",
      "可进入复盘",
      "当前优先处理",
      "当前状态",
      "下一步",
      "处理动作",
      "可执行入口"
    ]
  },
  {
    name: "dashboard_overview_closure",
    file: "src/app/page.tsx",
    includes: [
      "DashboardOverviewStep",
      "DashboardOverviewItem",
      "dashboardOverviewStepLabels",
      "dashboardOverviewStepColors",
      "dashboardOverviewItems",
      "blogNeedsWorkCount",
      "geoNeedsWorkCount",
      "官网博客与 GEO 概览",
      "博客候选与 SEO/GEO 诊断",
      "GEO 命中与官网引用",
      "AI Bot 日志可信度",
      "GEO 命中率",
      "当前状态",
      "下一步",
      "处理动作",
      "可执行入口",
      "去博客侧",
      "去导入",
      "去周报"
    ]
  },
  {
    name: "dashboard_pipeline_closure",
    file: "src/app/page.tsx",
    includes: [
      "PipelineRunNextStep",
      "pipelineRunNextStepLabels",
      "pipelineRunNextStepColors",
      "getPipelineRunNextStep",
      "getPipelineRunActionText",
      "getPipelineRunEntry",
      "Pipeline 运行记录",
      "进入周报",
      "补齐缺口",
      "排查后重跑",
      "下一步",
      "处理动作",
      "可执行入口",
      "看接入"
    ]
  },
  {
    name: "weekly_plan_generate_confirmed",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["handleGeneratePlan", "/api/weekly-plans/generate", "await refresh()", "loading={generating}", "Popconfirm", "确认生成新的周计划？", "messageApi.success", "messageApi.error"]
  },
  {
    name: "weekly_plan_batch_confirm",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["handleConfirmTasks", "/api/content-tasks/confirm", "selectedTaskIds", "rowSelection", "loading={batchConfirming}", "Popconfirm", "确认批量确认任务？", "await refresh()"]
  },
  {
    name: "weekly_plan_single_confirm",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["handleConfirmTasks([record.id])", "确认这个任务？", "loading={confirmingTaskId === record.id}", "disabled={record.status !== \"planned\"}"]
  },
  {
    name: "weekly_plan_edit_modal",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["openTaskEditor", "handleSaveTask", "`/api/content-tasks/${editingTask.id}`", "method: \"PATCH\"", "Modal", "confirmLoading={savingTask}", "await refresh()"]
  },
  {
    name: "weekly_plan_regenerate_title_confirmed",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["handleRegenerateTitle", "regenerate-title", "loading={regeneratingTaskId === record.id}", "Popconfirm", "确认重生成标题？", "await refresh()"]
  },
  {
    name: "weekly_plan_delete_task_confirmed",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["handleDeleteTask", "method: \"DELETE\"", "确认删除这个任务？", "loading={deletingTaskId === record.id}", "danger", "await refresh()"]
  },
  {
    name: "weekly_plan_filters",
    file: "src/app/weekly-plan/page.tsx",
    includes: ["statusFilter", "channelFilter", "productFilter", "filteredTasks", "按状态筛选", "按渠道筛选", "按产品筛选", "当前筛选没有周计划任务", "清空筛选"]
  },
  {
    name: "weekly_plan_execution_context",
    file: "src/app/weekly-plan/page.tsx",
    includes: [
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
      "周计划共",
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
    ]
  },
  {
    name: "today_batch_generate_confirmed",
    file: "src/app/today/page.tsx",
    includes: ["handleBatchGenerate", "/api/content-tasks/batch-generate", "loading={batchGenerating}", "Popconfirm", "确认批量生成今日文章？", "await refresh()"]
  },
  {
    name: "today_single_generate_confirmed",
    file: "src/app/today/page.tsx",
    includes: ["handleGenerateTask", "`/api/content-tasks/${taskId}/generate`", "loading={generatingTaskId === task.id}", "Popconfirm", "确认生成这篇稿件？", "await refresh()"]
  },
  {
    name: "today_filters",
    file: "src/app/today/page.tsx",
    includes: ["statusFilter", "channelFilter", "productFilter", "filteredTodayTasks", "按状态筛选", "按渠道筛选", "按产品筛选", "清空筛选", "当前筛选没有任务"]
  },
  {
    name: "today_draft_readiness",
    file: "src/app/today/page.tsx",
    includes: [
      "draftStatusLabels",
      "generationStatusLabels",
      "draftByTaskId",
      "今日任务共",
      "当前还没有稿件",
      "待生成",
      "重新生成",
      "终稿确认"
    ]
  },
  {
    name: "today_next_step",
    file: "src/app/today/page.tsx",
    includes: [
      "TodayNextStep",
      "todayNextStepLabels",
      "todayNextStepColors",
      "getTodayNextStep",
      "getTodayActionText",
      "renderTodayEntry",
      "publishRecordByTaskId",
      "当前优先",
      "生成/排查",
      "终稿处理",
      "发布承接",
      "可复盘",
      "下一步",
      "处理动作",
      "可执行入口",
      "回周计划确认",
      "人工发布",
      "去复盘"
    ]
  },
  {
    name: "draft_save_edit_feedback",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: ["handleSaveDraft", "`/api/article-drafts/${draft.id}`", "method: \"PATCH\"", "loading={saving}", "messageApi.success", "messageApi.error", "await refresh()"]
  },
  {
    name: "draft_regenerate_confirmed",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: ["handleRegenerateDraft", "`/api/content-tasks/${task.id}/generate`", "Popconfirm", "确认重新生成稿件？", "loading={regenerating}", "await refresh()"]
  },
  {
    name: "draft_approve_confirmed",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: ["handleApproveDraft", "`/api/article-drafts/${draft.id}/approve`", "Popconfirm", "确认加入发布队列？", "loading={approving}", "await refresh()", "router.push(\"/publish\")"]
  },
  {
    name: "draft_context_panel",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: [
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
    ]
  },
  {
    name: "draft_next_step",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: [
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
      "去周报复盘"
    ]
  },
  {
    name: "publish_export_feedback",
    file: "src/app/publish/page.tsx",
    includes: ["handleExport", "/api/publish-records/export", "loading={exporting}", "messageApi.success", "messageApi.error", "await refresh()"]
  },
  {
    name: "publish_mark_published_confirmed",
    file: "src/app/publish/page.tsx",
    includes: ["handleMarkPublished", "`/api/publish-records/${recordId}/published`", "Popconfirm", "确认标记为已发布？", "loading={markingRecordId === record.id}", "await refresh()"]
  },
  {
    name: "publish_url_modal",
    file: "src/app/publish/page.tsx",
    includes: ["handleFillUrl", "`/api/publish-records/${fillingRecord.id}/url`", "title=\"回填发布 URL\"", "publishedUrl", "await refresh()", "URL 已回填"]
  },
  {
    name: "publish_manual_metrics_modal",
    file: "src/app/publish/page.tsx",
    includes: [
      "openMetricsModal",
      "handleSaveMetrics",
      "`/api/publish-records/${metricsRecord.id}/metrics`",
      "method: \"PATCH\"",
      "Modal",
      "title=\"录入渠道指标\"",
      "InputNumber",
      "confirmLoading={savingMetrics}",
      "await refresh()",
      "渠道指标已保存"
    ]
  },
  {
    name: "publish_channel_metrics_import",
    file: "src/app/publish/page.tsx",
    includes: [
      "handleImportMetrics",
      "/api/channel-metrics/import",
      "metricsFilePath",
      "metricsCsv",
      "Popconfirm",
      "确认导入渠道数据？",
      "loading={importingMetrics}",
      "await refresh()",
      "渠道数据导入完成"
    ]
  },
  {
    name: "publish_queue_filters",
    file: "src/app/publish/page.tsx",
    includes: ["publishStatusLabels", "statusFilter", "channelFilter", "filteredPublishRecords", "按发布状态筛选", "按渠道筛选", "当前筛选没有发布记录", "清空筛选"]
  },
  {
    name: "publish_execution_context",
    file: "src/app/publish/page.tsx",
    includes: [
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
      "去周报复盘",
      "productLabels",
      "contentTypeLabels"
    ]
  },
  {
    name: "blog_sync_feedback",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["handleSync", "/api/blog-articles/sync", "blogSourceUrl", "blogSourcePath", "blogText", "Popconfirm", "确认同步博客内容？", "确认导入博客数据？", "loading={syncing}", "await refresh()", "博客同步完成"]
  },
  {
    name: "blog_log_import_feedback",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["handleImportLog", "/api/log-imports", "logSourceType", "logFilePath", "logText", "Popconfirm", "确认导入 AI Bot 日志？", "loading={importingLog}", "await refresh()", "日志导入完成"]
  },
  {
    name: "blog_diagnose_feedback",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["handleDiagnose", "`/api/blog-articles/${id}/diagnose`", "loading={diagnosingId === article.id}", "await refresh()", "博客诊断完成"]
  },
  {
    name: "blog_candidate_feedback",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["handleAddCandidate", "`/api/blog-articles/${id}/candidate`", "loading={addingCandidateId === article.id}", "await refresh()", "已加入博客候选池"]
  },
  {
    name: "blog_monitor_filters",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["indexedStatusLabels", "geoResultLabels", "indexedStatusFilter", "geoResultFilter", "dataConfidenceFilter", "filteredBlogArticles", "按收录状态筛选", "按 GEO 结果筛选", "按数据来源筛选", "当前筛选没有博客记录", "清空筛选"]
  },
  {
    name: "blog_monitor_next_step",
    file: "src/app/blog-monitor/page.tsx",
    includes: [
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
      "Link href=\"/weekly-plan\"",
      "Link href=\"/weekly-report\""
    ]
  },
  {
    name: "blog_candidate_add_confirmed",
    file: "src/app/blog-candidates/page.tsx",
    includes: ["handleAddCandidate", "`/api/blog-articles/${id}/candidate`", "method: \"POST\"", "Popconfirm", "确认加入候选池？", "loading={addingCandidateId === record.id}", "确认入池", "await refresh()"]
  },
  {
    name: "blog_candidate_mark_planned_confirmed",
    file: "src/app/blog-candidates/page.tsx",
    includes: ["handleMarkPlanned", "`/api/blog-articles/${id}/candidate`", "method: \"PATCH\"", "status: \"planned\"", "Popconfirm", "确认标记为已规划？", "loading={planningCandidateId === record.id}", "await refresh()"]
  },
  {
    name: "blog_candidate_create_task_confirmed",
    file: "src/app/blog-candidates/page.tsx",
    includes: ["handleCreateContentTask", "`/api/blog-articles/${id}/candidate/task`", "method: \"POST\"", "Popconfirm", "确认生成渠道补强任务？", "loading={creatingTaskId === record.id}", "生成任务", "await refresh()"]
  },
  {
    name: "blog_candidate_dismiss_confirmed",
    file: "src/app/blog-candidates/page.tsx",
    includes: ["handleDismissCandidate", "`/api/blog-articles/${id}/candidate`", "method: \"DELETE\"", "Popconfirm", "确认移出候选池？", "loading={dismissingCandidateId === record.id}", "await refresh()", "candidateStatus !== \"dismissed\""]
  },
  {
    name: "blog_candidate_filters",
    file: "src/app/blog-candidates/page.tsx",
    includes: ["candidateSourceLabels", "candidatePriorityLabels", "candidateStatusLabels", "sourceFilter", "priorityFilter", "candidateStatusFilter", "dataConfidenceFilter", "filteredCandidates", "按来源筛选", "按优先级筛选", "按候选状态筛选", "按数据来源筛选", "当前筛选没有博客候选主题", "清空筛选"]
  },
  {
    name: "blog_candidate_next_step",
    file: "src/app/blog-candidates/page.tsx",
    includes: [
      "candidateNextStepLabels",
      "candidateNextStepColors",
      "getCandidateNextStep",
      "getCandidateActionText",
      "renderCandidateEntry",
      "renderCandidateMaintenance",
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
      "看周计划"
    ]
  },
  {
    name: "geo_batch_run_confirmed",
    file: "src/app/geo-test/page.tsx",
    includes: ["handleRunGeoTests", "/api/geo-tests/run", "platforms", "promptGroup", "Popconfirm", "确认批量运行 GEO 测试？", "loading={running}", "await refresh()"]
  },
  {
    name: "geo_override_modal_confirmed",
    file: "src/app/geo-test/page.tsx",
    includes: ["handleSaveOverride", "`/api/geo-test-results/${overrideResult.id}/override`", "Modal", "确认保存人工修正？", "overrideValues", "await refresh()"]
  },
  {
    name: "geo_candidate_confirmed",
    file: "src/app/geo-test/page.tsx",
    includes: ["handleAddCandidate", "`/api/geo-test-results/${resultId}/candidate`", "Popconfirm", "确认加入博客候选池？", "loading={addingCandidateId === result.id}", "入候选池", "await refresh()"]
  },
  {
    name: "geo_result_filters",
    file: "src/app/geo-test/page.tsx",
    includes: ["promptGroupLabels", "executionStatusLabels", "platformFilter", "promptGroupFilter", "executionStatusFilter", "jotoMentionFilter", "officialCitationFilter", "dataConfidenceFilter", "filteredGeoResults", "按平台筛选", "按 Prompt 组筛选", "按执行状态筛选", "按 JOTO 提及筛选", "按官网引用筛选", "当前筛选没有 GEO 测试结果", "清空筛选"]
  },
  {
    name: "geo_result_next_step",
    file: "src/app/geo-test/page.tsx",
    includes: [
      "geoIssueLevelLabels",
      "geoNextStepLabels",
      "geoCandidateStatusLabels",
      "candidateByGeoResultId",
      "getGeoIssueLevel",
      "getGeoNextStep",
      "getGeoSuggestionReason",
      "getGeoActionText",
      "renderGeoEntry",
      "renderGeoMaintenance",
      "GEO 结果共",
      "待配置/排查",
      "问题级别",
      "候选状态",
      "建议原因",
      "下一步",
      "处理动作",
      "可执行入口",
      "维护",
      "建议入候选池",
      "补官网引用",
      "Link href=\"/ai-config\"",
      "Link href=\"/blog-candidates\"",
      "Link href=\"/weekly-plan\"",
      "Link href=\"/weekly-report\"",
      "disabled={cannotAddCandidate}"
    ]
  },
  {
    name: "weekly_report_generate",
    file: "src/app/weekly-report/page.tsx",
    includes: [
      "handleGenerateReport",
      "`/api/weekly-reports/${weeklyPlan.weekStart}`",
      "loading={generating}",
      "messageApi.success(\"周报已生成\")",
      "nextWeekSuggestions",
      "reportBlogDiagnostics",
      "reportGeoResults",
      "官网博客诊断复盘",
      "GEO 测试明细",
      "renderChannelMetrics"
    ]
  },
  {
    name: "weekly_report_markdown_export",
    file: "src/app/weekly-report/page.tsx",
    includes: ["handleExportMarkdown", "`/api/weekly-reports/${weeklyPlan.weekStart}/export`", "navigator.clipboard.writeText", "loading={exportingMarkdown}", "导出 Markdown", "messageApi.success", "messageApi.error"]
  },
  {
    name: "weekly_report_next_plan_confirmed",
    file: "src/app/weekly-report/page.tsx",
    includes: ["handleCreateNextPlan", "`/api/weekly-reports/${weeklyPlan.weekStart}/next-plan`", "Popconfirm", "确认生成下周计划草稿？", "loading={creatingNextPlan}", "await refresh()", "messageApi.success", "messageApi.error"]
  },
  {
    name: "weekly_report_detail_filters",
    file: "src/app/weekly-report/page.tsx",
    includes: ["publishStatusLabels", "blogGeoResultLabels", "geoExecutionStatusLabels", "publishStatusFilter", "blogGeoResultFilter", "geoExecutionStatusFilter", "filteredReportPublishRecords", "filteredReportBlogDiagnostics", "filteredReportGeoResults", "按发布状态筛选", "按博客 GEO 结果筛选", "按 GEO 执行状态筛选", "当前筛选没有渠道执行记录", "当前筛选没有博客诊断记录", "当前筛选没有 GEO 测试明细", "清空筛选"]
  },
  {
    name: "weekly_report_action_queue",
    file: "src/app/weekly-report/page.tsx",
    includes: [
      "ReportActionStep",
      "reportActionStepLabels",
      "reportActionStepColors",
      "createReportActionItems",
      "actionText",
      "queuedPublishCount",
      "missingUrlCount",
      "missingMetricsCount",
      "blogCandidateCount",
      "geoConfigCount",
      "geoCandidateCount",
      "reportActionItems",
      "reportActionTotal",
      "highestPriorityReportAction",
      "复盘行动队列",
      "当前行动项",
      "处理动作",
      "去发布队列",
      "处理候选池",
      "看 AI 配置",
      "去 GEO 测试",
      "看周计划"
    ]
  },
  {
    name: "weekly_report_suggestion_closure",
    file: "src/app/weekly-report/page.tsx",
    includes: [
      "WeeklySuggestionStep",
      "WeeklySuggestionAction",
      "weeklySuggestionStepLabels",
      "weeklySuggestionStepColors",
      "createWeeklySuggestionActions",
      "weeklySuggestionActions",
      "renderWeeklySuggestionEntry",
      "下周建议",
      "先生成周报",
      "复核建议",
      "生成计划草稿",
      "建议",
      "下一步",
      "处理动作",
      "可执行入口",
      "生成周报",
      "生成计划",
      "看周计划"
    ]
  },
  {
    name: "knowledge_create_edit_modal",
    file: "src/app/knowledge/page.tsx",
    includes: ["openCreateModal", "openEditModal", "handleSaveKnowledgeBase", "/api/knowledge-bases", "`/api/knowledge-bases/${editingKnowledgeBase.id}`", "Modal", "confirmLoading={saving}", "await refresh()"]
  },
  {
    name: "knowledge_toggle_status",
    file: "src/app/knowledge/page.tsx",
    includes: ["handleToggleStatus", "`/api/knowledge-bases/${record.id}`", "nextStatus", "loading={togglingId === record.id}", "await refresh()"]
  },
  {
    name: "knowledge_filters",
    file: "src/app/knowledge/page.tsx",
    includes: ["knowledgeTypeLabels", "trustLevelLabels", "typeFilter", "trustLevelFilter", "statusFilter", "filteredKnowledgeBases", "visibleKnowledgeBases", "getKnowledgeTimestamp", "按知识库类型筛选", "按可信等级筛选", "按启用状态筛选", "当前筛选没有知识库条目", "清空筛选"]
  },
  {
    name: "knowledge_readiness_next_step",
    file: "src/app/knowledge/page.tsx",
    includes: [
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
    ]
  },
  {
    name: "settings_save_feedback",
    file: "src/app/settings/page.tsx",
    includes: ["handleSave", "/api/workspace-settings", "method: \"PATCH\"", "loading={saving}", "await refresh()", "设置已保存"]
  },
  {
    name: "settings_rule_summary",
    file: "src/app/settings/page.tsx",
    includes: ["finalReviewModeLabels", "logModeLabels", "Form.useWatch", "当前规则概览", "发布节奏与范围", "执行与采集规则", "恢复当前保存配置", "已恢复当前保存配置"]
  },
  {
    name: "settings_rule_readiness",
    file: "src/app/settings/page.tsx",
    includes: [
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
      "GEO 平台",
      "下一步",
      "处理动作",
      "可执行入口",
      "规则可用",
      "未选择渠道",
      "配置日志",
      "看真实接入",
      "去 GEO 测试",
      "去周计划",
      "保存设置"
    ]
  },
  {
    name: "ai_config_diagnostics",
    file: "src/app/ai-config/page.tsx",
    includes: ["handleTestCapability", "handleTestAllCapabilities", "loadConfigStatus", "PageErrorState", "配置状态加载失败", "/api/config-diagnostics", "/api/runtime-config/status", "testingKey", "testingAll", "messageApi", "复制 .env.local 模板"]
  },
  {
    name: "ai_config_filters",
    file: "src/app/ai-config/page.tsx",
    includes: ["capabilityStatusLabels", "capabilityStatusFilter", "filteredProviders", "filteredCapabilities", "按配置状态筛选", "当前筛选没有 Provider", "当前筛选没有能力状态", "当前筛选没有真实接入项", "清空筛选"]
  },
  {
    name: "ai_config_next_step",
    file: "src/app/ai-config/page.tsx",
    includes: [
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
    ]
  },
  {
    name: "real_integration_diagnostics",
    file: "src/app/real-integration/page.tsx",
    includes: ["handleRunAllDiagnostics", "handleTestCapability", "loadCapabilities", "外部配置状态加载失败", "/api/config-diagnostics", "/api/runtime-config/status", "testingKey", "runningAll", "刷新配置状态", "刷新运行态", "PageErrorState"]
  },
  {
    name: "real_integration_filters",
    file: "src/app/real-integration/page.tsx",
    includes: ["integrationGroupLabels", "integrationStatusLabels", "integrationGroupFilter", "integrationStatusFilter", "filteredIntegrationItems", "按接入类型筛选", "按配置状态筛选", "当前筛选没有真实接入项", "清空筛选"]
  },
  {
    name: "real_integration_next_step",
    file: "src/app/real-integration/page.tsx",
    includes: [
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
      "GEO 试跑",
      "同步博客",
      "导入日志",
      "下一步",
      "处理动作",
      "可执行入口",
      "看配置",
      "去试跑",
      "去导入",
      "跑 MySQL 检查",
      "手动试跑",
      "跑 Worker",
      "接定时任务",
      "确认模板"
    ]
  },
  {
    name: "real_integration_sequence_closure",
    file: "src/app/real-integration/page.tsx",
    includes: [
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
    ]
  }
];

for (const contract of contracts) {
  assertContract(contract);
}

const failed = results.filter((item) => !item.ok);

console.log(
  JSON.stringify(
    {
      script: "smoke-interactions",
      status: failed.length ? "failed" : "success",
      passed: results.length - failed.length,
      failed: failed.length,
      results
    },
    null,
    2
  )
);

if (failed.length) {
  process.exitCode = 1;
}
