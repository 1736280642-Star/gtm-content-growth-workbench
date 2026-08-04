import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [{ runAutomaticMonthlyPlan, runAutomaticSchedule }, { getV5GovernancePool }] = await Promise.all([
  import("../src/lib/v5/monthly-automation-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit"
}).format(new Date());

try {
  const strategy = await runAutomaticMonthlyPlan(month);
  const schedule = await runAutomaticSchedule(month);
  console.log(JSON.stringify({ status: "completed", month, strategy, schedule }));
  if (strategy.status === "attention" || schedule.status === "attention") process.exitCode = 2;
} catch (error) {
  const pendingConfig = ["pending_config", "V5_GOVERNANCE_PENDING_CONFIG"].includes(error?.code);
  console.error(JSON.stringify({
    status: pendingConfig ? "pending_config" : "failed",
    code: error?.code || "monthly_automation_failed",
    message: error instanceof Error ? error.message : "Monthly automation failed."
  }));
  process.exitCode = pendingConfig ? 2 : 1;
} finally {
  try {
    await getV5GovernancePool().end();
  } catch {
    // Database configuration may intentionally be absent in local setup.
  }
}
