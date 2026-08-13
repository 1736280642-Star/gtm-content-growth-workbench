import { loadProjectEnv } from "../scripts/load-project-env.mjs";

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
  const tasks = await repository.readReadyAutomaticGenerationTasks(Number(process.env.V5_CONTENT_WORKER_BATCH_SIZE || 20));
  const results = [];
  for (const task of tasks) {
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
      results.push({ taskId: task.taskId, status: "completed", draftVersionId: result.draftVersion.draftVersionId });
    } catch (error) {
      results.push({
        taskId: task.taskId,
        status: error?.code === "provider_pending_config" ? "pending_config" : "failed",
        code: error?.code || "automatic_generation_failed"
      });
    }
  }
  console.log(JSON.stringify({ status: tasks.length ? "processed" : "idle", processed: results.length, results }));
}

await getV5GovernancePool().end();
