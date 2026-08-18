import { execFileSync } from "node:child_process";
import { selectWorkbenchOneoffs } from "./lib/oneoff-container-policy.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const includeWorkers = args.has("--include-workers");
const drained = args.has("--drained");
const ageArg = process.argv.find((item) => item.startsWith("--minimum-age-minutes="));
const minimumAgeMinutes = Math.max(15, Math.min(24 * 60, Number(ageArg?.split("=")[1] || 60)));

if (includeWorkers && !drained) {
  throw new Error("Worker cleanup requires both --include-workers and --drained after the formal queue reports zero running operations.");
}

function docker(arguments_, options = {}) {
  try {
    return execFileSync("docker", arguments_, { encoding: "utf8", windowsHide: true }).trim();
  } catch (error) {
    if (options.allowFailure) return "";
    throw error;
  }
}

const lines = docker(["ps", "-a", "--filter", "label=com.docker.compose.oneoff=True", "--format", "{{json .}}"])
  .split(/\r?\n/)
  .filter(Boolean);
const now = Date.now();
const rows = lines.map((line) => {
  const row = JSON.parse(line);
  const created = docker(["inspect", "--format", "{{.Created}}", row.ID]);
  const autoRemove = docker(["inspect", "--format", "{{.HostConfig.AutoRemove}}", row.ID]) === "true";
  return { ...row, autoRemove, ageMinutes: Math.floor((now - Date.parse(created)) / 60_000) };
});
const selected = selectWorkbenchOneoffs(rows, { workingDirectory: process.cwd(), includeWorkers, minimumAgeMinutes });

const report = {
  mode: apply ? "apply" : "audit",
  minimumAgeMinutes,
  includeWorkers,
  selected: selected.map((row) => ({ id: row.ID, name: row.Names, status: row.Status, ageMinutes: row.ageMinutes }))
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (apply) {
  const selectedIds = selected.map((row) => row.ID);
  if (selectedIds.length) {
    docker(["stop", "--time", "10", ...selectedIds]);
    const retainedIds = selected.filter((row) => !row.autoRemove).map((row) => row.ID);
    if (retainedIds.length) docker(["rm", ...retainedIds], { allowFailure: true });
  }
  process.stdout.write(`${JSON.stringify({ cleanupRequested: selected.map((row) => row.Names) })}\n`);
}
