import { readFile } from "node:fs/promises";
import { join } from "node:path";

const role = process.argv[2] || process.env.WORKER_ROLE;
const directory = process.env.WORKER_STATUS_DIR?.trim() || "/app/runtime/worker-status";
const maximumAgeMs = Number(process.env.WORKER_HEALTH_MAX_AGE_SECONDS || 45) * 1000;
try {
  if (!role) throw new Error("worker role is required");
  const payload = JSON.parse(await readFile(join(directory, `${role}.json`), "utf8"));
  const ageMs = Date.now() - Date.parse(payload.heartbeatAt);
  if (payload.status !== "running" || !Number.isFinite(ageMs) || ageMs > maximumAgeMs) throw new Error(`stale worker heartbeat (${ageMs}ms)`);
  process.stdout.write(`${JSON.stringify({ ok: true, role, ageMs })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, role, message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
}
