import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const args = parseArgs();
const host = typeof args.host === "string" ? args.host : "127.0.0.1";
const port = Number.parseInt(typeof args.port === "string" ? args.port : "3058", 10);
const statePath = typeof args["state-path"] === "string" ? args["state-path"] : "data/workbench-browser-smoke-state.json";
const v5StatePath = typeof args["v5-state-path"] === "string" ? args["v5-state-path"] : statePath.replace(/\.json$/i, "-v5.json");
const scope = typeof args.scope === "string" ? args.scope : "content";
const keepState = Boolean(args["keep-state"]);
const baseUrl = `http://${host}:${port}`;
const root = process.cwd();
const isolatedNextDir = `.next-smoke-browser-${port}`;
const devCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const devArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "run", "dev", "--", "--hostname", host, "--port", String(port)]
    : ["run", "dev", "--", "--hostname", host, "--port", String(port)];
const devEnv = sanitizeEnv({
  ...process.env,
  NEXT_DIST_DIR: isolatedNextDir,
  WORKBENCH_STATE_PATH: statePath,
  V5_MONTHLY_STATE_PATH: v5StatePath,
  WORKBENCH_BASE_URL: baseUrl
});
const recentLogs = [];

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid port: ${String(args.port)}`);
}

if (!keepState) {
  const absoluteStatePath = resolve(root, statePath);
  const absoluteRoot = resolve(root);
  const isInsideRoot =
    process.platform === "win32"
      ? absoluteStatePath.startsWith(`${absoluteRoot}\\`) || absoluteStatePath === absoluteRoot
      : absoluteStatePath.startsWith(`${absoluteRoot}/`) || absoluteStatePath === absoluteRoot;

  if (!isInsideRoot) {
    throw new Error(`Refuse to remove state file outside workspace: ${absoluteStatePath}`);
  }

  rmSync(absoluteStatePath, { force: true });
  const absoluteV5StatePath = resolve(root, v5StatePath);
  if (!absoluteV5StatePath.startsWith(`${absoluteRoot}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Refuse to remove V5 state file outside workspace: ${absoluteV5StatePath}`);
  }
  rmSync(absoluteV5StatePath, { force: true });
}

removeInsideWorkspace(isolatedNextDir);

if (await isServerReady(`${baseUrl}/api/workbench-state`, 1000)) {
  throw new Error(`Port ${port} already has a responding workbench server. Choose another --port for isolated browser smoke.`);
}

console.log(
  JSON.stringify(
    {
      script: "smoke-browser-isolated",
      action: "start",
      baseUrl,
      statePath,
      v5StatePath,
      scope,
      keepState
    },
    null,
    2
  )
);

const devProcess = spawn(devCommand, devArgs, {
  cwd: root,
  env: devEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

devProcess.stdout.on("data", (chunk) => rememberLog(chunk));
devProcess.stderr.on("data", (chunk) => rememberLog(chunk));

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;

  if (!devProcess.pid || devProcess.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(devProcess.pid), "/T", "/F"], { stdio: "ignore" });
    removeInsideWorkspace(isolatedNextDir);
    return;
  }

  devProcess.kill("SIGTERM");
  removeInsideWorkspace(isolatedNextDir);
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.on("exit", cleanup);

try {
  await waitForServer(`${baseUrl}/api/workbench-state`, 120000);
  const exitCode = await runSmokeBrowser();
  if (exitCode !== 0) {
    console.error(
      JSON.stringify(
        {
          script: "smoke-browser-isolated",
          status: "browser_smoke_failed",
          recentLogs
        },
        null,
        2
      )
    );
  }
  cleanup();
  process.exit(exitCode);
} catch (error) {
  cleanup();
  console.error(
    JSON.stringify(
      {
        script: "smoke-browser-isolated",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        recentLogs
      },
      null,
      2
    )
  );
  process.exit(1);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf("=");

    if (equalsIndex >= 0) {
      parsed[rawKey.slice(0, equalsIndex)] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }

  return parsed;
}

function sanitizeEnv(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string"));
}

function printUsage() {
  console.log("Usage: node scripts/smoke-browser-isolated.mjs [--scope content] [--port 3058] [--state-path data/workbench-browser-smoke-state.json] [--keep-state]");
}

function removeInsideWorkspace(relativePath) {
  const absoluteTarget = resolve(root, relativePath);
  const absoluteRoot = resolve(root);
  const isInsideRoot =
    process.platform === "win32"
      ? absoluteTarget.startsWith(`${absoluteRoot}\\`) || absoluteTarget === absoluteRoot
      : absoluteTarget.startsWith(`${absoluteRoot}/`) || absoluteTarget === absoluteRoot;

  if (!isInsideRoot || absoluteTarget === absoluteRoot) {
    throw new Error(`Refuse to remove path outside workspace: ${absoluteTarget}`);
  }

  rmSync(absoluteTarget, { recursive: true, force: true });
}

function rememberLog(chunk) {
  const text = chunk.toString("utf8").trim();
  if (!text) return;

  recentLogs.push(text);
  while (recentLogs.length > 20) recentLogs.shift();
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (devProcess.exitCode !== null) {
      throw new Error(`Dev server exited before ready with code ${devProcess.exitCode}.`);
    }

    if (await isServerReady(url, 2000)) {
      return;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

async function isServerReady(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function runSmokeBrowser() {
  return new Promise((resolveExitCode) => {
    const child = spawn(process.execPath, ["scripts/smoke-browser.mjs", "--scope", scope, "--base-url", baseUrl], {
      cwd: root,
      env: devEnv,
      stdio: "inherit",
      windowsHide: true
    });

    child.on("exit", (code) => resolveExitCode(code ?? 1));
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
