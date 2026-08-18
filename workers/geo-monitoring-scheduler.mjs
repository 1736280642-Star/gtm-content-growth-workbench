import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();
const [{ ensureCurrentMonthGeoMonitoringTasks }, { getV5GovernancePool }] = await Promise.all([
  import("../src/lib/v5/geo-monitoring-repository.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);
try {
  const result = await ensureCurrentMonthGeoMonitoringTasks();
  console.log(JSON.stringify({ status: "completed", ...result }));
} catch (error) {
  const pending = error?.code === "pending_config";
  console.error(JSON.stringify({ status: pending ? "pending_config" : "failed", code: error?.code || "geo_monitoring_scheduler_failed", message: error instanceof Error ? error.message : "geo_monitoring_scheduler_failed" }));
  process.exitCode = pending ? 2 : 1;
} finally {
  try { await getV5GovernancePool().end(); } catch { /* pool was never configured */ }
}
