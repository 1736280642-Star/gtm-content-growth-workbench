import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { boundedInteger, mapWithConcurrency } from "../workers/worker-utils.mjs";
import { selectWorkbenchOneoffs } from "./lib/oneoff-container-policy.mjs";

test("formal worker concurrency stays bounded and preserves result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8]);
  assert.equal(maximumActive, 2);
  assert.equal(boundedInteger("9", 1, 1, 3), 3);
});

test("one-off cleanup defaults to old web containers in the current workspace", () => {
  const labels = "com.docker.compose.oneoff=True,com.docker.compose.service=workbench-web,com.docker.compose.project.working_dir=D:\\GTM\\工作台-main-v5";
  const workerLabels = labels.replace("workbench-web", "content-worker");
  const rows = [
    { ID: "web-old", Labels: labels, ageMinutes: 120 },
    { ID: "web-new", Labels: labels, ageMinutes: 5 },
    { ID: "worker-old", Labels: workerLabels, ageMinutes: 120 }
  ];
  assert.deepEqual(selectWorkbenchOneoffs(rows, { workingDirectory: "D:\\GTM\\工作台-main-v5", includeWorkers: false, minimumAgeMinutes: 60 }).map((row) => row.ID), ["web-old"]);
  assert.deepEqual(selectWorkbenchOneoffs(rows, { workingDirectory: "D:\\GTM\\工作台-main-v5", includeWorkers: true, minimumAgeMinutes: 60 }).map((row) => row.ID), ["web-old", "worker-old"]);
});

test("formal generation runtime owns bounded calls, database time and orphan reconciliation", async () => {
  const [providerSource, generationSource, repositorySource, workerSource] = await Promise.all([
    readFile(new URL("../src/lib/ai-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/formal-generation-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/single-article-production-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/content-production-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.match(providerSource, /metrics:\s*\{/);
  assert.match(generationSource, /AI_PROVIDER_FORMAL_DEADLINE_MS/);
  assert.match(generationSource, /AI_PROVIDER_FORMAL_MAX_CALLS/);
  assert.match(repositorySource, /orphaned_generation_run_reconciled/);
  assert.match(repositorySource, /FALSE, NOW\(\)/);
  assert.match(workerSource, /V5_CONTENT_WORKER_CONCURRENCY/);
});
