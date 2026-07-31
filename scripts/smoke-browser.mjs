import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const scope = normalizeScope(args.scope);
const baseUrl = String(args["base-url"] || process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const chromePath = resolveChromePath();
const profilePath = await mkdtemp(join(tmpdir(), "joto-browser-smoke-"));
const results = [];

const pageGroups = {
  v5: [
    ["dashboard", "/", "JOTO GTM"],
    ["monthly_matrix", "/monthly-matrix", "月度内容矩阵"],
    ["monthly_strategy", "/monthly-matrix/strategy", "月度策略工作区"],
    ["article_types", "/monthly-matrix/content-types", "内容类型库"],
    ["batch_generation", "/monthly-matrix/batch-generation", "批量生成中心"],
    ["daily_execution", "/daily-execution", "当日执行"],
    ["monthly_review", "/monthly-review", "月度复盘"],
    ["questions", "/questions-keywords", "问题与关键词池"],
    ["knowledge", "/knowledge", "知识库"],
    ["configuration", "/configuration", "配置管理"],
    ["data_return", "/publish", "数据回传"]
  ],
  content: [
    ["monthly_matrix", "/monthly-matrix", "月度内容矩阵"],
    ["monthly_strategy", "/monthly-matrix/strategy", "月度策略工作区"],
    ["batch_generation", "/monthly-matrix/batch-generation", "批量生成中心"],
    ["daily_execution", "/daily-execution", "当日执行"],
    ["knowledge", "/knowledge", "知识库"]
  ],
  responsive: [
    ["batch_generation_mobile", "/monthly-matrix/batch-generation", "批量生成中心"],
    ["daily_execution_mobile", "/daily-execution", "当日执行"],
    ["monthly_review_mobile", "/monthly-review", "月度复盘"],
    ["questions_mobile", "/questions-keywords", "问题与关键词池"],
    ["knowledge_mobile", "/knowledge", "知识库"],
    ["configuration_mobile", "/configuration", "配置管理"]
  ],
  publish: [
    ["daily_execution", "/daily-execution", "当日执行"],
    ["data_return", "/publish", "数据回传"],
    ["monthly_review", "/monthly-review", "月度复盘"]
  ]
};

let previousRole;

try {
  if (scope === "roles") {
    await runRoleChecks();
  } else {
    previousRole = await setWorkbenchRole("workbench_operator");
    const pages = scope === "full" ? pageGroups.v5 : pageGroups[scope] || pageGroups.v5;
    for (const [name, path, expected] of pages) {
      await checkPage(name, path, expected, scope === "responsive");
    }
  }
} finally {
  if (previousRole) await setWorkbenchRole(previousRole, false).catch(() => undefined);
  await rm(profilePath, { recursive: true, force: true });
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ script: "smoke-browser", scope, baseUrl, status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;

async function runRoleChecks() {
  const stateResponse = await fetch(`${baseUrl}/api/workbench-state`, { signal: AbortSignal.timeout(15000) });
  const initial = await stateResponse.json();
  const previousRole = initial.state?.workspaceSetting?.currentRole;
  const roles = [
    ["content_publisher", "/daily-execution", "当日执行"],
    ["content_growth", "/monthly-review", "月度复盘"],
    ["workbench_operator", "/monthly-matrix", "月度内容矩阵"],
    ["knowledge_manager", "/knowledge", "知识库"],
    ["developer_admin", "/configuration", "配置管理"]
  ];

  try {
    for (const [role, path, expected] of roles) {
      const response = await fetch(`${baseUrl}/api/workspace-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentRole: role }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        results.push({ name: `role:${role}`, ok: false, detail: `role update http ${response.status}` });
        continue;
      }
      await checkPage(`role:${role}`, path, expected, false);
    }
  } finally {
    if (previousRole) {
      await fetch(`${baseUrl}/api/workspace-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentRole: previousRole }),
        signal: AbortSignal.timeout(15000)
      }).catch(() => undefined);
    }
  }
}

async function setWorkbenchRole(currentRole, capturePrevious = true) {
  let previous;
  if (capturePrevious) {
    const stateResponse = await fetch(`${baseUrl}/api/workbench-state`, { signal: AbortSignal.timeout(15000) });
    const state = await stateResponse.json();
    previous = state.state?.workspaceSetting?.currentRole;
  }

  const response = await fetch(`${baseUrl}/api/workspace-settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentRole }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Unable to set smoke role: http ${response.status}`);
  return previous;
}

async function checkPage(name, path, expected, mobile) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      results.push({ name, ok: false, detail: `http ${response.status}` });
      return;
    }

    const { stdout } = await execFileAsync(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--virtual-time-budget=5000",
      `--user-data-dir=${profilePath}`,
      `--window-size=${mobile ? "390,844" : "1440,1000"}`,
      "--dump-dom",
      `${baseUrl}${path}`
    ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });

    const ok = stdout.includes("<html") && stdout.includes(expected);
    results.push({ name, ok, detail: ok ? `${mobile ? "mobile" : "desktop"} rendered` : `missing rendered text: ${expected}` });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : "browser execution failed" });
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const separator = raw.indexOf("=");
    if (separator >= 0) {
      parsed[raw.slice(0, separator)] = raw.slice(separator + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[raw] = next;
      index += 1;
    } else {
      parsed[raw] = true;
    }
  }
  return parsed;
}

function normalizeScope(value) {
  const normalized = String(value || "full").trim().toLowerCase();
  return ["full", "roles", "content", "responsive", "publish", "v5"].includes(normalized) ? normalized : "full";
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH?.trim(),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].filter(Boolean);
  const available = candidates.find((candidate) => existsSync(candidate));
  if (!available) throw new Error("Chrome/Edge executable not found. Configure CHROME_PATH.");
  return available;
}
