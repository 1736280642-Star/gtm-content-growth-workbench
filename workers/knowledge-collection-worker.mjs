import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const { runKnowledgeCollection } = await import("../src/lib/v5/knowledge-collection-service.ts");
const argv = process.argv.slice(2);
const repeat = argv.includes("--repeat");
const force = argv.includes("--force");
const sourceArgument = argv.find((item) => item.startsWith("--source="));
const intervalArgument = argv.find((item) => item.startsWith("--interval-seconds="));
const sourceId = sourceArgument?.slice("--source=".length).trim();
const intervalSeconds = Math.max(60, Number(intervalArgument?.slice("--interval-seconds=".length) || 900));

const actor = {
  actorId: process.env.KNOWLEDGE_COLLECTION_ACTOR_ID?.trim() || "v5-knowledge-collection-worker",
  actorRole: process.env.KNOWLEDGE_COLLECTION_ACTOR_ROLE?.trim() || "knowledge_collection_scheduler",
  actorType: "scheduler",
  auditReason: "每日自动完成来源发现、文章采集、归属、归档和知识治理"
};

async function execute() {
  const result = await runKnowledgeCollection({ actor, sourceId, force });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    sourceCount: result.data.sourceCount,
    runs: result.data.runs.map((run) => ({
      runId: run.runId,
      sourceId: run.sourceId,
      status: run.status,
      discoveredCount: run.discoveredCount,
      collectedCount: run.collectedCount,
      updatedCount: run.updatedCount,
      unchangedCount: run.unchangedCount,
      failedCount: run.failedCount
    }))
  })}\n`);
}

do {
  try {
    await execute();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "failed",
      code: "knowledge_collection_worker_failed",
      message: error instanceof Error ? error.message : "每日知识采集失败"
    })}\n`);
    if (!repeat) process.exitCode = 1;
  }
  if (repeat) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
} while (repeat);
