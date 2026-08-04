import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("monthly snapshot migration is dry-run by default and restores only richer plans", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v5-monthly-migration-"));
  const source = join(directory, "source.json");
  const target = join(directory, "target.json");
  const base = { schemaVersion: 1, strategyRows: {}, batchQueueItems: {}, exceptionItems: {}, scheduleDraftItems: {}, auditLog: [], idempotency: {} };
  await writeFile(source, JSON.stringify({ ...base, plans: { "2026-08": { id: "approved", strategyPackage: { strategyPackageId: "s1" }, matrixTasks: [{ taskId: "t1" }] } } }));
  await writeFile(target, JSON.stringify({ ...base, plans: { "2026-08": { id: "draft", matrixTasks: [] } } }));

  const script = fileURLToPath(new URL("./migrate-v5-monthly-snapshot.mjs", import.meta.url));
  const dryRun = await execFileAsync(process.execPath, [script, "--source", source, "--target", target]);
  assert.match(dryRun.stdout, /dry_run/);
  assert.equal(JSON.parse(await readFile(target, "utf8")).plans["2026-08"].id, "draft");

  await execFileAsync(process.execPath, [script, "--source", source, "--target", target, "--apply"], { cwd: directory });
  const migrated = JSON.parse(await readFile(target, "utf8"));
  assert.equal(migrated.plans["2026-08"].id, "approved");
  assert.equal(migrated.plans["2026-08"].matrixTasks.length, 1);
  assert.equal(migrated.auditLog.at(-1).action, "monthly_snapshot_migrated");
});
