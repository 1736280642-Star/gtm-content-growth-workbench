import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("formal capture uses MySQL as the single task and evidence source", async () => {
  const [migration, repository, taskRoute, review] = await Promise.all([
    read("database/migrations/20260813_029_v5_capture_single_source.sql"),
    read("src/lib/v5/capture-repository.ts"),
    read("src/app/api/v5/frontend-capture/tasks/route.ts"),
    read("src/lib/v5/monthly-review-service.ts")
  ]);
  assert.match(migration, /published_content_id/);
  assert.match(migration, /capture_gap_reviews/);
  assert.match(repository, /listFormalCaptureObservations/);
  assert.match(taskRoute, /listFormalCaptureObservations/);
  assert.match(review, /reference\.source === "formal_adapter"/);
  assert.match(review, /listFormalCaptureObservations/);
});

test("formal publication creates idempotent published-content retests", async () => {
  const [execution, automation, repository] = await Promise.all([
    read("src/lib/v5/monthly-execution-repository.ts"),
    read("src/lib/v5/product-automation-service.ts"),
    read("src/lib/v5/capture-repository.ts")
  ]);
  assert.match(execution, /createPublishedContentRetestTasks/);
  assert.match(repository, /published-retest:/);
  assert.match(repository, /published_content_retest/);
  assert.doesNotMatch(automation, /auto-retest:/);
});

test("local runner leases MySQL tasks and uploads normalized evidence", async () => {
  const runner = await read("capture-runner/src/server.mjs");
  assert.match(runner, /api\/v5\/capture-tasks/);
  assert.match(runner, /\/lease/);
  assert.match(runner, /frontend-capture-evidence\.v1/);
  assert.match(runner, /api\/v5\/capture-evidence/);
  assert.match(runner, /item\.status === "leased" && item\.deviceId === DEVICE_ID/);
  assert.match(runner, /request\.method === "POST" && url\.pathname === "\/tasks\/next"/);
  assert.doesNotMatch(runner, /frontend-capture\/tasks\/.*\/artifact/);
});

test("browser capture scope includes Doubao, DeepSeek, Qwen, and ChatGPT", async () => {
  const [manifest, serviceWorker, contracts] = await Promise.all([
    read("browser-extension/manifest.json"), read("browser-extension/src/service-worker.js"), read("src/lib/v5/observation-contracts.ts")
  ]);
  for (const platform of ["doubao", "deepseek", "qwen", "chatgpt"]) {
    assert.match(serviceWorker, new RegExp(platform));
    assert.match(contracts, new RegExp(platform));
  }
  assert.match(manifest, /https:\/\/chatgpt\.com\/\*/i);
  assert.match(manifest, /"scripting"/i);
  assert.match(contracts, /"chatgpt"/i);
  assert.match(serviceWorker, /chrome\.scripting\.executeScript/);
  assert.match(serviceWorker, /chrome\.tabs\.create/);
  assert.match(serviceWorker, /newConversationUrl/);
  assert.doesNotMatch(serviceWorker, /tabs\.find\(\(item\) => item\.active\) \|\| tabs\[0\]/);
});

test("browser capture rejects restored conversations before prompt submission", async () => {
  const adapter = await read("browser-extension/src/adapters/china-ai.js");
  assert.match(adapter, /if \(latestAnswer\(\)\)/);
  assert.match(adapter, /上下文污染/);
  assert.match(adapter, /waitUntilReady/);
});
