import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [{ reconcileHostedPromotionOrders }, { reconcileHostedDailyPublishBatches }, { dispatchHostedNotifications }, { getV5GovernancePool }] = await Promise.all([
  import("../src/lib/v5/hosted-managed-service.ts"),
  import("../src/lib/v5/hosted-daily-batch-service.ts"),
  import("../src/lib/v5/hosted-notification-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

try {
  const orders = await reconcileHostedPromotionOrders(100);
  const dailyBatches = await reconcileHostedDailyPublishBatches(100);
  const notifications = await dispatchHostedNotifications(50);
  process.stdout.write(`${JSON.stringify({
    status: notifications.pendingConfig ? "pending_config" : "completed",
    reconciledOrders: orders.processed,
    reconciledDailyBatches: dailyBatches.processed,
    deliveredNotifications: notifications.processed
  })}\n`);
  if (notifications.pendingConfig) process.exitCode = 2;
} catch (error) {
  const pendingConfig = ["pending_config", "hosted_review_secret_missing"].includes(error?.code);
  process.stderr.write(`${JSON.stringify({
    status: pendingConfig ? "pending_config" : "failed",
    code: error?.code || "hosted_managed_worker_failed",
    message: error instanceof Error ? error.message : "Hosted managed worker failed."
  })}\n`);
  process.exitCode = pendingConfig ? 2 : 1;
} finally {
  try { await getV5GovernancePool().end(); } catch { /* Database may be intentionally unavailable locally. */ }
}
