const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg ? baseUrlArg.split("=").slice(1).join("=") : DEFAULT_BASE_URL).replace(/\/$/, "");

async function resolveCurrentRole() {
  try {
    const response = await fetch(`${baseUrl}/api/workbench-state`, {
      headers: { accept: "application/json" }
    });
    const body = await response.json();
    return body.state?.workspaceSetting?.currentRole;
  } catch {
    return undefined;
  }
}

async function setCurrentRole(currentRole) {
  if (!currentRole) return;

  await fetch(`${baseUrl}/api/workspace-settings`, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ currentRole })
  });
}

const previousRole = await resolveCurrentRole();
await setCurrentRole("workbench_operator");

const targets = [
  { name: "dashboard_page", path: "/", expect: "JOTO GTM" },
  { name: "monthly_matrix_page", path: "/monthly-matrix", expect: "月度内容矩阵" },
  { name: "monthly_matrix_strategy_page", path: "/monthly-matrix/strategy", expect: "月度策略工作区" },
  { name: "article_type_library_page", path: "/monthly-matrix/content-types", expect: "内容类型库" },
  { name: "monthly_matrix_batch_generation_page", path: "/monthly-matrix/batch-generation", expect: "批量生成中心" },
  { name: "monthly_strategy_compat_page", path: "/monthly-strategy", expectRedirect: "/monthly-matrix" },
  { name: "batch_generation_compat_page", path: "/batch-generation", expectRedirect: "/monthly-matrix/batch-generation" },
  { name: "exceptions_compat_page", path: "/exceptions", expectRedirect: "/monthly-matrix/batch-generation" },
  { name: "publish_schedule_compat_page", path: "/publish-schedule", expectRedirect: "/monthly-matrix/batch-generation#schedule" },
  { name: "publish_schedule_daily_execution_page", path: "/publish-schedule/daily-execution", expectRedirect: "/daily-execution" },
  { name: "daily_execution_page", path: "/daily-execution", expect: "当日执行" },
  { name: "monthly_review_page", path: "/monthly-review", expect: "月度复盘" },
  { name: "weekly_plan_page", path: "/weekly-plan", expect: "周计划" },
  { name: "today_page", path: "/today", expect: "今日发布" },
  { name: "publish_page", path: "/publish", expect: "数据回传" },
  { name: "blog_monitor_page", path: "/blog-monitor", expect: "官网博客监控" },
  { name: "blog_candidates_page", path: "/blog-candidates", expect: "博客候选池" },
  { name: "weekly_report_page", path: "/weekly-report", expect: "周度复盘" },
  { name: "knowledge_page", path: "/knowledge", expect: "知识库" },
  { name: "knowledge_detail_page", path: "/knowledge/kb-adp-service", expect: "JOTO 腾讯云 ADP 服务能力" },
  { name: "questions_keywords_page", path: "/questions-keywords", expect: "问题与关键词池" },
  { name: "distilled_terms_compat_page", path: "/distilled-terms", expectRedirect: "/questions-keywords" },
  { name: "configuration_page", path: "/configuration", expect: "配置管理" },
  { name: "real_integration_compat_page", path: "/real-integration", expectRedirect: "/configuration?tab=connections" },
  { name: "ai_config_compat_page", path: "/ai-config", expectRedirect: "/configuration" },
  { name: "settings_page", path: "/settings", expect: "工作台设置" },
  { name: "workbench_state_api", path: "/api/workbench-state", expect: "workspaceSetting" },
  { name: "v5_monthly_workspace_api", path: "/api/v5/monthly-workspace", expect: "rulePackages" },
  { name: "v5_article_type_profiles_api", path: "/api/v5/article-type-profiles", expect: "system-template" },
  { name: "v5_questions_api", path: "/api/v5/questions", expect: "questionVersionId" },
  { name: "v5_knowledge_api", path: "/api/v5/knowledge-bases", expect: "knowledgeBaseId" },
  { name: "v5_expression_profiles_api", path: "/api/v5/article-expression-profiles", expect: "structureModules" },
  { name: "v5_configuration_status_api", path: "/api/v5/configuration/status", expect: "publish_connection" },
  { name: "runtime_config_api", path: "/api/runtime-config/status", expect: "capabilities" },
  { name: "config_diagnostics_api", path: "/api/config-diagnostics", expect: "results" },
  { name: "weekly_report_api", path: "/api/weekly-reports/2026-06-17", expect: "executiveSummary" },
  { name: "weekly_report_markdown_export_api", path: "/api/weekly-reports/2026-06-17/export", expect: "JOTO GTM 周报" }
];

async function checkTarget(target) {
  const response = await fetch(`${baseUrl}${target.path}`, {
    redirect: target.expectRedirect ? "manual" : "follow",
    headers: {
      accept: target.path.startsWith("/api/") ? "application/json" : "text/html"
    }
  });
  const text = await response.text();
  const isApi = target.path.startsWith("/api/");
  const redirectLocation = response.headers.get("location");
  const redirectOk = target.expectRedirect
    ? [301, 302, 303, 307, 308].includes(response.status)
      && (redirectLocation === target.expectRedirect || text.includes(target.expectRedirect))
    : undefined;
  const hasExpectedApiBody = text.includes(target.expect);
  const hasHtmlShell = text.includes("<html") || text.includes("__next");
  const ok = target.expectRedirect ? redirectOk : response.ok && (isApi ? hasExpectedApiBody : hasHtmlShell);

  return {
    name: target.name,
    ok,
    detail: target.expectRedirect
      ? redirectOk
        ? `http ${response.status}, redirect ${target.expectRedirect}`
        : `http ${response.status}, expected redirect ${target.expectRedirect}, actual ${redirectLocation || "none"}`
      : response.ok
      ? ok
        ? isApi
          ? `http ${response.status}`
          : `http ${response.status}, html shell`
        : isApi
          ? `http ${response.status}, missing ${target.expect}`
          : `http ${response.status}, missing html shell`
      : `http ${response.status}`
  };
}

const results = [];

try {
  for (const target of targets) {
    try {
      results.push(await checkTarget(target));
    } catch (error) {
      results.push({
        name: target.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
} finally {
  await setCurrentRole(previousRole);
}

const failed = results.filter((item) => !item.ok);

console.log(
  JSON.stringify(
    {
      script: "smoke-pages",
      baseUrl,
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
