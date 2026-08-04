import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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
  "database/migrations/20260728_013_v5_managed_source_content.sql"
];

for (const filePath of requiredFiles) addFileCheck(`required file: ${filePath}`, filePath);

addContentCheck("monthly navigation", "src/components/AppShell.tsx", [
  "知识库",
  "/monthly-plan",
  "GEO 内容中心",
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
  "createProposal"
]);
addContentCheck("managed URL import", "src/app/knowledge/import/url/page.tsx", [
  "/api/v5/knowledge-imports/urls",
  "publicUseConfirmed",
  "idempotencyKey",
  "托管并启动治理"
]);
addContentCheck("managed document import", "src/app/knowledge/import/document/page.tsx", [
  "/api/v5/knowledge-imports/documents",
  "publicUseConfirmed",
  "idempotencyKey",
  "托管并启动治理"
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
  "MonthlyMatrixPage",
  "MonthlyMatrixTasksPage",
  "MonthlyBatchGenerationPage",
  "MonthlySchedulePage",
  "人工修改策略"
]);
addContentCheck("unified GEO monitor tower", "src/app/geo-monitor/page.tsx", [
  "发布状态",
  "数据回传",
  "官网监控",
  "数据复盘",
  "AI 前台测试"
]);
addContentCheck("automatic monthly orchestration", "src/lib/v5/monthly-automation-service.ts", [
  "runAutomaticMonthlyPlan",
  "runAutomaticSchedule",
  "system_policy"
]);
addContentCheck("date execution compatibility redirect", "src/app/today/page.tsx", ["redirect(\"/monthly-plan?step=execution&view=today\")"]);
addAbsentCheck("navigation has no replaced compatibility entries", "src/components/AppShell.tsx", [
  "href=\"/monthly-matrix\"",
  "href=\"/daily-execution\"",
  "href=\"/monthly-review\"",
  "href=\"/blog-candidates\"",
  "href=\"/today\""
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
