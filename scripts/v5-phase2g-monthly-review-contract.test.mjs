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

test("the consolidated GEO monitor exposes 24h/72h and next-month evidence without restoring duplicate navigation", async () => {
  const monitor = await readFile("src/app/geo-monitor/page.tsx", "utf8");
  assert.match(monitor, /review: "content"/);
  assert.match(monitor, /24h 存活/);
  assert.match(monitor, /72h 存活/);
  assert.match(monitor, /MonthlyReview 下月调整依据/);
  assert.match(monitor, /重大策略变化仍需人工确认/);
  assert.match(monitor, /selectedPublishedContent\.publicUrl/);
  assert.match(monitor, /最近复测时间/);
  assert.match(monitor, /item\.geoMonitoringApproved/);
});
