import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const checks = [];

function read(filePath) {
  const fullPath = join(root, filePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function addFileCheck(label, filePath) {
  checks.push({ label, pass: existsSync(join(root, filePath)), detail: filePath });
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

function addNodeSyntaxCheck(label, filePath) {
  const result = spawnSync(process.execPath, ["--check", join(root, filePath)], {
    cwd: root,
    encoding: "utf8"
  });
  checks.push({
    label,
    pass: result.status === 0,
    detail: result.status === 0 ? filePath : `${filePath}: ${(result.stderr || result.stdout || "syntax check failed").trim()}`
  });
}

const requiredFiles = [
  "docs/usage.md",
  "src/components/AppShell.tsx",
  "src/lib/permissions.ts",
  "src/lib/prompt-templates.ts",
  "src/app/monthly-matrix/page.tsx",
  "src/app/monthly-matrix/strategy/page.tsx",
  "src/app/monthly-matrix/content-types/page.tsx",
  "src/app/monthly-matrix/batch-generation/page.tsx",
  "src/app/daily-execution/page.tsx",
  "src/app/monthly-review/page.tsx",
  "src/app/monthly-plan/page.tsx",
  "src/app/geo-monitor/page.tsx",
  "src/app/today/page.tsx",
  "src/app/products/[productId]/page.tsx",
  "src/components/ProductMaterialImport.tsx",
  "src/app/knowledge/import/page.tsx",
  "src/app/knowledge/import/url/page.tsx",
  "src/app/knowledge/import/document/page.tsx",
  "src/app/api/v5/monthly-workspace/route.ts",
  "src/app/api/v5/monthly-plans/[month]/route.ts",
  "src/app/api/v5/monthly-reviews/[month]/route.ts",
  "src/app/api/v5/knowledge-imports/urls/route.ts",
  "src/app/api/v5/knowledge-imports/documents/route.ts",
  "src/app/api/v5/content-tasks/[taskId]/publish-result/route.ts",
  "src/lib/v5/monthly-contracts.ts",
  "src/lib/v5/monthly-plan-repository.ts",
  "src/lib/v5/monthly-plan-service.ts",
  "src/lib/v5/monthly-workspace-contracts.ts",
  "src/lib/v5/monthly-workspace-read-model.ts",
  "src/lib/v5/monthly-execution-repository.ts",
  "src/lib/v5/monthly-automation-service.ts",
  "src/lib/v5/geo-source-quality.ts",
  "src/lib/v5/rag/managed-source-contracts.ts",
  "src/lib/v5/rag/managed-source-import-api.ts",
  "src/lib/v5/rag/managed-source-import-service.ts",
  "src/lib/v5/rag/source-import-repository.ts",
  "src/lib/v5/rag/managed-claim-extraction-service.ts",
  "workers/knowledge-refresh-worker.mjs",
  "workers/content-production-worker.mjs",
  "workers/monthly-automation-worker.mjs",
  "workers/geo-research-orchestrator.mjs",
  "scripts/smoke-pages.mjs",
  "scripts/smoke-interactions.mjs",
  "scripts/smoke-workflow.mjs",
  "scripts/smoke-browser.mjs",
  "scripts/smoke-workflow-isolated.mjs",
  "scripts/smoke-browser-isolated.mjs",
  "database/migrations/20260727_012_v5_monthly_execution_closure.sql",
  "database/migrations/20260728_013_v5_managed_source_content.sql",
  // Phase 1: MCP contract & capture devices
  "database/migrations/20260809_017_v5_phase1_mcp_capture.sql",
  "src/app/api/v5/products/[productId]/promotion/route.ts",
  "src/app/api/v5/products/[productId]/strategy-pack/route.ts",
  "src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts",
  "src/app/api/v5/products/[productId]/sample-article/route.ts",
  "src/app/api/v5/products/[productId]/publish-account-binding/route.ts",
  "src/app/api/v5/products/[productId]/source-snapshot/route.ts",
  "src/app/api/v5/capture-devices/route.ts",
  "src/app/api/v5/capture-devices/[deviceId]/route.ts",
  "src/app/api/v5/capture-devices/[deviceId]/heartbeat/route.ts",
  "src/app/api/v5/capture-tasks/route.ts",
  "src/app/api/v5/capture-tasks/[id]/lease/route.ts",
  "src/app/api/v5/capture-evidence/route.ts",
  "src/app/api/v5/attribution/route.ts",
  "src/app/api/v5/tasks/responsibility/route.ts",
  "src/app/api/v5/tasks/attention/route.ts",
  "src/app/api/v5/monthly-overflow/route.ts",
  "src/lib/v5/monthly-overflow-service.ts",
  "src/lib/v5/product-registry-contracts.ts",
  "src/lib/v5/capture-repository.ts",
  "src/lib/v5/product-strategy-pack-repository.ts",
  "src/lib/v5/responsibility-read-service.ts",
  "scripts/phase1-mcp-smoke.test.mjs",
  "scripts/phase1-capture.integration.test.mjs",
  // Phase 1: MCP Server files
  "scripts/knowledge-mcp-server.mjs",
  "scripts/geo-research-mcp-server.mjs",
  "scripts/rag-retrieval-mcp-server.mjs",
  "scripts/observation-mcp-server.mjs",
  "scripts/capture-mcp-server.mjs",
  "scripts/publish-mcp-server.mjs",
  // Phase 2A: one user-facing product GEO strategy gate
  "database/migrations/20260810_019_v5_product_geo_strategy_pack_v2.sql",
  "database/migrations/20260810_020_v5_product_strategy_version.sql",
  "src/lib/v5/product-strategy-pack-contracts.ts",
  "src/lib/v5/product-strategy-pack-service.ts",
  "src/lib/v5/product-sample-article-service.ts",
  "src/components/ProductGeoStrategyPanel.tsx",
  "scripts/v5-product-geo-strategy-pack.test.mjs",
  "scripts/v5-product-geo-strategy-pack.integration.test.mjs"
  ,
  // Phase 2B: three-provider factual search + Zhipu semantic synthesis
  "src/lib/v5/geo-search-contracts.ts",
  "src/lib/v5/geo-search-adapters.ts",
  "src/lib/v5/geo-evidence-verifier.ts",
  "scripts/v5-geo-multi-search.test.mjs",
  "scripts/check-geo-search-provider-readiness.mjs",
  "scripts/check-geo-pilot-acceptance.mjs",
  "workers/typescript-loader.mjs"
  ,
  // Phase 2C: governed article type portfolio and atomic strategy approval
  "database/migrations/20260810_021_v5_strategy_article_type_portfolio.sql",
  "database/migrations/20260810_022_v5_strategy_article_type_migration_forward_fix.sql",
  // Phase 2D: immutable production contract and human sample calibration
  "database/migrations/20260810_023_v5_production_contract_and_sample_calibration.sql",
  "database/migrations/20260812_025_v5_product_sample_article.sql",
  "database/migrations/20260812_026_v5_product_publish_account_binding.sql",
  "database/migrations/20260812_027_v5_product_profile_human_override.sql",
  "database/migrations/20260812_028_v5_publish_observation_lifecycle.sql",
  "scripts/check-v5-publish-lifecycle-schema.mjs",
  "src/lib/v5/formal-production-contract-service.ts",
  "src/lib/v5/sample-calibration-contracts.ts",
  "src/lib/v5/sample-calibration-repository.ts",
  "src/components/SampleArticleReviewPanel.tsx",
  "src/components/ProductSampleArticlePanel.tsx",
  "scripts/v5-phase2d-production-contract.test.mjs",
  "scripts/v5-phase2d-sample-calibration.integration.test.mjs",
  // Phase 2E: LangGraph shadow orchestration with durable checkpointing
  "database/migrations/20260810_024_v5_geo_graph_workflow.sql",
  "src/lib/v5/graph/product-geo-workflow-contracts.ts",
  "src/lib/v5/graph/product-geo-workflow.ts",
  "src/lib/v5/graph/mysql-checkpoint-saver.ts",
  "src/lib/v5/graph/product-geo-workflow-repository.ts",
  "src/lib/v5/graph/product-geo-workflow-service.ts",
  "src/lib/v5/graph/product-geo-domain-shadow-ports.ts",
  "src/app/api/v5/products/[productId]/graph-shadow/route.ts",
  "scripts/v5-phase2e-graph-workflow.test.mjs",
  "scripts/v5-phase2e-mysql-checkpoint.integration.test.mjs",
  "scripts/v5-phase2e-shadow-ledger.integration.test.mjs",
  // Phase 2F: sample-calibrated batch and real account readiness gates
  "src/lib/v5/product-rollout-readiness-service.ts",
  "src/app/api/v5/products/[productId]/rollout-readiness/route.ts",
  "src/components/ProductRolloutReadinessPanel.tsx",
  "scripts/v5-phase2f-rollout-readiness.test.mjs",
  // Phase 2G: evidence-backed MonthlyReview proposals
  "scripts/v5-phase2g-monthly-review-contract.test.mjs",
  "scripts/v5-phase2g-publish-lifecycle.integration.test.mjs"
];

for (const filePath of requiredFiles) addFileCheck(`required file: ${filePath}`, filePath);

addContentCheck("monthly navigation", "src/components/AppShell.tsx", [
  "产品知识库",
  "/products",
  "/monthly-plan",
  "内容自动化",
  "/geo-monitor",
  "GEO 监控塔",
  "/settings"
]);
addContentCheck("monthly permissions", "src/lib/permissions.ts", [
  "/knowledge",
  "/monthly-plan",
  "/geo-monitor",
  "/settings",
  "canManageMonthlyReviewProposals"
]);
addContentCheck("monthly prompt", "src/lib/prompt-templates.ts", [
  "monthly_plan_generation",
  "月度计划生成模板",
  "批量生成中心"
]);
addContentCheck("monthly matrix workspace", "src/app/monthly-matrix/page.tsx", [
  "useMonthlyWorkspace",
  "MonthlyStrategyTable",
  "内容策略包"
]);
addContentCheck("monthly strategy workspace", "src/app/monthly-matrix/strategy/page.tsx", [
  "MonthlyPlanConfigPanel",
  "月度策略工作区",
  "saveMonthlyPlan",
  "confirmTypeMatch"
]);
addContentCheck("monthly batch generation", "src/app/monthly-matrix/batch-generation/page.tsx", [
  "MonthlyTaskTable",
  "MonthlyFlowNav",
  "/generation-batches"
]);
addContentCheck("daily execution publish closure", "src/app/daily-execution/page.tsx", [
  "当日执行",
  "/api/v5/content-tasks/",
  "/publish-result",
  "publicUrl",
  "metrics"
]);
addContentCheck("monthly review", "src/app/monthly-review/page.tsx", [
  "useMonthlyObservationReview",
  "MonthlyQuestionReviewTable",
  "下一月决策基线"
]);
addContentCheck("unified product material import", "src/components/ProductMaterialImport.tsx", [
  "/api/v5/knowledge-imports/urls",
  "/api/v5/knowledge-imports/documents",
  "publicUseConfirmed",
  "idempotencyKey",
  "导入资料"
]);
addContentCheck("single-page product onboarding", "src/app/products/new/page.tsx", [
  "ProductMaterialImport",
  "beforeImport={createProduct}",
  "创建并导入资料"
]);
addContentCheck("product knowledge overview", "src/app/products/page.tsx", [
  "产品知识库与 GEO 调研",
  "workflowSummaries",
  "全部产品知识库",
  "补充资料"
]);

addContentCheck("product information workspace", "src/app/products/[productId]/page.tsx", [
  "添加资料",
  "资料与信息",
  "资料状态",
  "产品信息",
  "GEO 调研"
]);
addContentCheck("legacy knowledge import redirects", "src/app/knowledge/import/page.tsx", [
  "redirect",
  "tab=materials"
]);
addContentCheck("managed source service", "src/lib/v5/rag/managed-source-import-service.ts", [
  "managedContent",
  "sourceRevisionId",
  "writeRagSourceImport",
  "idempotencyKey"
]);
addContentCheck("managed source repository", "src/lib/v5/rag/source-import-repository.ts", [
  "managedContent",
  "source_asset",
  "source_revision",
  "rag_index_job"
]);
addContentCheck("knowledge refresh worker", "workers/knowledge-refresh-worker.mjs", [
  "managed-claim-extraction-service",
  "sourceSnapshotHash",
  "result.index.snapshot.indexSnapshotId"
]);
addContentCheck("unified GEO content center", "src/app/monthly-plan/page.tsx", [
  "推广范围",
  "已发布",
  "待发布",
  "失败告警",
  "产品运行状态",
  "文章与排程队列",
  "查看策略包",
  "选择推广产品"
]);
addAbsentCheck("content automation has no functional first-level tabs", "src/app/monthly-plan/page.tsx", [
  "重新运行自动化",
  "内容策略</Button>",
  "今日执行</Button>",
  "发布排程</Button>"
]);
addContentCheck("product-first content orchestration", "src/app/monthly-matrix/batch-generation/page.tsx", [
  "productGroups",
  "productContextByTaskId",
  "文章任务编排",
  "异常处理"
]);
addContentCheck("product-first home content pipeline", "src/app/page.tsx", [
  "productProduction",
  "生产产品",
  "自动化运行中",
  "查看任务",
  "处理异常"
]);
addContentCheck("exception-first publishing monitor", "src/app/publishing/page.tsx", [
  "productGroups",
  "按产品查看",
  "需处理任务",
  "自动运行中的任务",
  "处理异常"
]);
addContentCheck("unified GEO monitor tower", "src/app/geo-monitor/page.tsx", [
  "总览",
  "内容表现",
  "AI 可见性",
  "系统记录"
]);
addContentCheck("automatic monthly orchestration", "src/lib/v5/monthly-automation-service.ts", [
  "runAutomaticMonthlyPlan",
  "runAutomaticSchedule",
  "system_policy"
]);
addContentCheck("date execution compatibility redirect", "src/app/today/page.tsx", ["redirect(\"/monthly-plan?step=execution&view=today\")"]);
addAbsentCheck("navigation has no replaced compatibility entries", "src/components/AppShell.tsx", [
  "href=\"/monthly-matrix\"",
  "href=\"/monthly-review\"",
  "href=\"/blog-candidates\"",
  "href=\"/today\""
]);

// Phase 1: MCP contract & capture device content checks
addContentCheck("phase1 product promotion API", "src/app/api/v5/products/[productId]/promotion/route.ts", [
  "isPromoting",
  "产品已开始推广",
  "产品已暂停推广"
]);
addContentCheck("phase1 strategy pack API", "src/app/api/v5/products/[productId]/strategy-pack/route.ts", [
  "strategyPack",
  "getProductGeoStrategyPackView",
  "latestStrategyPack",
  "currentStrategyPack"
]);
addContentCheck("phase1 strategy pack apply API", "src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", [
  "decideProductGeoStrategyPack",
  "产品 GEO 策略已确认",
  "产品 GEO 策略已拒绝"
]);
addContentCheck("phase1 capture devices API", "src/app/api/v5/capture-devices/route.ts", [
  "deviceId",
  "workspaceId",
  "userId",
  "registerCaptureDevice"
]);
addContentCheck("phase1 capture device revoke", "src/app/api/v5/capture-devices/[deviceId]/route.ts", [
  "revokeCaptureDevice"
]);
addContentCheck("phase1 capture device heartbeat", "src/app/api/v5/capture-devices/[deviceId]/heartbeat/route.ts", [
  "heartbeatCaptureDevice"
]);
addContentCheck("capture pairing code API", "src/app/api/v5/capture-pairing-codes/route.ts", [
  "createCapturePairingCode",
  "ttlMinutes"
]);
addContentCheck("phase1 capture tasks API", "src/app/api/v5/capture-tasks/route.ts", [
  "productId",
  "question",
  "platform",
  "createCaptureTask",
  "listCaptureTasks"
]);
addContentCheck("phase1 capture task lease", "src/app/api/v5/capture-tasks/[id]/lease/route.ts", [
  "deviceId",
  "leaseCaptureTask"
]);
addContentCheck("phase1 capture evidence API", "src/app/api/v5/capture-evidence/route.ts", [
  "artifactHash",
  "uploadCaptureEvidence"
]);
addContentCheck("phase1 attribution API", "src/app/api/v5/attribution/route.ts", [
  "sourceEventId",
  "changeType",
  "recordAttributionEvent"
]);
addContentCheck("phase1 task responsibility API", "src/app/api/v5/tasks/responsibility/route.ts", [
  "readResponsibilitySnapshot"
]);
addContentCheck("phase1 task attention API", "src/app/api/v5/tasks/attention/route.ts", [
  "readResponsibilitySnapshot",
  "snapshot.user.tasks"
]);
addContentCheck("phase1 monthly overflow API", "src/app/api/v5/monthly-overflow/route.ts", [
  "sourceMonth",
  "migrateMonthlyOverflow",
  "getMonthlyOverflowStatus"
]);
addContentCheck("phase1 monthly overflow service", "src/lib/v5/monthly-overflow-service.ts", [
  "runMonthlyOverflow",
  "overflowedCount",
  "isMonthCompleted",
  "isTaskUnexecuted"
]);
addContentCheck("phase1 product registry contracts", "src/lib/v5/product-registry-contracts.ts", [
  "isPromoting",
  "promotionStatus",
  "strategyPackId"
]);
addContentCheck("phase1 knowledge MCP server", "scripts/knowledge-mcp-server.mjs", [
  "knowledge_base_list",
  "knowledge_import_url",
  "knowledge_import_document"
]);
addContentCheck("phase1 geo research MCP server", "scripts/geo-research-mcp-server.mjs", [
  "geo_questions_list",
  "geo_keywords_list",
  "geo_product_research_status"
]);
addContentCheck("phase1 RAG retrieval MCP server", "scripts/rag-retrieval-mcp-server.mjs", [
  "rag_retrieve",
  "rag_evidence_pack",
  "rag_source_snapshot"
]);
addContentCheck("phase1 observation MCP server", "scripts/observation-mcp-server.mjs", [
  "monthly_review_get",
  "publish_liveness_check",
  "automation_status"
]);
addContentCheck("phase1 capture MCP server", "scripts/capture-mcp-server.mjs", [
  "capture_device_register",
  "capture_task_lease",
  "capture_evidence_upload"
]);
addContentCheck("phase1 publish MCP server", "scripts/publish-mcp-server.mjs", [
  "platform_auth_probe",
  "publish_job_create",
  "publish_job_reconcile"
]);

for (const filePath of [
  "scripts/knowledge-mcp-server.mjs",
  "scripts/geo-research-mcp-server.mjs",
  "scripts/rag-retrieval-mcp-server.mjs",
  "scripts/observation-mcp-server.mjs",
  "scripts/capture-mcp-server.mjs",
  "scripts/publish-mcp-server.mjs"
]) {
  addNodeSyntaxCheck(`phase1 MCP executable syntax: ${filePath}`, filePath);
}
addContentCheck("phase1 database migration", "database/migrations/20260809_017_v5_phase1_mcp_capture.sql", [
  "product_strategy_packs",
  "capture_devices",
  "capture_tasks",
  "capture_evidence",
  "attribution_chain",
  "is_promoting",
  "responsibility",
  "recovery_status"
]);
addContentCheck("phase2a product GEO strategy contract", "src/lib/v5/product-strategy-pack-contracts.ts", [
  "product-geo-strategy.v2",
  "pending_strategy_review",
  "strategy_approved",
  "pending_sample_review",
  "production_ready",
  "assertHumanProductStrategyDecision"
]);
addContentCheck("phase2a product GEO strategy human gate", "src/lib/v5/product-strategy-pack-service.ts", [
  "human_strategy_approval_required",
  "decideProductGeoStrategyPack",
  "expectedVersion",
  "idempotencyKey"
]);
addContentCheck("phase2a product strategy UI", "src/components/ProductGeoStrategyPanel.tsx", [
  "确认策略并生成示例",
  "依据与高级信息",
  "expectedVersion",
  "x-idempotency-key"
]);
addContentCheck("product profile correction UI", "src/app/products/[productId]/page.tsx", [
  "编辑产品信息",
  "已带入当前解析结果",
  "positioningText",
  "audiencesText",
  "capabilitiesText",
  "scenariosText",
  "boundariesText"
]);
addContentCheck("product profile human override migration", "database/migrations/20260812_027_v5_product_profile_human_override.sql", [
  "product_knowledge_profile_override_version",
  "profile_json",
  "source_fact_count",
  "approved_by",
  "immutable_at"
]);
addContentCheck("formal publish observation lifecycle migration", "database/migrations/20260812_028_v5_publish_observation_lifecycle.sql", [
  "publish_schedule_id",
  "first_public_observed_at",
  "last_verified_at",
  "stable_published_at",
  "removed_at",
  "verification_count"
]);
addAbsentCheck("phase2a research UI has no blueprint approval", "src/app/products/[productId]/research/page.tsx", [
  "批准蓝图",
  "退回 GEO 蓝图",
  "GEO 铺设蓝图"
]);
addAbsentCheck("phase2a automation cannot approve blueprint", "src/lib/v5/geo-research-service.ts", [
  "auto-blueprint-policy"
]);
addContentCheck("phase2b multi-provider factual search", "src/lib/v5/geo-search-adapters.ts", [
  "GEO_RESEARCH_ZHIPU_API_KEY",
  "GEO_RESEARCH_DOUBAO_API_KEY",
  "GEO_RESEARCH_QWEN_API_KEY",
  "requiredSuccessfulProviders = 2",
  "requiredIndependentSources = 2",
  "runMultiProviderWebSearch",
  "combineMultiSearchEvidencePacks",
  "retrievedAt",
  "providerRunIds"
]);
addContentCheck("phase2b Docker multi-provider configuration passthrough", "compose.yaml", [
  "GEO_RESEARCH_ZHIPU_API_KEY: ${GEO_RESEARCH_ZHIPU_API_KEY:-}",
  "GEO_RESEARCH_DOUBAO_API_KEY: ${GEO_RESEARCH_DOUBAO_API_KEY:-}",
  "GEO_RESEARCH_DOUBAO_MODEL: ${GEO_RESEARCH_DOUBAO_MODEL:-}",
  "GEO_RESEARCH_DOUBAO_BASE_URL: ${GEO_RESEARCH_DOUBAO_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}",
  "GEO_RESEARCH_QWEN_API_KEY: ${GEO_RESEARCH_QWEN_API_KEY:-}",
  "GEO_RESEARCH_QWEN_MODEL: ${GEO_RESEARCH_QWEN_MODEL:-}",
  "GEO_RESEARCH_QWEN_BASE_URL: ${GEO_RESEARCH_QWEN_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
]);
addContentCheck("3027 Docker launcher safely layers private local environment", "scripts/docker-compose-with-project-env.mjs", [
  'nextEnv.loadEnvConfig(process.cwd())',
  'name.startsWith("GEO_RESEARCH_")',
  'const childEnvironment = { ...inheritedEnvironment }',
  'spawn("docker", ["compose", ...composeArguments]',
  "env: childEnvironment",
  "stdio: \"inherit\""
]);
addContentCheck("3027 Docker commands use the safe environment launcher", "scripts/workbench-3027-common.ps1", [
  'Join-Path $PSScriptRoot "docker-compose-with-project-env.mjs"',
  "node $script:WorkbenchComposeLauncher @Arguments",
  "node $script:WorkbenchComposeLauncher --profile full config --images"
]);
addContentCheck("3027 production launcher clears dev override and verifies standalone mode", "scripts/start-docker-3027.ps1", [
  '"-f", "compose.dev-3027.yaml"',
  '"down", "--remove-orphans"',
  '"-f", "compose.yaml"',
  "Assert-WorkbenchProductionMode"
]);
addContentCheck("3027 production mode assertion", "scripts/workbench-3027-common.ps1", [
  "Assert-WorkbenchProductionMode",
  "server\\.js",
  "compose\\.dev-3027\\.yaml",
  "Verified production mode"
]);
addContentCheck("browser smoke has bounded Chrome/Edge fallback and durable report", "scripts/smoke-browser.mjs", [
  "resolveBrowserCandidates",
  "unavailableBrowserPaths",
  "terminateBrowserTree",
  "render timed out after 20s",
  "writeReportIfRequested",
  "Refuse to write browser smoke report outside workspace"
]);
addAbsentCheck("ordinary browser smoke does not mutate global workspace role", "scripts/smoke-browser.mjs", [
  "setWorkbenchRole"
]);
addAbsentCheck("3027 local integration overrides cannot mutate Docker infrastructure", "scripts/docker-compose-with-project-env.mjs", [
  '"MYSQL_PASSWORD"',
  '"MYSQL_HOST"',
  '"OPENSEARCH_URL"',
  '"WORKBENCH_STORAGE"'
]);
addContentCheck("phase2b Zhipu-only semantic synthesis", "src/lib/v5/geo-research-provider.ts", [
  "zhipu_synthesis",
  "runMultiProviderWebSearch",
  "verifyGeoResearchEvidence",
  "geo_evidence_verification_failed",
  "maximumSupplementaryRounds: 2",
  "buildSupplementaryQueries"
]);
addContentCheck("phase2b governed search query plan", "src/lib/v5/geo-search-contracts.ts", [
  "geo-search-query-plan.v2",
  "expectedEvidenceRole",
  "freshnessRequirement",
  "stopCondition",
  "rawResponseRefs"
]);
addContentCheck("phase2b real pilot acceptance ledger", "scripts/check-geo-pilot-acceptance.mjs", [
  "source_snapshot",
  "sourceSnapshotCount",
  "latestSourceSnapshot",
  "geo_research_task",
  "geo_research_evidence",
  "product_strategy_packs",
  "sample_article_feedback",
  "production_mode = 'batch'"
]);
addContentCheck("phase2b worker Node ESM compatibility", "workers/typescript-loader.mjs", [
  "specifier === \"next/server\"",
  "next/server.js"
]);
addContentCheck("phase2b deterministic evidence verifier", "src/lib/v5/geo-evidence-verifier.ts", [
  "invalidUrls",
  "missingCitationPaths",
  "conflicted",
  "claimAssessments"
]);
addContentCheck("phase2c full article type portfolio contract", "src/lib/v5/product-strategy-pack-contracts.ts", [
  "matched",
  "adapted",
  "generated",
  "unsuitableQuestions",
  "structureModules",
  "lengthRange",
  "questionClusterIds",
  "deriveProductStrategyMonthlyTypeQuotas",
  "assertProductGeoStrategyContentPlanV2"
]);
addContentCheck("phase2c atomic article type activation", "src/lib/v5/product-strategy-pack-repository.ts", [
  "product_strategy_article_type_versions",
  "selectedPortfolioItemIds",
  "origin = 'matched' THEN 'frozen' ELSE 'active'",
  "idempotency_key_reused"
]);
addContentCheck("phase2c strategy UI selects article types once", "src/components/ProductGeoStrategyPanel.tsx", [
  "selectedPortfolioItemIds",
  "纳入策略",
  "至少保留 2 种、最多 6 种"
]);
addContentCheck("phase2c Zhipu portfolio synthesis", "src/lib/v5/geo-research-provider.ts", [
  "existingArticleTypes",
  "matched|adapted|generated",
  "hard maximum 6",
  "baseArticleTypeVersionId"
]);
addContentCheck("phase2d formal production uses one frozen contract", "src/lib/v5/single-article-production-service.ts", [
  "compileFormalProductionContract",
  "persistProductionContractSnapshot",
  "productionContractId"
]);
addContentCheck("phase2d provider is contract-only and repairs once", "src/lib/v5/formal-generation-service.ts", [
  "createFormalModelContract(input.contract)",
  "JSON.stringify(modelContract)",
  "repairRound <= 1",
  "repairRound < 1",
  "严禁把原始摘录"
]);
addContentCheck("phase2d human sample gate freezes calibration", "src/lib/v5/sample-calibration-repository.ts", [
  "human_actor_required",
  "expression_calibration_version",
  "production_ready",
  "sample_article_approved"
]);
addContentCheck("phase2e graph keeps Human gates and bounded research supplements", "src/lib/v5/graph/product-geo-workflow.ts", [
  "interrupt({ gate: \"strategy_review\"",
  "interrupt({ gate: \"sample_review\"",
  "state.supplementaryRound <= 2",
  "compile({ checkpointer })"
]);
addContentCheck("phase2e MySQL saver persists checkpoints and pending writes", "src/lib/v5/graph/mysql-checkpoint-saver.ts", [
  "langgraph_checkpoint",
  "langgraph_checkpoint_write",
  "putWrites",
  "deleteThread"
]);
addContentCheck("phase2e remains shadow-only before cutover", "src/lib/v5/graph/product-geo-workflow-repository.ts", [
  "graph_active_cutover_blocked",
  "executionMode !== \"shadow\"",
  "geo_graph_shadow_started"
]);
addAbsentCheck("phase2e graph does not enter monthly production hot path", "src/lib/v5/monthly-production-service.ts", [
  "@langchain/langgraph",
  "product-geo-workflow",
  "geo_graph_workflow_run"
]);
addContentCheck("phase2f batch generation requires approved sample calibration", "src/lib/v5/formal-production-contract-service.ts", [
  "sample_calibration_required",
  "active_calibration_required",
  "production_ready"
]);
addContentCheck("phase2f rollout preflight separates content, account and auth gates", "src/lib/v5/product-rollout-readiness-service.ts", [
  "canEnterBatchGeneration",
  "canScheduleRealPublish",
  "accountConfigured",
  "checkFormalPublishAuth"
]);
addContentCheck("phase2g proposal freezes formal evidence references", "src/lib/v5/monthly-review-service.ts", [
  "FORMAL_PUBLISHED_EVIDENCE_REQUIRED",
  "published_content:",
  "geo_capture_task:",
  "confirmed_gap:"
]);

const obsoleteCycleTokens = [
  ["week", "ly-plan"].join(""),
  ["week", "ly-report"].join(""),
  ["week", "ly-review"].join(""),
  ["Week", "lyPlan"].join(""),
  ["Week", "lyReport"].join(""),
  ["周", "计划"].join(""),
  ["周", "报"].join(""),
  ["周", "复盘"].join("")
];
const scanFiles = new Set([
  "README.md",
  "package.json",
  "src/lib/permissions.ts",
  "src/lib/prompt-templates.ts",
  "src/app/settings/page.tsx",
  "src/app/publish/page.tsx",
  "src/app/api/ai-governance/route.ts",
  "src/app/monthly-plan/page.tsx",
  "src/app/today/page.tsx"
]);

for (const directory of ["scripts", "docs", "design", "review", "workers", "data"]) {
  for (const filePath of listFiles(directory)) scanFiles.add(filePath);
}
scanFiles.delete("data/workbench-state.json");

for (const filePath of [...scanFiles].sort()) {
  const content = read(filePath);
  const present = obsoleteCycleTokens.filter((token) => content.toLowerCase().includes(token.toLowerCase()));
  checks.push({
    label: `monthly cycle only: ${filePath}`,
    pass: Boolean(content) && present.length === 0,
    detail: present.length ? `obsolete identifiers: ${present.join(", ")}` : filePath
  });
}

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.label} - ${check.detail}`);
}
console.log("");
console.log(`V5 structure checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length > 0) process.exitCode = 1;

function listFiles(directory) {
  const absoluteDirectory = join(root, directory);
  if (!existsSync(absoluteDirectory)) return [];
  const files = [];

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && ["node_modules", ".next", "保存"].includes(entry.name)) continue;
    const fullPath = join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(relative(root, fullPath)));
    } else if (entry.isFile() && !entry.name.endsWith(".log")) {
      files.push(relative(root, fullPath).replaceAll("\\", "/"));
    }
  }

  return files;
}
