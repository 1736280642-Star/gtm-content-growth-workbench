import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();
const [{ leaseNextSiteAuditRun, completeSiteAuditRun, failSiteAuditRun }, { runSiteAudit }, { getV5GovernancePool }, { reconcileExistingOfficialWebsiteSources }] = await Promise.all([
  import("../src/lib/v5/site-audit-repository.ts"),
  import("../src/lib/v5/site-audit-runner.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts"),
  import("../src/lib/v5/website-coverage-repository.ts")
]);
const workerId = `site-audit-worker-${process.pid}-${randomUUID()}`;
let run;
try {
  const reconciliation = await reconcileExistingOfficialWebsiteSources({
    actorId: workerId,
    actorRole: "capture_runner",
    actorType: "runner",
    auditReason: "站点审计 worker 启动时回填存量正式官网来源，确保历史产品也进入 GEO 前置审计"
  });
  run = await leaseNextSiteAuditRun({ workerId, leaseSeconds: Math.max(60, Number(process.env.SITE_AUDIT_LEASE_SECONDS || 900)) });
  if (!run) console.log(JSON.stringify({ status: "idle", workerId, reconciliation }));
  else {
    const result = await runSiteAudit({ runId: run.id, scopeUrl: run.scopeUrl, sitemapUrl: run.sitemapUrl, scopeMode: run.scopeMode });
    const saved = await completeSiteAuditRun({ run, result, workerId });
    console.log(JSON.stringify({ status: "completed", workerId, reconciliation, ...saved }));
  }
} catch (error) {
  if (run) await failSiteAuditRun({ runId: run.id, workerId, message: error instanceof Error ? error.message : "site_audit_failed" }).catch(() => undefined);
  const pending = error?.code === "pending_config";
  console.error(JSON.stringify({ status: pending ? "pending_config" : "failed", code: error?.code || "site_audit_worker_failed", message: error instanceof Error ? error.message : "site_audit_worker_failed" }));
  process.exitCode = pending ? 2 : 1;
} finally {
  try { await getV5GovernancePool().end(); } catch { /* pool was never configured */ }
}
