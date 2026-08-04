import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("publishing control tower uses durable dispatch and reconciliation handles", async () => {
  const page = await read("src/app/publishing/page.tsx");
  assert.match(page, /\/api\/publish-jobs/);
  assert.match(page, /reconcile-dispatch/);
  assert.match(page, /\/api\/publish-reliability/);
  assert.doesNotMatch(page, /\/run["`]/, "the browser must not directly execute a publish job");
  assert.match(page, /24h/);
  assert.match(page, /72h/);
});

test("monthly execution creates a Publish Job from the approved formal draft", async () => {
  const page = await read("src/app/daily-execution/page.tsx");
  const route = await read("src/app/api/v5/content-tasks/[taskId]/publish-job/route.ts");
  assert.match(page, /\/publish-job/);
  assert.match(route, /readFormalDraftVersion/);
  assert.match(route, /hardRuleResult\.passed/);
  assert.match(route, /dispatchPublishJob/);
});

test("free production dispatches through Publish Job instead of direct platform execution", async () => {
  const service = await read("src/lib/v5/free-production-service.ts");
  assert.match(service, /createPublishJobFromApprovedContent/);
  assert.match(service, /dispatchPublishJob/);
  assert.doesNotMatch(service, /submitFormalPublish/);
});

test("reconciled lifecycle backfills both V5 monthly and free-production results", async () => {
  const service = await read("src/lib/publish-job-backfill.ts");
  assert.match(service, /backfillFormalPublishJobResult/);
  assert.match(service, /updateFreeProductionState/);
  assert.match(service, /public_observed/);
  assert.match(service, /stable_published/);
  assert.match(service, /removed_after_publish/);
});
