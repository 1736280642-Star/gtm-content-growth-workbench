import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const watchRoots = ["workers", "src", "scripts", "database", "config"];
const pollIntervalMs = 1000;
const restartDelayMs = 250;
const gracefulStopMs = 5000;

let child;
let stopping = false;
let restarting = false;
let snapshot = await createSnapshot();

function startWorker() {
  child = spawn(process.execPath, ["workers/production-supervisor.mjs"], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    child = undefined;
    if (stopping || restarting) return;
    console.error(`[worker-dev] Supervisor exited (${signal || code}). Restarting in 1 second.`);
    setTimeout(startWorker, 1000);
  });
}

async function createSnapshot() {
  const next = new Map();
  for (const directory of watchRoots) {
    await visit(join(root, directory), next);
  }
  return next;
}

async function visit(path, target) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath, target);
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(fullPath);
    target.set(relative(root, fullPath), `${metadata.mtimeMs}:${metadata.size}`);
  }
}

function findChange(previous, next) {
  for (const [path, signature] of next) {
    if (previous.get(path) !== signature) return path;
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) return path;
  }
  return undefined;
}

async function restartWorker(changedPath) {
  if (restarting || stopping) return;
  restarting = true;
  console.log(`[worker-dev] Source changed: ${changedPath}. Restarting supervisor.`);

  const runningChild = child;
  if (runningChild) {
    runningChild.kill("SIGTERM");
    const forceTimer = setTimeout(() => runningChild.kill("SIGKILL"), gracefulStopMs);
    await new Promise((resolve) => runningChild.once("exit", resolve));
    clearTimeout(forceTimer);
  }

  await new Promise((resolve) => setTimeout(resolve, restartDelayMs));
  restarting = false;
  if (!stopping) startWorker();
}

async function poll() {
  try {
    const next = await createSnapshot();
    const changedPath = findChange(snapshot, next);
    snapshot = next;
    if (changedPath) await restartWorker(changedPath);
  } catch (error) {
    console.error(`[worker-dev] Watch failed: ${error.message}`);
  } finally {
    if (!stopping) setTimeout(poll, pollIntervalMs);
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker-dev] Received ${signal}; stopping supervisor.`);
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(`[worker-dev] Watching ${watchRoots.join(", ")} every ${pollIntervalMs}ms.`);
startWorker();
setTimeout(poll, pollIntervalMs);
