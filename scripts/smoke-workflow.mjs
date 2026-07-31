const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg ? baseUrlArg.split("=").slice(1).join("=") : process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: options.redirect || "follow",
    ...options,
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, location: response.headers.get("location"), text, body };
}

const results = [];
function assert(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
}

const initial = await request("/api/workbench-state");
const previousRole = initial.body?.state?.workspaceSetting?.currentRole;
assert("workbench_state", initial.ok && previousRole, `http ${initial.status}`);

try {
  const roleUpdate = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({ currentRole: "workbench_operator" })
  });
  assert("role_switch", roleUpdate.ok, `http ${roleUpdate.status}`);

  const checks = [
    ["runtime_config", "/api/runtime-config/status", "capabilities"],
    ["configuration_status", "/api/v5/configuration/status", "publish_connection"],
    ["monthly_workspace", "/api/v5/monthly-workspace", "rulePackages"],
    ["monthly_review", `/api/v5/monthly-reviews/${month}`, "questions"],
    ["rag_status", "/api/rag/config-status", "opensearch"],
    ["knowledge_bases", "/api/v5/knowledge-bases", "knowledgeBaseId"],
    ["article_types", "/api/v5/article-type-profiles", "system-template"],
    ["expression_profiles", "/api/v5/article-expression-profiles", "structureModules"],
    ["publish_schedules", "/api/publish-schedules", "schedules"]
  ];

  for (const [name, path, expected] of checks) {
    const response = await request(path);
    assert(name, response.ok && response.text.includes(expected), `http ${response.status}`);
  }

  const redirects = [
    ["monthly_plan_redirect", "/monthly-plan", "/monthly-matrix"],
    ["date_execution_redirect", "/today", "/daily-execution"],
    ["strategy_redirect", "/monthly-strategy", "/monthly-matrix#strategy-package"],
    ["batch_redirect", "/batch-generation", "/monthly-matrix/batch-generation"]
  ];

  for (const [name, path, expected] of redirects) {
    const response = await request(path, { redirect: "manual" });
    assert(name, [301, 302, 303, 307, 308].includes(response.status) && response.location === expected, `http ${response.status}, location ${response.location || "none"}`);
  }
} finally {
  if (previousRole) {
    await request("/api/workspace-settings", { method: "PATCH", body: JSON.stringify({ currentRole: previousRole }) }).catch(() => undefined);
  }
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ script: "smoke-workflow", baseUrl, status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;
