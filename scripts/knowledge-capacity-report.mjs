import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const rootUrl = new URL(process.env.WORKBENCH_CAPACITY_BASE_URL || "http://127.0.0.1:3027");
const openSearchUrl = new URL(process.env.WORKBENCH_CAPACITY_OPENSEARCH_URL || "http://127.0.0.1:9200");
const warningBytes = Number(process.env.WORKBENCH_CAPACITY_WARNING_BYTES || 20 * 1024 ** 3);

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  let amount = bytes;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function runDocker(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", argumentsList, { cwd: process.cwd(), windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`docker exited with ${code}: ${stderr.trim().slice(0, 300)}`)));
  });
}

async function directoryBytes(service, path) {
  const output = await runDocker(["compose", "--profile", "full", "exec", "-T", service, "sh", "-c", `du -sk '${path}'`]);
  const kilobytes = Number(output.split(/\s+/)[0]);
  if (!Number.isFinite(kilobytes)) throw new Error(`Unable to parse ${service}:${path} capacity.`);
  return kilobytes * 1024;
}

async function readHealth() {
  const response = await fetch(new URL("/api/health", rootUrl), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Workbench health returned HTTP ${response.status}.`);
  return response.json();
}

async function readIndexes() {
  const url = new URL("/_cat/indices/v5-rag-*?format=json&bytes=b&h=index,store.size,docs.count", openSearchUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OpenSearch index stats returned HTTP ${response.status}.`);
  const rows = await response.json();
  return rows.map((row) => ({
    index: String(row.index || ""),
    bytes: Number(row["store.size"] || 0),
    documents: Number(row["docs.count"] || 0)
  }));
}

export async function buildCapacityReport() {
  const [health, indexes, mysqlBytes, openSearchBytes, sourceBytes, artifactBytes] = await Promise.all([
    readHealth(),
    readIndexes(),
    directoryBytes("mysql", "/var/lib/mysql"),
    directoryBytes("opensearch", "/usr/share/opensearch/data"),
    directoryBytes("workbench-web", "/app/data"),
    directoryBytes("workbench-web", "/app/artifacts")
  ]);
  const totalBytes = mysqlBytes + openSearchBytes + sourceBytes + artifactBytes;
  return {
    checkedAt: new Date().toISOString(),
    profile: health.profile,
    productionReady: health.ok === true && health.profile === "full",
    storage: {
      mysql: { bytes: mysqlBytes, display: formatBytes(mysqlBytes) },
      opensearch: { bytes: openSearchBytes, display: formatBytes(openSearchBytes) },
      sourceData: { bytes: sourceBytes, display: formatBytes(sourceBytes) },
      artifacts: { bytes: artifactBytes, display: formatBytes(artifactBytes) },
      total: { bytes: totalBytes, display: formatBytes(totalBytes) }
    },
    indexes: indexes.map((item) => ({ ...item, display: formatBytes(item.bytes) })),
    warnings: totalBytes >= warningBytes
      ? ["Knowledge storage has crossed the configured warning threshold. Review inactive indexes, duplicate raw assets, and retention policy before importing another large archive."]
      : []
  };
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    process.stdout.write(`${JSON.stringify(await buildCapacityReport(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
