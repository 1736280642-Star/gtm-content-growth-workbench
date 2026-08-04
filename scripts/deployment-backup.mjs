import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (typeof process.loadEnvFile === "function" && existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDirectory = resolve("backups", timestamp);
const snapshotName = `workbench-${timestamp.toLowerCase()}`;
await mkdir(backupDirectory, { recursive: true });

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: options.stdoutFile ? ["ignore", "pipe", "inherit"] : "inherit", shell: false });
    if (options.stdoutFile) child.stdout.pipe(createWriteStream(options.stdoutFile));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function openSearch(pathName, init = {}) {
  const port = process.env.OPENSEARCH_EXPOSE_PORT || "9200";
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, { ...init, headers: { "content-type": "application/json", ...init.headers }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`OpenSearch backup request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

try {
  await run("docker", ["compose", "--profile", "full", "exec", "-T", "mysql", "sh", "-c", "MYSQL_PWD=\"$MYSQL_PASSWORD\" mysqldump -u \"$MYSQL_USER\" --single-transaction --routines --events --add-drop-table \"$MYSQL_DATABASE\""], { stdoutFile: join(backupDirectory, "mysql.sql") });
  await openSearch("/_snapshot/workbench_fs", { method: "PUT", body: JSON.stringify({ type: "fs", settings: { location: "/usr/share/opensearch/backup", compress: true } }) });
  await openSearch(`/_snapshot/workbench_fs/${snapshotName}?wait_for_completion=true`, { method: "PUT", body: JSON.stringify({ indices: "v5-rag-*", include_global_state: false }) });
  await mkdir(join(backupDirectory, "opensearch"), { recursive: true });
  await run("docker", ["compose", "--profile", "full", "cp", "opensearch:/usr/share/opensearch/backup/.", join(backupDirectory, "opensearch")]);
  await writeFile(join(backupDirectory, "metadata.json"), `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), snapshotName }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, backupDirectory, snapshotName })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, backupDirectory, message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
}
