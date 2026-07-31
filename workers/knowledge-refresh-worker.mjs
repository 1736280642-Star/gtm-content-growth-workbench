import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [{ leaseNextRagJob, finishRagJob }, { runAutomaticKnowledgeRefresh }, { getRagInfrastructureStatus, RagInfrastructureError }, { extractManagedClaimsForProduct }, { getV5GovernancePool }] = await Promise.all([
  import("../src/lib/v5/rag/job-repository.ts"),
  import("../src/lib/v5/rag/knowledge-refresh-service.ts"),
  import("../src/lib/v5/rag/infrastructure.ts"),
  import("../src/lib/v5/rag/managed-claim-extraction-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

const workerId = `knowledge-refresh-worker-${process.pid}-${randomUUID()}`;
let leasedJob;
try {
  const infrastructure = getRagInfrastructureStatus();
  if (infrastructure.mysql.status !== "ready") {
    throw new RagInfrastructureError("pending_config", "Knowledge refresh requires the V5 MySQL store.", infrastructure.mysql.missingConfig);
  }
  leasedJob = await leaseNextRagJob(workerId, 300, ["knowledge_refresh"]);
  if (!leasedJob) {
    console.log(JSON.stringify({ status: "idle", workerId }));
  } else if (!leasedJob.productId) {
    await finishRagJob({ jobId: leasedJob.jobId, workerId, status: "failed", failureCode: "product_id_missing", failureMessage: "knowledge_refresh requires productId." });
    process.exitCode = 1;
  } else {
    const extraction = await extractManagedClaimsForProduct(leasedJob.productId, {
      actorId: workerId,
      actorRole: "knowledge_production_worker",
      actorType: "system",
      auditReason: "Extract governed Claims from workbench-managed SourceRevision content."
    });
    const result = await runAutomaticKnowledgeRefresh({
      productId: leasedJob.productId,
      actor: {
        actorId: workerId,
        actorRole: "knowledge_production_worker",
        actorType: "system",
        auditReason: "Automatically refresh governed knowledge after a SourceRevision change."
      }
    });
    await finishRagJob({ jobId: leasedJob.jobId, workerId, status: "completed" });
    console.log(JSON.stringify({
      status: "completed",
      jobId: leasedJob.jobId,
      productId: leasedJob.productId,
      extraction,
      sourceSnapshotHash: result.context.sourceSnapshotHash,
      indexSnapshotId: result.index.snapshot.indexSnapshotId,
      indexStatus: result.index.snapshot.status,
      reboundTaskCount: result.context.reboundTaskCount
    }));
  }
} catch (error) {
  const pending = error instanceof RagInfrastructureError || error?.code === "pending_config";
  if (leasedJob) {
    await finishRagJob({
      jobId: leasedJob.jobId,
      workerId,
      status: pending ? "pending_config" : "failed",
      failureCode: pending ? "pending_config" : "knowledge_refresh_failed",
      failureMessage: error instanceof Error ? error.message : "Automatic knowledge refresh failed."
    }).catch(() => undefined);
  }
  console.error(JSON.stringify({ status: pending ? "pending_config" : "failed", code: pending ? "pending_config" : "knowledge_refresh_failed" }));
  process.exitCode = pending ? 2 : 1;
} finally {
  await getV5GovernancePool().end();
}
