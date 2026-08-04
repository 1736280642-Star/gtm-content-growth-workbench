import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = option("--source");
const targetPath = resolve(option("--target") || "data/v5-monthly-workbench.json");
const apply = process.argv.includes("--apply");

if (!sourcePath) {
  throw new Error("Usage: node scripts/migrate-v5-monthly-snapshot.mjs --source <snapshot.json> [--target <state.json>] [--apply]");
}

const resolvedSource = resolve(sourcePath);
if (resolvedSource === targetPath) throw new Error("Source and target must be different files.");

const [source, target] = await Promise.all([
  readFile(resolvedSource, "utf8").then(JSON.parse),
  readFile(targetPath, "utf8").then(JSON.parse)
]);

if (!source?.plans || !target?.plans) throw new Error("Both files must be V5 monthly workbench snapshots.");

const changes = [];
for (const [month, sourcePlan] of Object.entries(source.plans)) {
  const targetPlan = target.plans[month];
  const sourceTaskCount = Array.isArray(sourcePlan?.matrixTasks) ? sourcePlan.matrixTasks.length : 0;
  const targetTaskCount = Array.isArray(targetPlan?.matrixTasks) ? targetPlan.matrixTasks.length : 0;
  const sourceHasStrategy = Boolean(sourcePlan?.strategyPackage);
  const targetHasStrategy = Boolean(targetPlan?.strategyPackage);
  const shouldRestore = !targetPlan
    || sourceTaskCount > targetTaskCount
    || (sourceHasStrategy && !targetHasStrategy);

  changes.push({
    month,
    action: shouldRestore ? (targetPlan ? "restore_richer_snapshot" : "add_month") : "keep_target",
    sourceTaskCount,
    targetTaskCount,
    sourceHasStrategy,
    targetHasStrategy
  });

  if (shouldRestore) target.plans[month] = sourcePlan;
}

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry_run",
  source: basename(resolvedSource),
  target: basename(targetPath),
  changes
};

if (apply) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = resolve("backups", `monthly-snapshot-migration-${timestamp}`);
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(targetPath, resolve(backupDirectory, basename(targetPath)));
  target.auditLog = Array.isArray(target.auditLog) ? target.auditLog : [];
  target.auditLog.push({
    id: `monthly-snapshot-migration-${timestamp}`,
    action: "monthly_snapshot_migrated",
    objectType: "monthly_workspace",
    objectId: "v5-monthly-workbench",
    actor: "migration_script",
    reason: "Restore richer approved monthly plans and matrix tasks from a verified workbench snapshot.",
    createdAt: new Date().toISOString(),
    summary: changes
  });
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  summary.backupDirectory = backupDirectory;
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
