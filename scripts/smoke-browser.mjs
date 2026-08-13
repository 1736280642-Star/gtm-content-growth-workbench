import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const scope = normalizeScope(args.scope);
const baseUrl = String(args["base-url"] || process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const browserCandidates = resolveBrowserCandidates();
const unavailableBrowserPaths = new Set();
let preferredBrowserPath;
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
  ],
  "geo-pilot": [
    ["products", "/products", "WorkBuddy"],
    ["workbuddy_product", "/products/joto-workbuddy", "WorkBuddy"],
    ["workbuddy_strategy", "/products/joto-workbuddy?tab=strategy", "固定表达"],
    ["workbuddy_research", "/products/joto-workbuddy/research", "GEO 调研"]
  ],
  "media-library": [
    ["wechat_media_library", "/free-production/assets", "素材图库"]
  ]
};

if (scope === "roles") {
  await runRoleChecks();
} else {
  const pages = scope === "full" ? pageGroups.v5 : pageGroups[scope] || pageGroups.v5;
  for (const [name, path, expected] of pages) {
    await checkPage(name, path, expected, scope === "responsive");
  }
}

const failed = results.filter((item) => !item.ok);
const report = { script: "smoke-browser", scope, baseUrl, status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, results };
const serializedReport = JSON.stringify(report, null, 2);
console.log(serializedReport);
writeReportIfRequested(serializedReport);
process.exitCode = failed.length ? 1 : 0;

function writeReportIfRequested(serializedReport) {
  if (typeof args.report !== "string" || !args.report.trim()) return;
  const workspaceRoot = resolve(process.cwd());
  const reportPath = resolve(workspaceRoot, args.report.trim());
  const insideWorkspace = process.platform === "win32"
    ? reportPath.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}\\`)
    : reportPath.startsWith(`${workspaceRoot}/`);
  if (!insideWorkspace) throw new Error(`Refuse to write browser smoke report outside workspace: ${reportPath}`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${serializedReport}\n`, "utf8");
}

async function runRoleChecks() {
  const settingResponse = await fetch(`${baseUrl}/api/workspace-settings`, { signal: AbortSignal.timeout(15000) });
  const initial = await settingResponse.json();
  const previousRole = initial.data?.workspaceSetting?.currentRole;
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

async function checkPage(name, path, expected, mobile) {
  console.log(JSON.stringify({ script: "smoke-browser", action: "page_started", name, path }));
  try {
    const { stdout, browser } = await dumpRenderedDom(`${baseUrl}${path}`, name, mobile);

    const ok = stdout.includes("<html") && stdout.includes(expected);
    results.push({
      name,
      ok,
      detail: ok
        ? `${mobile ? "mobile" : "desktop"} rendered by ${browser.name}`
        : `missing rendered text: ${expected} (${browser.name})`
    });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : "browser execution failed" });
  } finally {
    console.log(JSON.stringify({ script: "smoke-browser", action: "page_finished", ...results.at(-1) }));
  }
}

async function dumpRenderedDom(url, pageName, mobile) {
  const orderedCandidates = [
    ...browserCandidates.filter((browser) => browser.path === preferredBrowserPath),
    ...browserCandidates.filter((browser) => browser.path !== preferredBrowserPath)
  ].filter((browser) => !unavailableBrowserPaths.has(browser.path));
  const failures = [];

  for (const browser of orderedCandidates) {
    try {
      const stdout = await runBrowserDump(browser, url, pageName, mobile);
      if (!stdout.includes("<html")) {
        unavailableBrowserPaths.add(browser.path);
        failures.push(`${browser.name}: no HTML document returned`);
        continue;
      }
      preferredBrowserPath = browser.path;
      return { stdout, browser };
    } catch (error) {
      unavailableBrowserPaths.add(browser.path);
      failures.push(`${browser.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No browser could render ${url}. ${failures.join(" | ")}`);
}

async function runBrowserDump(browser, url, pageName, mobile) {
  const profilePath = await mkdtemp(join(tmpdir(), `joto-browser-smoke-${pageName}-${browser.name}-`));
  let cleanExit = false;
  const browserArguments = [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-rasterization",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--virtual-time-budget=5000",
    `--user-data-dir=${profilePath}`,
    `--window-size=${mobile ? "390,844" : "1440,1000"}`,
    "--dump-dom",
    url
  ];

  try {
    return await new Promise((resolveDump, rejectDump) => {
      const child = spawn(browser.path, browserArguments, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const maxBuffer = 20 * 1024 * 1024;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        terminateBrowserTree(child.pid);
        child.stdout.destroy();
        child.stderr.destroy();
        child.removeAllListeners("close");
        child.removeAllListeners("error");
        child.unref();
        finish(() => rejectDump(new Error("render timed out after 20s")));
      }, 20000);

      child.stdout.on("data", (chunk) => {
        if (Buffer.byteLength(stdout) < maxBuffer) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
      });
      child.on("error", (error) => finish(() => rejectDump(error)));
      child.on("close", (code, signal) => {
        if (code === 0 && stdout) {
          cleanExit = true;
          finish(() => resolveDump(stdout));
          return;
        }
        const diagnostic = stderr.replace(/\s+/g, " ").trim().slice(-500);
        finish(() => rejectDump(new Error(`exit=${String(code)} signal=${signal || "none"}${diagnostic ? `; ${diagnostic}` : ""}`)));
      });
    });
  } finally {
    // Only a normal browser exit proves that Windows released every profile
    // handle. Failed profiles remain in the OS temp directory for diagnostics
    // instead of blocking the acceptance run during cleanup.
    if (cleanExit) {
      await rm(profilePath, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 }).catch(() => undefined);
    }
  }
}

function terminateBrowserTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 10000,
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may have exited between the timeout and cleanup.
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
  return ["full", "roles", "content", "responsive", "publish", "v5", "geo-pilot", "media-library"].includes(normalized) ? normalized : "full";
}

function resolveBrowserCandidates() {
  const candidates = [
    ["configured", process.env.CHROME_PATH?.trim()],
    ["chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
    ["chrome-x86", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"],
    ["edge", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"],
    ["edge-x86", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
  ];
  const seen = new Set();
  const available = candidates
    .filter(([, path]) => path && existsSync(path))
    .filter(([, path]) => {
      const normalized = path.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map(([name, path]) => ({ name, path }));
  if (!available.length) throw new Error("Chrome/Edge executable not found. Configure CHROME_PATH.");
  return available;
}
