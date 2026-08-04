import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const fromIndex = process.argv.indexOf("--from");
const sourceDirectory = fromIndex >= 0 ? resolve(process.argv[fromIndex + 1] || "") : "";
if (!sourceDirectory || !process.argv.includes("--confirm-replace")) {
  process.stderr.write("Usage: node scripts/deployment-restore.mjs --from backups/<timestamp> --confirm-replace\n");
  process.exit(64);
}
const mysqlDump = resolve(sourceDirectory, "mysql.sql");
const openSearchBackup = resolve(sourceDirectory, "opensearch");
const metadataPath = resolve(sourceDirectory, "metadata.json");
if (![mysqlDump, openSearchBackup, metadataPath].every(existsSync)) throw new Error("Backup directory is incomplete.");
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: options.stdinFile ? ["pipe", "inherit", "inherit"] : "inherit", shell: false });
    if (options.stdinFile) createReadStream(options.stdinFile).pipe(child.stdin);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function openSearch(pathName, init = {}) {
  const port = process.env.OPENSEARCH_EXPOSE_PORT || "9200";
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, { ...init, headers: { "content-type": "application/json", ...init.headers }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`OpenSearch restore request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
}

await run("docker", ["compose", "--profile", "full", "cp", `${openSearchBackup}/.`, "opensearch:/usr/share/opensearch/backup"]);
await openSearch("/_snapshot/workbench_fs", { method: "PUT", body: JSON.stringify({ type: "fs", settings: { location: "/usr/share/opensearch/backup", compress: true } }) });
await openSearch("/v5-rag-*", { method: "DELETE" });
await openSearch(`/_snapshot/workbench_fs/${encodeURIComponent(metadata.snapshotName)}/_restore?wait_for_completion=true`, { method: "POST", body: JSON.stringify({ indices: "v5-rag-*", include_global_state: false, include_aliases: true }) });
await run("docker", ["compose", "--profile", "full", "exec", "-T", "mysql", "sh", "-c", "MYSQL_PWD=\"$MYSQL_PASSWORD\" mysql -u \"$MYSQL_USER\" \"$MYSQL_DATABASE\""], { stdinFile: mysqlDump });
process.stdout.write(`${JSON.stringify({ ok: true, restoredFrom: sourceDirectory, snapshotName: metadata.snapshotName })}\n`);
