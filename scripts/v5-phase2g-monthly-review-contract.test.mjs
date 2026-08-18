import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveFormalPublishLivenessStatus } from "../src/lib/v5/observation-reference-adapter";

test("formal MonthlyReview reads only published results and freezes proposal evidence refs", async () => {
  const repository = await readFile("src/lib/v5/monthly-execution-repository.ts", "utf8");
  const service = await readFile("src/lib/v5/monthly-review-service.ts", "utf8");
  assert.match(repository, /WHERE r\.status = 'published'/);
  assert.match(service, /FORMAL_PUBLISHED_EVIDENCE_REQUIRED/);
  assert.match(service, /published_content:/);
  assert.match(service, /geo_capture_task:/);
  assert.match(service, /geo_retest_link:/);
  assert.match(service, /confirmed_gap:/);
  assert.match(service, /publish_liveness_24h:/);
  assert.match(service, /publish_liveness_72h:/);
  assert.match(service, /FORMAL_LIVENESS_EVIDENCE_PENDING/);
  assert.match(service, /hasMetricReturn === true/);
  assert.match(service, /listApprovedGeoMonitoringQuestions/);
  assert.match(service, /lastRetestedAt/);
  assert.match(service, /geoMonitoringApproved/);
});

test("formal publish observation distinguishes pending, survived and removed-before-threshold", () => {
  const first = "2026-08-01T00:00:00.000Z";
  assert.equal(resolveFormalPublishLivenessStatus(first, "2026-08-01T23:00:00.000Z", undefined, 24), "pending");
  assert.equal(resolveFormalPublishLivenessStatus(first, "2026-08-02T00:00:00.000Z", undefined, 24), "passed");
  assert.equal(resolveFormalPublishLivenessStatus(first, "2026-08-04T00:00:00.000Z", undefined, 72), "passed");
  assert.equal(resolveFormalPublishLivenessStatus(first, "2026-08-01T12:00:00.000Z", "2026-08-01T12:00:00.000Z", 24), "failed");
  assert.equal(resolveFormalPublishLivenessStatus(first, "2026-08-04T00:00:00.000Z", "2026-08-04T00:00:00.000Z", 72), "passed");
});

test("publish lifecycle backfill preserves formal publication after later removal", async () => {
  const [backfill, repository, migration] = await Promise.all([
    readFile("src/lib/publish-job-backfill.ts", "utf8"),
    readFile("src/lib/v5/monthly-execution-repository.ts", "utf8"),
    readFile("database/migrations/20260812_028_v5_publish_observation_lifecycle.sql", "utf8")
  ]);
  assert.match(backfill, /removed_after_publish.*return "published"/s);
  assert.match(backfill, /firstPublicObservedAt: schedule\.firstPublicObservedAt/);
  assert.match(repository, /publish_schedule_id/);
  assert.match(repository, /first_public_observed_at/);
  assert.match(repository, /stable_published_at/);
  assert.match(repository, /removed_at/);
  assert.match(migration, /idx_content_publish_result_liveness/);
});

test("the content monitor exposes monthly evidence without surfacing liveness as a KPI", async () => {
  const [monitor, visibility] = await Promise.all([
    readFile("src/app/geo-monitor/page.tsx", "utf8"),
    readFile("src/components/ContentMonitorAiVisibility.tsx", "utf8")
  ]);
  assert.match(monitor, /review: "ai"/);
  assert.doesNotMatch(monitor, /24h 存活|72h 存活/);
  assert.match(visibility, /产品下批优化方案/);
  assert.match(visibility, /不自动改 MonthlyPlan 配额/);
  assert.match(visibility, /只表达相关性/);
  assert.match(visibility, /item\.geoMonitoringApproved/);
});
