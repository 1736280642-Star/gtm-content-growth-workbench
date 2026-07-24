import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const results = [];
const migratedV5FoundationContracts = new Set([
  "real_integration_business_wording_contract",
  "knowledge_import_contract",
  "knowledge_detail_contract",
  "distilled_terms_contract",
  "ai_config_governance_contract"
]);

function readSource(filePath) {
  const fullPath = join(root, filePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function getScopedSource(content, start, endMarkers = ["  async function ", "  function ", "  return ("]) {
  const startIndex = content.indexOf(start);
  if (startIndex < 0) return "";
  const candidates = endMarkers.map((marker) => content.indexOf(marker, startIndex + start.length)).filter((index) => index > startIndex);
  const endIndex = candidates.length ? Math.min(...candidates) : content.length;
  return content.slice(startIndex, endIndex);
}

function assertContract(contract) {
  if (migratedV5FoundationContracts.has(contract.name)) return;
  const content = readSource(contract.file);
  const source = contract.scope ? getScopedSource(content, contract.scope.start, contract.scope.endMarkers) : content;
  const missing = [];

  if (!content) missing.push("file missing");
  if (contract.scope && !source) missing.push(`scope missing: ${contract.scope.start}`);

  for (const needle of contract.includes || []) {
    if (!source.includes(needle)) missing.push(needle);
  }

  for (const needle of contract.excludes || []) {
    if (source.includes(needle)) missing.push(`unexpected:${needle}`);
  }

  results.push({
    name: contract.name,
    file: contract.file,
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : "interaction contract present"
  });
}

const weeklyReportInternalExcludes = [
  "固定 Prompt 模板",
  "蒸馏词矩阵复盘\" style",
  "openDetailDrawer(\"prompt\")",
  "内部 Prompt 版本",
  "detailDrawer === \"prompt\"",
  "建议后验评估详情",
  "openDetailDrawer(\"recommendation_outcomes\")",
  "detailDrawer === \"recommendation_outcomes\"",
  "完成率变化",
  "回传率变化",
  "渠道表现变化",
  "Prompt 版本",
  "Prompt / AI 配置",
  "模型 trace",
  "证据 Chunk",
  "模型学习信号",
];

const weeklyReportBusinessExcludes = ["置信度", "低置信度", "置信度低于 65%", "Math.round((record.confidence", "AI Provider"];

const contracts = [
  {
    name: "v5_frontend_capture_tabs_contract",
    file: "src/app/ai-front-test/page.tsx",
    includes: ["采集任务", "回答与引用证据", "任务对比", "立即执行一次", "NewCaptureTaskDialog"],
    excludes: ["D3", "D7", "D14", "D30", "周期计划"]
  },
  {
    name: "v5_capture_comparison_contract",
    file: "src/components/CaptureComparisonWorkspace.tsx",
    includes: ["同一问题", "两次采集条件不一致", "不生成趋势结论", "baselineTaskId", "comparisonTaskId"]
  },
  {
    name: "v5_capture_gap_routing_contract",
    file: "src/components/ObservationGapReviewDrawer.tsx",
    includes: ["blog_candidate", "knowledge_issue", "不会自动创建月度任务", "确认并分流", "业务去向"]
  },
  {
    name: "v5_monthly_observation_review_contract",
    file: "src/app/monthly-review/page.tsx",
    includes: ["问题级视图", "MonthlyPlan", "已发布内容", "指标", "AI 前台测试", "Proposal", "useMonthlyObservationReview"],
    excludes: ["修改渠道配额", "自动创建月度任务"]
  },
  {
    name: "v5_site_audit_merged_tab_contract",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["/blog-monitor?tab=site-audit", "SiteAuditPanel", "两套对象、状态和指标保持独立"]
  },
  {
    name: "v5_foundation_question_pool_contract",
    file: "src/app/questions-keywords/page.tsx",
    includes: ["问题与关键词池", "问题库", "关键词库", "内容覆盖", "待决策", "选择为本月目标问题", "/api/v5/questions/select-monthly", "/api/v5/question-decision-exceptions/batch-resolve"],
    excludes: ["子意图", "内容角色"]
  },
  {
    name: "v5_foundation_question_service_contract",
    file: "src/lib/v5/question-service.ts",
    includes: ["AVAILABLE_CONFIDENCE = 0.75", "decisionConflictTypes", '"subject", "relationship", "safety"', "questionVersionId: question.currentVersionId", "monthlyQuestionLocks", "V5_KEYWORD_ALGORITHM_VERSION"],
    excludes: ["pending_approval"]
  },
  {
    name: "v5_foundation_knowledge_workspace_contract",
    file: "src/app/knowledge/[id]/page.tsx",
    includes: ["资料 ${knowledgeBase.materialCount}", "系统理解", "待处理 ${openActions.length}", "查看依据", "技术信息", "不阻断整个知识库"],
    excludes: ["Source 数量", "Chunk 数量", "Claim 数量", "完整治理规则"]
  },
  {
    name: "v5_foundation_configuration_contract",
    file: "src/app/configuration/page.tsx",
    includes: ["配置管理", "文章表达预设", "目标读者（选填）", "写作重心（选填）", "结构（选填）", "篇幅", "CTA（选填）", "禁止风格（选填）", "其他（选填）", "未填写或无法映射的内容会遵循系统规则", "structureModules: modules", "凭证不回显"],
    excludes: ["API Key", "Secret", "完整 Prompt 原文", "Radio.Group", "适用文章类型", "适用渠道", "读者认知", "必须展开"]
  },
  {
    name: "v5_foundation_compatibility_redirects",
    file: "src/app/distilled-terms/page.tsx",
    includes: ["redirect(\"/questions-keywords\")"]
  },
  {
    name: "v5_monthly_strategy_workspace_contract",
    file: "src/components/MonthlyPlanConfigPanel.tsx",
    includes: [
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
      "onSave(cloneConfig(draft))",
      "月度策略草稿已保存",
      "配额已平衡"
    ],
    excludes: ["fetch(", "/api/", "workbench-state.json", "文章表达预设", "articleExpressionProfileVersionId"]
  },
  {
    name: "v5_article_type_library_contract",
    file: "src/app/monthly-matrix/content-types/page.tsx",
    includes: ["内容类型库", "系统起始模板不是固定枚举", "新建内容类型", "编辑新版本", "示例问题测试"],
    excludes: ["const contentTypes", "articleExpressionProfileVersionId", "workbench-state.json"]
  },
  {
    name: "v5_monthly_strategy_embedded_contract",
    file: "src/app/monthly-matrix/page.tsx",
    includes: [
      "内容策略包",
      "MonthlyStrategyTable",
      "运行生产预检",
      "批准内容策略包",
      "渠道成品总数",
      "进入批量生成中心",
      "useMonthlyWorkspace",
      "尚未配置月度业务目标"
    ],
    excludes: ["fetch(", "/api/", "v5-ui-mock-data", "v5DemoLabel"]
  },
  {
    name: "v5_batch_production_console_contract",
    file: "src/app/monthly-matrix/batch-generation/page.tsx",
    includes: [
      "生成可用内容",
      "系统自动检查、修复和恢复",
      "待补资料",
      "可用正文直接进入待排程",
      "BatchGenerationMatrixTable",
      "ScheduleCalendarLite",
      "key: \"content\"",
      "key: \"schedule\""
    ],
    excludes: ["key: \"quality\"", "key: \"exceptions\"", "ExceptionQueuePreview", "v5-ui-mock-data", "v5DemoLabel"]
  },
  {
    name: "v5_monthly_repository_contract",
    file: "src/lib/v5/monthly-repository.ts",
    includes: [
      "V5_MONTHLY_STATE_PATH",
      "data/v5-monthly-workbench.json",
      "readV5MonthlyState",
      "updateV5MonthlyState",
      "temporaryPath",
      "rename(temporaryPath, statePath)",
      "idempotency",
      "auditLog"
    ],
    excludes: ["workbench-state.json", "apiKey", "secretKey"]
  },
  {
    name: "v5_monthly_service_guard_contract",
    file: "src/lib/v5/monthly-service.ts",
    includes: [
      "WORKBENCH_STATE_PATH",
      "WRITE_ROLES",
      "assertWritableRole",
      "validateMonthlyPlan",
      "expectedVersion",
      "idempotencyHeader",
      "IDEMPOTENCY_KEY_REUSED",
      "MONTHLY_PLAN_VERSION_CONFLICT"
    ],
    excludes: ["API_KEY", "process.env.OPENAI"]
  },
  {
    name: "v5_formal_monthly_contract_boundary",
    file: "src/lib/v5/monthly-contracts.ts",
    includes: ["V5MonthlyPlan", "V5MonthlyProductionReadiness", "V5ProductionPoolEntry"],
    excludes: [
      "V5MonthlyWorkspace",
      "MonthlyWorkspaceReadModel",
      "SaveMonthlyPlanRequest",
      "V5ApiEnvelope",
      "RulePackageOption"
    ]
  },
  {
    name: "v5_formal_monthly_plan_repository_contract",
    file: "src/lib/v5/monthly-plan-repository.ts",
    includes: [
      "monthly-contracts",
      "getV5GovernancePool",
      "readV5MonthlyPlanRecord",
      "SELECT * FROM monthly_plan WHERE plan_month = ? LIMIT 1"
    ],
    excludes: ["data/v5-monthly-workbench.json", "workbench-state.json"]
  },
  {
    name: "v5_formal_monthly_plan_service_contract",
    file: "src/lib/v5/monthly-plan-service.ts",
    includes: ["monthly-contracts", "readV5MonthlyPlanRecord", "getV5MonthlyPlan"],
    excludes: ["monthly-workspace-contracts", "workbench-state.json"]
  },
  {
    name: "v5_monthly_workspace_governance_contract",
    file: "src/lib/v5/monthly-workspace-governance.ts",
    includes: [
      "monthly-contracts",
      "getV5MonthlyPlan",
      "getV5MonthlyProductionReadiness",
      "getV5MonthlyProductionPool",
      "pending_config",
      "monthlyProductionReady",
      "approvedAt",
      "approvedBy"
    ],
    excludes: ["derived_v4"]
  },
  {
    name: "v5_monthly_workspace_read_model_contract",
    file: "src/lib/v5/monthly-workspace-read-model.ts",
    includes: [
      "monthly-contracts",
      "getMonthlyWorkspaceBase",
      "loadMonthlyWorkspaceGovernance",
      "getMonthlyWorkspaceReadModel",
      "governanceData",
      "formal"
    ],
    excludes: ["v5-ui-mock-data"]
  },
  {
    name: "v5_monthly_workspace_read_api_contract",
    file: "src/app/api/v5/monthly-workspace/route.ts",
    includes: ["getMonthlyWorkspaceReadModel", "cache-control", "no-store"],
    excludes: ["getV5MonthlyWorkspace"]
  },
  {
    name: "v5_monthly_api_routes_contract",
    file: "src/app/api/v5/monthly-plans/[month]/route.ts",
    includes: ["PUT", "parseSaveMonthlyPlanRequest", "saveV5MonthlyPlan", "x-idempotency-key", "V5ServiceError"],
    excludes: ["currentRole", "role:"]
  },
  {
    name: "v5_monthly_client_dedup_contract",
    file: "src/lib/v5/use-monthly-workspace.ts",
    includes: [
      "workspaceCache",
      "inFlightRequests",
      "/api/v5/monthly-workspace",
      "/api/v5/monthly-plans/",
      "expectedVersion",
      "x-idempotency-key"
    ],
    excludes: ["v5-ui-mock-data"]
  },
  {
    name: "v5_batch_grouping_contract",
    file: "src/components/BatchGenerationMatrixTable.tsx",
    includes: [
      "v5-production-group",
      "question",
      "contentType",
      "预览正文",
      "补充资料",
      "Drawer",
      "内容依据",
      "保存并自动复检"
    ],
    excludes: ["fetch(", "/api/", "softQualityScore", "hardRuleStatus", "claimCount", "EvidencePack", "Claim"]
  },
  {
    name: "v5_schedule_calendar_contract",
    file: "src/components/ScheduleCalendarLite.tsx",
    includes: [
      "人工排程日历",
      "悬浮日期查看具体排程",
      "trigger={[\"hover\", \"click\"]}",
      "v5-calendar-status-summary",
      "schedule-day-",
      "未排程内容"
    ],
    excludes: ["fetch(", "/api/"]
  },
  {
    name: "v5_daily_execution_boundary_contract",
    file: "src/app/daily-execution/page.tsx",
    includes: [
      "昨日",
      "今日",
      "明日",
      "本月已发布",
      "本月待发布",
      "已排程待发布",
      "未排程",
      "发布后的 URL 与效果数据统一在数据回传中补全",
      "PublishStatusTag"
    ],
    excludes: ["月度计划配置", "批量生成当月可生成内容", "回填 URL", "确认 URL", "fetch(", "/api/"]
  },
  {
    name: "weekly_plan_preview_contract",
    file: "src/app/weekly-plan/page.tsx",
    includes: [
      "周计划生成预览",
      "handleGeneratePlan",
      "/api/weekly-plans/generate",
      "handleConfirmTasks",
      "/api/content-tasks/confirm",
      "批量确认前复核",
      "可确认",
      "需复核",
      "getConfirmReviewReasons",
      "确认建议",
      "未达确认阈值",
      "getConfirmGuidance",
      "batchConfirmSummary",
      "mode",
      "weekly-publish-matrix",
      "weekly-plan-generate-form",
      "weekly-plan-table-filters",
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
      "主要来源",
      "辅助规则",
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
      "证据需求",
      "AI 生成理由",
      "主蒸馏词",
      "来源问题",
      "官网链接目标",
      "编辑记录",
      "editRecords",
      "接受风险并确认",
      "riskAcceptanceReason",
      "风险确认记录",
      "riskAcceptanceRecords"
    ],
    excludes: ["覆盖草稿", "发布队列", "进入今日发布</Button>"]
  },
  {
    name: "today_batch_publish_contract",
    file: "src/app/today/page.tsx",
    includes: [
      "今日发布",
      "handleBatchGenerate",
      "/api/content-tasks/batch-generate",
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
      "生成 Brief 与证据选择",
      "产品表达规则包",
      "getProductExpressionRuleForTask",
      "today-brief-rule-package-",
      "today-brief-rule-source-",
      "today-brief-rule-version-",
      "today-brief-rule-summary-",
      "知识库证据",
      "人工补充证据",
      "本地兜底稿",
      "getDraftGenerationIssueTags",
      "failureReasons",
      "fallbackTriggered",
      "selectedChunkIds",
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
      "/api/publish-records/${record.id}/distribution-targets",
      "/api/distribution-targets/${target.id}/send-draft",
      "handleMarkPublished",
      "/api/content-tasks/${task.id}/published",
      "handleFillUrl",
      "/api/content-tasks/${urlTask.id}/url",
      "today-write-platform-drafts-",
      "today-write-platform-drafts-confirm-",
      "today-confirm-published-",
      "today-fill-url-",
      "去数据回传"
    ],
    excludes: ["handleGenerateTask", "确认生成这篇稿件？", "已 fallback", "AI Provider", "Provider 配置"]
  },
  {
    name: "distribution_draft_model_contract",
    file: "src/lib/types.ts",
    includes: [
      "DistributionPlatformKey",
      "DistributionTargetStatus",
      "DistributionTargetErrorCode",
      "PlatformDraftVariant",
      "DistributionTarget"
    ]
  },
  {
    name: "distribution_store_contract",
    file: "src/lib/workbench-store.ts",
    includes: [
      "platformDraftVariants: PlatformDraftVariant[]",
      "distributionTargets: DistributionTarget[]",
      "createDistributionTargetsForPublishRecord",
      "getWechatsyncStatus",
      "checkDistributionPlatformAuth",
      "sendDistributionTargetDraft",
      "distribution_draft_created",
      "只有待发布状态的记录可以写入平台草稿箱。"
    ]
  },
  {
    name: "distribution_api_contract",
    file: "scripts/smoke-workflow.mjs",
    includes: [
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
    ]
  },
  {
    name: "direct_publish_contract",
    file: "src/lib/types.ts",
    includes: [
      "DirectPublishPlatformKey",
      "PublishScheduleStatus",
      "PublishAttemptStatus",
      "PublishFailureCode",
      "PlatformPublishPayload",
      "PublishSchedule",
      "PublishAttempt",
      "published_verified",
      "published_pending_url",
      "manual_takeover_required"
    ]
  },
  {
    name: "direct_publish_store_contract",
    file: "src/lib/workbench-store.ts",
    includes: [
      "publishSchedules: PublishSchedule[]",
      "publishAttempts: PublishAttempt[]",
      "createPublishSchedules",
      "runPublishSchedule",
      "runDuePublishSchedules",
      "direct_publish_attempt_finished",
      "正式发布排程已创建"
    ]
  },
  {
    name: "direct_publish_api_contract",
    file: "scripts/smoke-workflow.mjs",
    includes: [
      "direct_publish_schedule_create",
      "direct_publish_run_due",
      "direct_publish_four_platform_attempts",
      "/api/publish-schedules",
      "/api/direct-publish",
      "published_pending_url"
    ]
  },
  {
    name: "draft_second_qa_contract",
    file: "src/app/drafts/[taskId]/page.tsx",
    includes: [
      "草稿 AI 二次质检",
      "正文 Markdown 编辑",
      "draft-editor-stage",
      "draft-editor-main",
      "draft-inline-risk-panel",
      "draft-risk-rail",
      "draft-qa-status-card",
      "draft-markdown-editor",
      "draft-risk-segment",
      "showInlineRiskPreview",
      "showRiskRail",
      "正文风险定位",
      "本地规则稿",
      "AI 生成",
      "高风险！问题：",
      "handleSaveAndQa",
      "/api/article-drafts/${draft.id}",
      "AI 二次质检",
      "handleRestorePrevious",
      "handleDeleteFailedSegment",
      "handleRewriteFailedSegment",
      "handleKeepFailedSegment",
      "confirmKeepFailedSegment",
      "keptRiskSegments",
      "keepReasonCategory",
      "pendingKeepReasonCategory",
      "保留原因分类",
      "editActions",
      "pendingEditActions",
      "保留高风险片段",
      "保留高风险内容必须填写原因",
      "处理记录",
      "handleCopyFullText",
      "copyAllowed",
      "删除",
      "AI改写",
      "保留"
    ],
    excludes: ["Row gutter={16}", "<Col span", "handleRegenerateDraft", "handleApproveDraft", "确认加入发布队列", "AI Provider", "Provider", "Prompt", "issueCode", "ruleHit", "置信度", "confidence", "trace"]
  },
  {
    name: "data_return_contract",
    file: "src/app/publish/page.tsx",
    includes: ["数据回传", "handleImportMetrics", "/api/channel-metrics/import", "openMetricsModal", "handleSaveMetrics", "/api/publish-records/${metricsRecord.id}/metrics", "getDataReturnStatus", "回今日发布", "手动补录"],
    excludes: ["handleMarkPublished", "handleFillUrl", "/published"]
  },
  {
    name: "blog_monitor_diagnosis_contract",
    file: "src/app/blog-monitor/page.tsx",
    includes: ["getBlogAuditIndicators", "GEO 健康分", "引用准备不足", "引用片段不足", "问题分布", "官网信源状态", "优先处理问题", "博客明细", "getArticleTitle"],
    excludes: ["Chunk 不足", "Chunk 准备度", "GEO optimizer", "AI Bot PV", "AI crawler 可访问性", "FAQ / Schema 完整度"]
  },
  {
    name: "real_integration_business_wording_contract",
    file: "src/app/real-integration/page.tsx",
    includes: ["连接管理", "模型连接", "AI 访问量", "AI 访问数据", "GovernanceEntry"],
    excludes: ["AI Provider", "AI Bot PV", "AI Bot 数据可信度", "真实 Prompt", "GEO Prompt"]
  },
  {
    name: "knowledge_import_contract",
    file: "src/app/knowledge/page.tsx",
    includes: [
      "管理内容资产",
      "导入资料",
      "/knowledge/import",
      "批量选择",
      "合并知识库",
      "批量向量化",
      "编辑详情",
      "删除",
      "/knowledge/${record.id}",
      "rowSelection",
      "handleMergeSelected"
    ],
    excludes: ["trustLevelFilter", "按可信等级筛选", "统一导入链路", "promptTemplates", "查看详情"]
  },
  {
    name: "knowledge_detail_contract",
    file: "src/app/knowledge/[id]/page.tsx",
    includes: [
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
      "/api/knowledge-bases/${knowledgeBase.id}/sources",
      "/api/knowledge-bases/${knowledgeBase.id}/vectorize",
      "pending_config",
      "handleAppendSources",
      "handleVectorize"
    ],
    excludes: ["promptTemplates", "个 Chunk", "查看来源 Chunk", "产品表达规则包来源 Chunk", "confidence >= 0.65"]
  },
  {
    name: "knowledge_vectorize_contract",
    file: "src/app/knowledge/vectorize/page.tsx",
    includes: ["切片与向量化", "待解析知识库列表", "Embedding 模型", "检索策略", "确认解析", "/api/knowledge-bases/vectorize", "pending_config"],
    excludes: ["fake_embedding", "mock_embedding"]
  },
  {
    name: "knowledge_import_rule_package_linkage_contract",
    file: "src/app/knowledge/import/url/page.tsx",
    includes: ["规则包处理方式", "关联已有规则包", "linkedProductExpressionRulePackageId", "productExpressionRulePackageMode"],
    excludes: ["embeddingSimilarity", "rawAnswer"]
  },
  {
    name: "knowledge_document_rule_package_linkage_contract",
    file: "src/app/knowledge/import/document/page.tsx",
    includes: ["规则包处理方式", "关联已有规则包", "linkedProductExpressionRulePackageId", "productExpressionRulePackageMode", "/api/knowledge-bases/parse-documents", "FormData"],
    excludes: ["embeddingSimilarity", "rawAnswer"]
  },
  {
    name: "knowledge_document_parser_api_contract",
    file: "src/app/api/knowledge-bases/parse-documents/route.ts",
    includes: ["parseKnowledgeDocumentsFromFormData", "multipart/form-data", "failedCount"],
    excludes: ["TODO", "fake"]
  },
  {
    name: "knowledge_document_parser_service_contract",
    file: "src/lib/knowledge-document-parser.ts",
    includes: ["execFile", "mammoth", "parse-pdf-text.mjs", "parseKnowledgeDocumentFile", ".docx", ".pdf"],
    excludes: ["TODO", "fake"]
  },
  {
    name: "knowledge_url_blog_index_expansion_contract",
    file: "src/lib/workbench-store.ts",
    includes: ["isLoadingOnlyKnowledgeText", "expandBlogIndexFromSitemap", "isLikelyBlogIndexUrl", "startKnowledgeSiteImportJob", "startKnowledgeAutoImport", "importedUrls", "正在加载文章", "/sitemap.xml", "\\/articles\\/"],
    excludes: ["TODO", "fake"]
  },
  {
    name: "knowledge_auto_import_api_contract",
    file: "src/app/api/knowledge-bases/[id]/auto-import/route.ts",
    includes: ["startKnowledgeAutoImport", "pending_input"],
    excludes: ["TODO", "fake"]
  },
  {
    name: "knowledge_pdf_parser_subprocess_contract",
    file: "scripts/parse-pdf-text.mjs",
    includes: ["PDFParse", "getText", "JSON.stringify"],
    excludes: ["TODO", "fake"]
  },
  {
    name: "knowledge_rule_package_contract",
    file: "src/app/knowledge/rule-packages/page.tsx",
    includes: ["产品表达规则包", "新建规则包", "产品名称", "选择已有知识库", "关联导入资料", "linkedProductExpressionRulePackageId", "允许表达", "禁止表达", "确认生效", "回滚上一版本", "/product-expression"],
    excludes: ["rawAnswer", "rawCitationUrl", "embeddingSimilarity"]
  },
  {
    name: "knowledge_product_expression_api_contract",
    file: "src/app/api/knowledge-bases/[id]/product-expression/route.ts",
    includes: ["canManageProductExpressionRules", "readWorkbenchState", "403", "activateProductExpressionRuleDraft", "regenerateProductExpressionRuleDraft", "rollbackProductExpressionRuleDraft", "discardProductExpressionRuleDraft", "action === \"discard\""],
    excludes: ["TODO"]
  },
  {
    name: "distilled_terms_contract",
    file: "src/app/distilled-terms/page.tsx",
    includes: [
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
      "handleExtractTerm",
      "handleDeleteTerm",
      "handleArchiveTerm",
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
    ],
    excludes: ["人工复核", "逐条确认", "置信度", "confidence {", "formatConfidence"]
  },
  {
    name: "distilled_terms_auto_pool_api_contract",
    file: "src/app/api/distilled-terms/auto-pool/route.ts",
    includes: ["autoPoolDistilledTerms", "readRequestPayload", "status: result.ok ? 200 : 400"],
    excludes: ["TODO"]
  },
  {
    name: "distilled_terms_rule_draft_api_contract",
    file: "src/app/api/distilled-terms/rule-drafts/[id]/route.ts",
    includes: ["activateDistilledTermRuleDraft", "discardDistilledTermRuleDraft", "export async function PATCH", "export function DELETE"],
    excludes: ["TODO"]
  },
  {
    name: "weekly_plan_distilled_term_signal_contract",
    file: "src/lib/workbench-store.ts",
    includes: [
      "distilledTermSignals",
      "primaryDistilledTerm: item.term",
      "product: item.product",
      "buildTaskPlanContext(product, contentType, businessSignal?.sourceProblem, businessSignal?.primaryDistilledTerm)",
      "targetKeywords: planContext.targetKeywords",
      "state.distilledTerms = normalizeDistilledTerms([nextTerm, ...state.distilledTerms.filter((term) => term.id !== existing.id)])",
      "defaultDistilledTermExtractionRules",
      "distilledTermSemanticTemplates",
      "upsertDistilledTermRuleDraft",
      "activateDistilledTermRuleDraft"
    ]
  },
  {
    name: "weekly_report_matrix_contract",
    file: "src/app/weekly-report/page.tsx",
    includes: [
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
      "本周基础 KPI",
      "发布完成率",
      "数据回传率",
      "AI 复盘结论",
      "下周建议",
      "带入周计划草稿",
      "handleCreateNextPlan",
      "/api/weekly-reports/${activeReport.week}/next-plan",
      "建议采纳率",
      "建议偏差",
      "建议失败原因 Top 5",
      "模块执行情况",
      "suggestionFailureRows",
      "recommendationOutcomes",
      "内部学习样本",
      "planQualityFeedback",
      "计划质量反馈详情",
      "opsModuleRows",
      "采纳",
      "部分采纳",
      "拒绝",
      "/api/weekly-reports/${activeReport.week}/suggestions/${record.id}",
      "handleDecideSuggestion",
      "report-kpi-trend",
      "AI 可见度变化",
      "openDetailDrawer",
      "openDetailDrawer(\"suggestion_failures\")",
      "openDetailDrawer(\"plan_quality\")",
      "openDetailDrawer(\"ops_modules\")",
      "renderWeeklySuggestionEntry",
      "renderOpsModuleEntry",
      "进入配置管理"
    ],
    excludes: [...weeklyReportInternalExcludes, ...weeklyReportBusinessExcludes]
  },
  {
    name: "ai_config_governance_contract",
    file: "src/app/ai-config/page.tsx",
    includes: [
      "AI 配置",
      "Provider",
      "channelLabels",
      "productLabels",
      "contentTypeLabels",
      "Prompt 版本",
      "本地规则",
      "调用日志",
      "效果摘要",
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
      "fallback",
      "callLogs",
      "callLogModuleFilter",
      "callLogStatusFilter",
      "filteredCallLogs",
      "模型服务",
      "输出状态",
      "是否使用备用生成",
      "产品表达规则包",
      "productExpressionRuleVersion",
      "productExpressionRuleSource",
      "输入摘要",
      "输出摘要",
      "失败原因",
      "/api/ai-governance",
      "/api/prompt-versions/${id}",
      "handleViewPromptVersion",
      "handleRollbackPromptVersion",
      "const canViewFullGovernance = governanceData.access?.canViewFullGovernance === true",
      "if (!canViewFullGovernance)",
      "setCapabilities([])",
      "setDiagnostics({})",
      "renderRestrictedGovernance",
      "const pageHeaderTitle = canViewFullGovernance ? \"AI 配置\" : \"治理权限说明\"",
      "当前角色只看到业务引导；发布、复盘和知识库维护在对应页面继续处理。",
      "当前角色不显示模型与规则治理详情",
      "getDefaultRouteForRole",
      "getRouteLabel",
      "去{getRouteLabel(defaultRoute)}",
      "内容发布人员继续处理今日发布、草稿质检和数据回填。",
      "Prompt 原文",
      "调用日志详情",
      "申请回滚",
      "Prompt 版本说明"
    ],
    excludes: ["apiKey", "secretKey", "OPENAI_API_KEY="]
  },
  {
    name: "ai_governance_api_contract",
    file: "src/app/api/ai-governance/route.ts",
    includes: ["canViewAiGovernance", "state.promptVersions", "auditLog", "pipelineRuns", "draftSources", "callLogs", "moduleLabel", "inputSummary", "outputStatus", "fallbackTriggered", "failureReasons", "editReasonCategoryLabels", "keepRiskReasonCategoryLabels", "getEditReasonCategory", "editActionCount", "manualEditActionCount", "rewriteActionCount", "deleteRiskSegmentCount", "keepRiskSegmentCount", "qaAcceptedActionCount", "qaPartialAcceptedActionCount", "qaIgnoredActionCount", "qaSuspectedFalsePositiveCount", "qaSuspectedMissCount", "qaIssueRuleSummary", "editReasonSummary", "editReasonCategorySummary", "keepRiskReasonCategorySummary", "totalChangedCharacterCount", "manualEditChangedCharacterCount", "rewriteChangedCharacterCount", "maxChangedRatio", "averageChangedRatio", "manualEditAverageChangedRatio", "heavyEditCount", "productExpressionRuleVersion", "productExpressionRuleSource", "taskById", "publishRecordByDraftId", "taskId", "channel", "product", "contentType", "primaryDistilledTerm", "qaPassed", "qaBlockerCount", "qaWarningCount", "publishStatus", "dataReturned", "canViewFullGovernance", "当前角色只显示受限入口；模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"],
    excludes: ["process.env", "API_KEY"]
  },
  {
    name: "prompt_version_api_contract",
    file: "src/app/api/prompt-versions/[id]/route.ts",
    includes: ["canViewAiGovernance", "canManagePromptVersions", "status: \"failed\"", "403", "getPromptVersionDetail", "rollbackPromptVersion", "action === \"rollback\"", "当前角色无权查看模型规则版本详情。", "当前角色无权回滚模型规则版本。", "不支持的模型规则版本动作"],
    excludes: ["process.env", "API_KEY", "TODO"]
  },
  {
    name: "weekly_report_api_role_filter_contract",
    file: "src/app/api/weekly-reports/[week]/route.ts",
    includes: ["getWeeklyReportForRole", "readWorkbenchState", "state.workspaceSetting.currentRole", "force-dynamic", "GET"],
    excludes: ["getWeeklyReport(params.week)", "TODO"]
  },
  {
    name: "weekly_report_suggestion_api_contract",
    file: "src/app/api/weekly-reports/[week]/suggestions/[id]/route.ts",
    includes: ["canManageWeeklyReportSuggestions", "403", "decideWeeklyReportSuggestion", "filterWeeklyReportForRole", "readWorkbenchState", "state.workspaceSetting.currentRole", "PATCH"],
    excludes: ["TODO"]
  },
  {
    name: "role_navigation_contract",
    file: "src/components/AppShell.tsx",
    includes: ["getVisibleRoutesForRole", "canViewRoute", "getDefaultRouteForRole", "visibleNavItems", "当前角色无权进入此页面", "内部治理配置和排查信息", "不会渲染"],
    excludes: ["Prompt、模型日志、规则包", "Tooltip", "Popover"]
  },
  {
    name: "governance_entry_contract",
    file: "src/components/GovernanceEntry.tsx",
    includes: ["canViewRoute", "切换角色", "/configuration", "/settings"],
    excludes: ["Tooltip", "Popover", "workspaceRoleLabels", "联系工作台运营"]
  },
  {
    name: "role_settings_contract",
    file: "src/app/settings/page.tsx",
    includes: ["当前使用角色", "workspaceRoleLabels", "getVisibleRoutesForRole", "角色与可见范围", "currentRole"]
  },
  {
    name: "smoke_browser_responsive_contract",
    file: "scripts/smoke-browser.mjs",
    includes: [
      "setViewport",
      "normalizeScope",
      "full\", \"roles\", \"content\", \"responsive\", \"publish\", \"v5",
      "scope: smokeScope",
      "shouldRunRoles",
      "shouldRunContent",
      "shouldRunResponsive",
      "shouldRunPublish",
      "shouldRunV5",
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
      "v5_dashboard_scoped_replacement_desktop",
      "v5_dashboard_scoped_replacement_mobile",
      "v5_monthly_matrix_desktop",
      "v5_article_type_library_desktop",
      "v5_monthly_strategy_desktop",
      "v5_batch_generation_desktop",
      "v5_batch_generation_mobile",
      "v5_daily_execution_mobile",
      "v5_monthly_review_mobile",
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
    ]
  },
  {
    name: "package_split_browser_smoke_scripts",
    file: "package.json",
    includes: [
      "smoke:browser:roles",
      "smoke:browser:content",
      "smoke:browser:content:isolated",
      "smoke:browser:responsive",
      "smoke:browser:publish",
      "smoke:browser:v5",
      "--scope=roles",
      "--scope=content",
      "--scope=responsive",
      "--scope=publish",
      "--scope=v5"
    ]
  },
  {
    name: "permissions_contract",
    file: "src/lib/permissions.ts",
    includes: ["content_publisher", "content_growth", "workbench_operator", "knowledge_manager", "developer_admin", "getDefaultRouteForRole", "workspaceRouteLabels", "canViewAiGovernance", "canManagePromptVersions", "canManageProductExpressionRules", "canManageWeeklyReportSuggestions"]
  },
  {
    name: "prompt_templates_contract",
    file: "src/lib/prompt-templates.ts",
    includes: ["weekly_plan_generation", "channel_title", "evidence_selection", "batch_body_generation", "draft_second_qa", "inputContract", "outputContract", "failureRules"]
  },
  {
    name: "workflow_store_business_message_contract",
    file: "src/lib/workbench-store.ts",
    includes: ["未选择知识库证据片段", "已选证据片段 ID", "候选词未通过入池阈值", "已更新来源问题和入池记录"],
    excludes: ["未选择知识库 Chunk", "已选证据 Chunk", "候选词置信度", "来源问题和置信度"]
  },
  {
    name: "log_import_business_message_contract",
    file: "src/lib/log-import-adapter.ts",
    includes: ["AI 访问量汇总"],
    excludes: ["AI Bot 汇总"]
  },
  {
    name: "bot_visit_summary_business_message_contract",
    file: "src/app/api/bot-visit-summary/route.ts",
    includes: ["AI 访问量指标"],
    excludes: ["AI Bot 指标"]
  },
  {
    name: "ai_governance_business_summary_contract",
    file: "src/app/api/ai-governance/route.ts",
    includes: ["AI 访问日志", "通过真实模型接入生成正文", "本地兜底稿"],
    excludes: ["AI Bot 日志", "真实 AI Provider", "fallback 到本地规则"]
  },
  {
    name: "store_v3_contract",
    file: "src/lib/workbench-store.ts",
    includes: [
      "normalizeKnowledgeBase",
      "splitKnowledgeContent",
      "defaultDistilledTerms",
      "ContentTaskEditRecord",
      "buildContentTaskEditRecords",
      "getContentTaskReviewReasons",
      "editRecords",
      "normalizeDistilledTerms",
      "distilledTermMatrix",
      "getActivePromptVersion",
      "rollbackPromptVersion",
      "discardProductExpressionRuleDraft",
      "promptVersions",
      "getDefaultEvidenceSelection",
      "getProductExpressionRuleSelection",
      "buildMissingEvidenceItem",
      "evidenceByTaskId",
      "selectedChunkIds",
      "evidenceProfile",
      "productExpressionRuleVersion",
      "productExpressionRuleSource",
      "DraftGenerationFailure",
      "getDraftGenerationFailureReasons",
      "editActions",
      "getTextDiffStats",
      "inferKeepRiskReasonCategory",
      "normalizeKeepRiskReasonCategory",
      "changedCharacterCount",
      "changedRatio",
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
      "WeeklyRecommendationOutcome",
      "buildRecommendationOutcomes",
      "recommendationOutcomes",
      "sectionIndex"
    ]
  }
];

for (const contract of contracts) assertContract(contract);

const failed = results.filter((item) => !item.ok);

console.log(JSON.stringify({ script: "smoke-interactions", status: failed.length ? "failed" : "success", passed: results.length - failed.length, failed: failed.length, results }, null, 2));

if (failed.length) process.exitCode = 1;
