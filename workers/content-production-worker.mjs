import { loadProjectEnv } from "../scripts/load-project-env.mjs";
import { boundedInteger, mapWithConcurrency } from "./worker-utils.mjs";

loadProjectEnv();

const generationPolicyVersion = "formal-generation@2";

const [{ hasV5GovernanceDatabaseConfig, getV5GovernancePool }, repository, service] = await Promise.all([
  import("../src/lib/v5/knowledge-governance-repository.ts"),
  import("../src/lib/v5/single-article-production-repository.ts"),
  import("../src/lib/v5/single-article-production-service.ts")
]);

if (!hasV5GovernanceDatabaseConfig()) {
  console.error(JSON.stringify({ status: "pending_config", code: "mysql_pending_config" }));
  process.exitCode = 2;
} else {
  const recovery = await repository.recoverStaleProductSampleOperations({
    staleAfterMinutes: Number(process.env.V5_SAMPLE_OPERATION_STALE_MINUTES || 20),
    maxAttempts: Number(process.env.V5_SAMPLE_OPERATION_MAX_ATTEMPTS || 3)
  });
  const sampleOperations = await repository.readQueuedProductSampleOperations(Number(process.env.V5_SAMPLE_WORKER_BATCH_SIZE || 3));
  const sampleConcurrency = boundedInteger(process.env.V5_SAMPLE_WORKER_CONCURRENCY, 2, 1, 3);
  const sampleResults = await mapWithConcurrency(sampleOperations, sampleConcurrency, async (operation) => {
    try {
      const result = await service.prepareAndGenerateSingleArticle({
        taskId: operation.taskId,
        idempotencyKey: operation.idempotencyKey,
        actor: {
          actorId: "v5-content-production-worker",
          actorRole: "knowledge_production_worker",
          actorType: "system",
          auditReason: "System claimed a durable product sample generation operation"
        },
        productionMode: "sample"
      });
      return { taskId: operation.taskId, operationId: operation.operationId, status: "completed", draftVersionId: result.draftVersion.draftVersionId };
    } catch (error) {
      return {
        taskId: operation.taskId,
        operationId: operation.operationId,
        status: error?.code === "provider_pending_config" ? "pending_config" : "failed",
        code: error?.code || "sample_generation_failed"
      };
    }
  });
  const tasks = await repository.readReadyAutomaticGenerationTasks(Number(process.env.V5_CONTENT_WORKER_BATCH_SIZE || 20));
  const contentConcurrency = boundedInteger(process.env.V5_CONTENT_WORKER_CONCURRENCY, 2, 1, 3);
  const results = await mapWithConcurrency(tasks, contentConcurrency, async (task) => {
    try {
      const result = await service.prepareAndGenerateSingleArticle({
        taskId: task.taskId,
        idempotencyKey: `automatic-generation:${task.taskId}:${task.taskVersion}:${generationPolicyVersion}`,
        actor: {
          actorId: "v5-content-production-worker",
          actorRole: "knowledge_production_worker",
          actorType: "system",
          auditReason: "System automatically claimed a ready_for_generation task"
        },
        productionMode: "batch"
      });
      return { taskId: task.taskId, status: "completed", draftVersionId: result.draftVersion.draftVersionId };
    } catch (error) {
      return {
        taskId: task.taskId,
        status: error?.code === "provider_pending_config" ? "pending_config" : "failed",
        code: error?.code || "automatic_generation_failed"
      };
    }
  });
  console.log(JSON.stringify({
    status: tasks.length || sampleOperations.length ? "processed" : "idle",
    recoveredSamples: recovery.recovered.length,
    exhaustedSamples: recovery.exhausted.length,
    reconciledGenerationRuns: recovery.reconciledGenerationRuns.length,
    sampleConcurrency,
    contentConcurrency,
    processedSamples: sampleResults.length,
    sampleResults,
    processed: results.length,
    results
  }));
}

await getV5GovernancePool().end();
