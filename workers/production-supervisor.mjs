import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();
const role = process.env.WORKER_ROLE?.trim();
const statusDirectory = process.env.WORKER_STATUS_DIR?.trim() || "/app/runtime/worker-status";
const integer = (name, fallback, minimum = 5, maximum = 86_400) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum ? Math.min(value, maximum) : fallback;
};
const oneShot = (name, script, intervalName, fallback, extra = []) => ({
  name,
  args: ["--no-warnings", "--experimental-transform-types", "--loader", "./workers/typescript-loader.mjs", script, ...extra],
  intervalMs: integer(intervalName, fallback) * 1000,
  longRunning: false
});
const definitions = {
  "rag-index-worker": [oneShot("rag-index", "workers/rag-index-worker.mjs", "RAG_INDEX_WORKER_INTERVAL_SECONDS", 15)],
  "knowledge-worker": [
    oneShot("rag-source-import", "workers/rag-source-import-worker.mjs", "RAG_SOURCE_IMPORT_INTERVAL_SECONDS", 300, ["--write", "--production-text-only"]),
    oneShot("knowledge-refresh", "workers/knowledge-refresh-worker.mjs", "KNOWLEDGE_REFRESH_INTERVAL_SECONDS", 15),
    oneShot("knowledge-collection", "workers/knowledge-collection-worker.mjs", "KNOWLEDGE_COLLECTION_INTERVAL_SECONDS", 900),
    oneShot("geo-research-orchestration", "workers/geo-research-orchestrator.mjs", "GEO_RESEARCH_ORCHESTRATION_INTERVAL_SECONDS", 300),
    oneShot("geo-research", "workers/geo-research-worker.mjs", "GEO_RESEARCH_INTERVAL_SECONDS", 60)
  ],
  "content-worker": [
    oneShot("monthly-automation", "workers/monthly-automation-worker.mjs", "MONTHLY_AUTOMATION_INTERVAL_SECONDS", 60),
    oneShot("content-production", "workers/content-production-worker.mjs", "CONTENT_WORKER_INTERVAL_SECONDS", 15)
  ],
  "monitor-worker": [{
    name: "geo-monitor-pipeline",
    args: ["workers/schedule-pipeline.mjs", "--repeat", "--interval-seconds", String(integer("PIPELINE_WORKER_INTERVAL_SECONDS", 3600, 300, 86_400)), "--max-runs", "1000"],
    intervalMs: 5_000,
    longRunning: true
  },
    oneShot("site-audit", "workers/site-audit-worker.mjs", "SITE_AUDIT_WORKER_INTERVAL_SECONDS", 30),
    oneShot("geo-monitoring-scheduler", "workers/geo-monitoring-scheduler.mjs", "GEO_MONITORING_SCHEDULER_INTERVAL_SECONDS", 3600)
  ],
  "publish-worker": [{ name: "direct-publish", args: ["workers/direct-publish-worker.mjs", "--interval-seconds", String(integer("PUBLISH_WORKER_INTERVAL_SECONDS", 30, 10, 3600))], intervalMs: 5_000, longRunning: true }]
};
if (!role || !definitions[role]) {
  process.stderr.write(`${JSON.stringify({ event: "invalid_worker_role", role, supportedRoles: Object.keys(definitions) })}\n`);
  process.exit(64);
}

const jobs = definitions[role].map((job) => ({ ...job, state: "starting", child: undefined, consecutiveFailures: 0, nextRunAt: new Date().toISOString() }));
let stopping = false;
const log = (payload) => process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), role, ...payload })}\n`);

async function heartbeat() {
  await mkdir(statusDirectory, { recursive: true });
  const target = join(statusDirectory, `${role}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  const payload = {
    schemaVersion: 1,
    role,
    supervisorPid: process.pid,
    status: stopping ? "stopping" : "running",
    heartbeatAt: new Date().toISOString(),
    jobs: jobs.map(({ child, args, intervalMs, longRunning, ...job }) => ({ ...job, pid: child?.pid, intervalSeconds: intervalMs / 1000, longRunning }))
  };
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function schedule(job, delayMs) {
  job.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  setTimeout(() => void run(job), delayMs);
}

function run(job) {
  if (stopping || job.child) return;
  job.state = "running";
  job.lastStartedAt = new Date().toISOString();
  job.nextRunAt = undefined;
  const child = spawn(process.execPath, job.args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  job.child = child;
  log({ event: "worker_job_started", job: job.name, pid: child.pid });
  child.once("error", (error) => log({ level: "error", event: "worker_job_spawn_failed", job: job.name, message: error.message }));
  child.once("exit", (code, signal) => {
    job.child = undefined;
    job.lastFinishedAt = new Date().toISOString();
    job.lastExitCode = code;
    job.state = code === 0 ? "idle" : code === 2 ? "pending_config" : "failed";
    job.consecutiveFailures = code === 0 || code === 2 ? 0 : job.consecutiveFailures + 1;
    log({ level: code === 0 ? "info" : "warn", event: "worker_job_finished", job: job.name, code, signal, state: job.state });
    if (!stopping) schedule(job, code === 0 || code === 2 ? job.intervalMs : Math.min(job.intervalMs * job.consecutiveFailures, 300_000));
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log({ event: "worker_supervisor_stopping", signal });
  for (const job of jobs) job.child?.kill("SIGTERM");
  await heartbeat().catch(() => undefined);
  setTimeout(() => process.exit(1), 25_000).unref();
  await Promise.all(jobs.map((job) => job.child ? new Promise((resolve) => job.child.once("exit", resolve)) : Promise.resolve()));
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(signal));
await heartbeat();
setInterval(() => void heartbeat().catch((error) => log({ level: "error", event: "heartbeat_write_failed", message: error.message })), integer("WORKER_HEARTBEAT_SECONDS", 10, 5, 60) * 1000);
for (const job of jobs) run(job);
log({ event: "worker_supervisor_ready", jobs: jobs.map((job) => job.name) });
