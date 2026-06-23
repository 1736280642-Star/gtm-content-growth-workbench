const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg ? baseUrlArg.split("=").slice(1).join("=") : DEFAULT_BASE_URL).replace(/\/$/, "");

const targets = [
  { name: "dashboard_page", path: "/", expect: "JOTO GTM" },
  { name: "weekly_plan_page", path: "/weekly-plan", expect: "周计划" },
  { name: "today_page", path: "/today", expect: "今日发布" },
  { name: "publish_page", path: "/publish", expect: "数据回传" },
  { name: "blog_monitor_page", path: "/blog-monitor", expect: "官网博客监控" },
  { name: "blog_candidates_page", path: "/blog-candidates", expect: "博客候选池" },
  { name: "geo_test_page", path: "/geo-test", expect: "GEO 测试" },
  { name: "weekly_report_page", path: "/weekly-report", expect: "周度复盘" },
  { name: "knowledge_page", path: "/knowledge", expect: "知识库" },
  { name: "real_integration_page", path: "/real-integration", expect: "真实接入" },
  { name: "ai_config_page", path: "/ai-config", expect: "AI 配置" },
  { name: "settings_page", path: "/settings", expect: "工作台设置" },
  { name: "workbench_state_api", path: "/api/workbench-state", expect: "workspaceSetting" },
  { name: "runtime_config_api", path: "/api/runtime-config/status", expect: "capabilities" },
  { name: "config_diagnostics_api", path: "/api/config-diagnostics", expect: "results" },
  { name: "weekly_report_api", path: "/api/weekly-reports/2026-06-17", expect: "executiveSummary" },
  { name: "weekly_report_markdown_export_api", path: "/api/weekly-reports/2026-06-17/export", expect: "JOTO GTM 周报" }
];

async function checkTarget(target) {
  const response = await fetch(`${baseUrl}${target.path}`, {
    headers: {
      accept: target.path.startsWith("/api/") ? "application/json" : "text/html"
    }
  });
  const text = await response.text();

  return {
    name: target.name,
    ok: response.ok && text.includes(target.expect),
    detail: response.ok
      ? text.includes(target.expect)
        ? `http ${response.status}`
        : `http ${response.status}, missing ${target.expect}`
      : `http ${response.status}`
  };
}

const results = [];

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
