const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg ? baseUrlArg.split("=").slice(1).join("=") : DEFAULT_BASE_URL).replace(/\/$/, "");

async function resolveCurrentRole() {
  try {
    const response = await fetch(`${baseUrl}/api/workbench-state`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    return body.state?.workspaceSetting?.currentRole;
  } catch {
    return undefined;
  }
}

async function setCurrentRole(currentRole) {
  if (!currentRole) return true;
  try {
    const response = await fetch(`${baseUrl}/api/workspace-settings`, {
      method: "PATCH",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ currentRole }),
      signal: AbortSignal.timeout(15000)
    });
    return response.ok;
  } catch (error) {
    console.error(`Unable to set workspace role to ${currentRole}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const previousRole = await resolveCurrentRole();
if (!await setCurrentRole("workbench_operator")) {
  throw new Error("Smoke pages could not set the temporary workbench_operator role.");
}

const targets = [
  { name: "dashboard_page", path: "/", expect: "JOTO GTM" },
  { name: "monthly_matrix_page", path: "/monthly-matrix", expect: "月度内容矩阵" },
  { name: "monthly_matrix_strategy_page", path: "/monthly-matrix/strategy", expect: "月度策略工作区" },
  { name: "article_type_library_page", path: "/monthly-matrix/content-types", expect: "内容类型库" },
  { name: "monthly_matrix_batch_generation_page", path: "/monthly-matrix/batch-generation", expect: "批量生成中心" },
  { name: "wechat_content_production_page", path: "/free-production", expect: "微信公众号内容生产" },
  { name: "monthly_strategy_compat_page", path: "/monthly-strategy", expectRedirect: "/monthly-matrix#strategy-package" },
  { name: "batch_generation_compat_page", path: "/batch-generation", expectRedirect: "/monthly-plan?step=production" },
  { name: "exceptions_compat_page", path: "/exceptions", expectRedirect: "/monthly-matrix/batch-generation" },
  { name: "publish_schedule_compat_page", path: "/publish-schedule", expectRedirect: "/publishing" },
  { name: "publish_schedule_daily_execution_page", path: "/publish-schedule/daily-execution", expectRedirect: "/daily-execution" },
  { name: "daily_execution_page", path: "/daily-execution", expect: "当日执行" },
  { name: "ai_front_test_page", path: "/ai-front-test", expect: "AI 前台测试" },
  { name: "ai_front_test_environment_page", path: "/ai-front-test/environment", expect: "采集环境" },
  { name: "monthly_review_page", path: "/monthly-review", expect: "月度复盘" },
  { name: "monthly_plan_page", path: "/monthly-plan", expect: "内容自动化" },
  { name: "content_automation_page", path: "/content-automation", expect: "内容自动化" },
  { name: "today_compat_page", path: "/today", expectRedirect: "/monthly-plan?step=execution&view=today" },
  { name: "publish_page", path: "/publish", expect: "数据回传" },
  { name: "blog_monitor_page", path: "/blog-monitor", expect: "官网博客监控" },
  { name: "site_audit_tab_page", path: "/blog-monitor?tab=site-audit", expect: "官网审计" },
  { name: "blog_candidates_page", path: "/blog-candidates", expect: "博客候选池" },
  { name: "products_page", path: "/products", expect: "产品知识库与自动化状态" },
  { name: "knowledge_compat_page", path: "/knowledge", expectRedirect: "/products" },
  { name: "knowledge_detail_page", path: "/knowledge/kb-adp-service", expect: "JOTO 腾讯云 ADP 服务能力" },
  { name: "questions_keywords_page", path: "/questions-keywords", expect: "GEO 问题监控" },
  { name: "distilled_terms_compat_page", path: "/distilled-terms", expectRedirect: "/questions-keywords" },
  { name: "configuration_page", path: "/configuration", expect: "配置管理" },
  { name: "real_integration_compat_page", path: "/real-integration", expectRedirect: "/configuration?tab=connections" },
  { name: "ai_config_compat_page", path: "/ai-config", expectRedirect: "/configuration" },
  { name: "settings_page", path: "/settings", expect: "工作台设置" },
  { name: "workbench_state_api", path: "/api/workbench-state", expect: "workspaceSetting" },
  { name: "v5_monthly_workspace_api", path: "/api/v5/monthly-workspace", expect: "rulePackages" },
  { name: "v5_frontend_capture_api", path: "/api/v5/frontend-capture/tasks", expect: "tasks" },
  { name: "v5_monthly_observation_review_api", path: "/api/v5/monthly-reviews/2026-07", expect: "questions" },
  { name: "v5_site_audits_api", path: "/api/v5/site-audits", expect: "runs" },
  { name: "v5_article_type_profiles_api", path: "/api/v5/article-type-profiles", expect: "system-template" },
  { name: "v5_questions_api", path: "/api/v5/questions", expect: "questionVersionId" },
  { name: "v5_knowledge_api", path: "/api/v5/knowledge-bases", expect: "knowledgeBaseId" },
  { name: "v5_expression_profiles_api", path: "/api/v5/article-expression-profiles", expect: "structureModules" },
  { name: "v5_configuration_status_api", path: "/api/v5/configuration/status", expect: "publish_connection" },
  { name: "runtime_config_api", path: "/api/runtime-config/status", expect: "capabilities" }
];

async function checkTarget(target) {
  const response = await fetch(`${baseUrl}${target.path}`, {
    redirect: target.expectRedirect ? "manual" : "follow",
    headers: { accept: target.path.startsWith("/api/") ? "application/json" : "text/html" },
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.text();
  const isApi = target.path.startsWith("/api/");
  const redirectLocation = response.headers.get("location");
  const redirectOk = target.expectRedirect
    ? [301, 302, 303, 307, 308].includes(response.status) && (redirectLocation === target.expectRedirect || body.includes(target.expectRedirect))
    : undefined;
  const ok = target.expectRedirect
    ? redirectOk
    : response.ok && (isApi ? body.includes(target.expect) : body.includes("<html") || body.includes("__next"));

  return {
    name: target.name,
    ok,
    detail: target.expectRedirect
      ? redirectOk
        ? `http ${response.status}, redirect ${target.expectRedirect}`
        : `http ${response.status}, expected redirect ${target.expectRedirect}, actual ${redirectLocation || "none"}`
      : ok
        ? `http ${response.status}`
        : `http ${response.status}, missing ${isApi ? target.expect : "html shell"}`
  };
}

const results = [];
try {
  // Limit concurrency so a cold Next.js dev server is not asked to compile every
  // route at once. Full fan-out made all requests time out without identifying a
  // real page failure.
  for (let index = 0; index < targets.length; index += 4) {
    const settled = await Promise.all(targets.slice(index, index + 4).map(async (target) => {
      try {
        return await checkTarget(target);
      } catch (error) {
        return { name: target.name, ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    }));
    results.push(...settled);
  }
} finally {
  await setCurrentRole(previousRole);
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ script: "smoke-pages", baseUrl, status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;
