import { retryFailedGeoResearchTaskRecord } from "../src/lib/v5/geo-research-repository.ts";

const [runId, productId, taskType, attemptsText = "1"] = process.argv.slice(2);

if (!runId || !productId || !taskType) {
  throw new Error("Usage: node scripts/retry-geo-research-task.mjs <runId> <productId> <taskType> [additionalAttempts]");
}

const additionalAttempts = Number(attemptsText);
if (!Number.isInteger(additionalAttempts) || additionalAttempts < 1 || additionalAttempts > 3) {
  throw new Error("additionalAttempts must be an integer from 1 to 3");
}

const result = await retryFailedGeoResearchTaskRecord({
  runId,
  productId,
  taskType,
  additionalAttempts,
  actor: {
    actorId: "codex-operator",
    actorRole: "workbench_operator",
    actorType: "human",
    auditReason: "Retry a failed GEO research task after an inspected implementation repair."
  }
});

process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(0);
