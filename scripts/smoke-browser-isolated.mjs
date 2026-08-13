import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createConnection } from "node:net";
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
const diagnosticLogPath = resolve(root, `.tmp-smoke-browser-${port}.log`);
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

rmSync(diagnosticLogPath, { force: true });

if (await isPortListening(host, port, 1000)) {
  throw new Error(`Port ${port} is already listening. Choose another --port for isolated browser smoke.`);
}

await removeInsideWorkspaceWithTimeout(isolatedNextDir, 10000);

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

let devProcessStartupError;
devProcess.on("error", (error) => {
  devProcessStartupError = error;
});
devProcess.stdout.on("data", (chunk) => rememberLog(chunk));
devProcess.stderr.on("data", (chunk) => rememberLog(chunk));

let cleanupPromise;
const cleanup = () => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {

    if (devProcess.pid && devProcess.exitCode === null) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(devProcess.pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 10000,
          windowsHide: true
        });
        terminateWindowsListener(port);
        // On Windows the nested Next.js listener can appear a moment after
        // the command-shell process tree exits. Recheck once so a failed
        // smoke run never poisons the next run with an orphaned port.
        await sleep(500);
        terminateWindowsListener(port);
      } else {
        devProcess.kill("SIGTERM");
      }
    }

    await removeInsideWorkspaceWithTimeout(isolatedNextDir, 10000);
  })();
  return cleanupPromise;
};

process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143));
});

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
  await cleanup();
  rmSync(diagnosticLogPath, { force: true });
  process.exit(exitCode);
} catch (error) {
  await cleanup();
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
  const output = {};
  const normalizedKeys = new Map();

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") continue;
    const normalizedKey = process.platform === "win32" ? key.toLowerCase() : key;
    const previousKey = normalizedKeys.get(normalizedKey);
    if (previousKey) {
      // Windows treats environment keys case-insensitively. Prefer the native
      // `Path` spelling when both Path and PATH leak into the parent process.
      if (normalizedKey === "path" && key === "Path") {
        delete output[previousKey];
        output[key] = value;
        normalizedKeys.set(normalizedKey, key);
      }
      continue;
    }
    output[key] = value;
    normalizedKeys.set(normalizedKey, key);
  }

  return output;
}

function printUsage() {
  console.log("Usage: node scripts/smoke-browser-isolated.mjs [--scope content] [--port 3058] [--state-path data/workbench-browser-smoke-state.json] [--keep-state]");
}

async function removeInsideWorkspaceWithTimeout(relativePath, timeoutMs) {
  const absoluteTarget = resolve(root, relativePath);
  const absoluteRoot = resolve(root);
  const isInsideRoot =
    process.platform === "win32"
      ? absoluteTarget.startsWith(`${absoluteRoot}\\`) || absoluteTarget === absoluteRoot
      : absoluteTarget.startsWith(`${absoluteRoot}/`) || absoluteTarget === absoluteRoot;

  if (!isInsideRoot || absoluteTarget === absoluteRoot) {
    throw new Error(`Refuse to remove path outside workspace: ${absoluteTarget}`);
  }

  let timer;
  await Promise.race([
    rm(absoluteTarget, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }),
    new Promise((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function isPortListening(hostname, targetPort, timeoutMs) {
  return new Promise((resolveListening) => {
    const socket = createConnection({ host: hostname, port: targetPort });
    const finish = (listening) => {
      socket.destroy();
      resolveListening(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function terminateWindowsListener(targetPort) {
  const netstat = spawnSync("netstat", ["-ano"], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true
  });
  const expression = new RegExp(`^\\s*TCP\\s+\\S+:${targetPort}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, "mi");
  const listenerPid = Number.parseInt(String(netstat.stdout || "").match(expression)?.[1] || "", 10);
  if (!Number.isInteger(listenerPid) || listenerPid <= 0 || listenerPid === process.pid) return;
  spawnSync("taskkill", ["/PID", String(listenerPid), "/T", "/F"], {
    stdio: "ignore",
    timeout: 10000,
    windowsHide: true
  });
}

function rememberLog(chunk) {
  const text = chunk.toString("utf8").trim();
  if (!text) return;

  appendFileSync(diagnosticLogPath, `${text}\n`, "utf8");
  recentLogs.push(text);
  while (recentLogs.length > 20) recentLogs.shift();
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (devProcessStartupError) {
      throw new Error(`Unable to start dev server: ${devProcessStartupError.message}`);
    }
    if (devProcess.exitCode !== null) {
      throw new Error(`Dev server exited before ready with code ${devProcess.exitCode}.`);
    }

    // Next.js development mode can spend several seconds compiling the first
    // API request. A two-second client timeout can therefore reject a real
    // HTTP 200 response repeatedly and report a false startup failure.
    if (await isServerReady(url, 10000)) {
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
