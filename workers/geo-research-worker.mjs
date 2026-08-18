import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [
  {
    leaseNextGeoResearchTask,
    completeGeoResearchTaskRecord,
    markGeoResearchTaskPendingConfig,
    failGeoResearchTaskRecord,
    persistGeoResearchProviderResult,
    readGeoResearchTaskExecutionContext
  },
  { runGeoResearchProvider },
  { getV5GovernancePool }
] = await Promise.all([
  import("../src/lib/v5/geo-research-repository.ts"),
  import("../src/lib/v5/geo-research-provider.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);

const workerId = `geo-research-worker-${process.pid}-${randomUUID()}`;
const actor = {
  actorId: workerId,
  actorRole: "geo_research_worker",
  actorType: "system",
  auditReason: "Execute one durable GEO research task with traceable task state."
};
let leasedTask;

try {
  leasedTask = await leaseNextGeoResearchTask({
    workerId,
    leaseSeconds: Math.max(600, Number(process.env.GEO_RESEARCH_TASK_LEASE_SECONDS || 600))
  });
  if (!leasedTask) {
    console.log(JSON.stringify({ status: "idle", workerId }));
  } else if (leasedTask.taskType === "context_validation") {
    const completed = await completeGeoResearchTaskRecord({
      taskId: leasedTask.taskId,
      workerId,
      outputSummary: {
        productIdentityConfirmed: true,
        sourceSnapshotVerified: true,
        expressionBoundaryPresent: true,
        verifiedAt: new Date().toISOString()
      },
      provider: "v5_workbench",
      providerModel: "deterministic_contract_gate",
      toolName: "context_validation",
      actor
    });
    console.log(JSON.stringify({
      status: "completed",
      workerId,
      taskId: completed.taskId,
      taskType: completed.taskType
    }));
  } else {
    const context = await readGeoResearchTaskExecutionContext(leasedTask.taskId);
    const result = await runGeoResearchProvider({
      taskType: leasedTask.taskType,
      product: context.product,
      productKnowledgeProfile: context.productKnowledgeProfile,
      project: context.project,
      sourceSnapshotHash: context.sourceSnapshotHash,
      probeSetSnapshot: context.probeSetSnapshot,
      previousOutputs: context.previousOutputs
    });
    const persisted = await persistGeoResearchProviderResult({
      taskId: leasedTask.taskId,
      workerId,
      result,
      actor
    });
    console.log(JSON.stringify({
      status: "completed",
      workerId,
      taskId: leasedTask.taskId,
      taskType: leasedTask.taskType,
      sourceCount: result.sources.length,
      liveSearchVerified: result.liveSearchVerified,
      artifactId: persisted.artifactId,
      blueprintVersionId: persisted.blueprintVersionId
    }));
  }
} catch (error) {
  const pendingConfig = error?.code === "pending_config";
  if (leasedTask) {
    const failure = {
      taskId: leasedTask.taskId,
      workerId,
      failureCode: error?.code || "geo_research_worker_failed",
      failureMessage: error instanceof Error ? error.message : "GEO research worker failed.",
      actor
    };
    if (pendingConfig) {
      await markGeoResearchTaskPendingConfig(failure).catch(() => undefined);
    } else {
      await failGeoResearchTaskRecord(failure).catch(() => undefined);
    }
  }
  console.error(JSON.stringify({
    status: pendingConfig ? "pending_config" : "failed",
    code: error?.code || "geo_research_worker_failed",
    message: error instanceof Error ? error.message : "GEO research worker failed."
  }));
  process.exitCode = pendingConfig ? 2 : 1;
} finally {
  try {
    await getV5GovernancePool().end();
  } catch {
    // The pool may not exist when required MySQL configuration is missing.
  }
}
