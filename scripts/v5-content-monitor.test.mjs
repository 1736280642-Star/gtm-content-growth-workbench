import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("content monitor keeps append-only daily snapshots separate from publish results", async () => {
  const migration = await read("database/migrations/20260814_030_v5_content_metric_snapshots.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS content_metric_snapshot/);
  assert.match(migration, /publish_result_id VARCHAR\(64\) NULL/);
  assert.match(migration, /matrix_item_id VARCHAR\(64\) NOT NULL/);
  assert.match(migration, /metric_date DATE NOT NULL/);
  assert.match(migration, /captured_at DATETIME NOT NULL/);
  assert.match(migration, /idx_content_metric_result_time/);
  assert.doesNotMatch(migration, /UNIQUE KEY[^\n]*publish_result_id/);
});

test("content monitor reads the formal publish chain and fails closed to a local runner", async () => {
  const service = await read("src/lib/v5/content-monitor-service.ts");
  assert.match(service, /content_publish_result/);
  assert.match(service, /external_content_id/);
  assert.match(service, /getMonthlyWorkspaceReadModel/);
  assert.match(service, /getContentMetricsRunnerUrl/);
  assert.match(service, /isTrustedContentMetricsRunnerUrl/);
  assert.match(service, /\/metrics\/pull/);
  assert.match(service, /content_metric_snapshot/);
  assert.match(service, /item\.publishResultId\.startsWith\("workspace-"\) \? null/);
  assert.match(service, /new Map<ContentMonitorPlatform, string>/);
  assert.match(service, /attachLatestSnapshots\(workspace\.content, formal\.snapshots\)/);
  assert.match(service, /Math\.max\(0, current - \(previous\[key\] \|\| 0\)\)/);
});

test("overview exposes the four required metrics without mixing metric scales", async () => {
  const page = await read("src/app/geo-monitor/page.tsx");
  for (const label of ["发布数", "浏览量", "点赞数", "收藏数", "近30天内容表现", "渠道表现"]) {
    assert.match(page, new RegExp(label));
  }
  for (const platform of ["公众号", "CSDN", "掘金", "知乎"]) {
    assert.match(page, new RegExp(platform));
  }
  assert.match(page, /setMetric\(key\)/);
  assert.match(page, /visiblePlatforms/);
  assert.match(page, /每日新增/);
  assert.match(page, /累计/);
});

test("content monitor applies global channel filters and strict failure alerts", async () => {
  const [page, service, alertRoute] = await Promise.all([
    read("src/app/geo-monitor/page.tsx"), read("src/lib/v5/content-monitor-service.ts"), read("src/app/api/v5/content-monitor/alerts/route.ts")
  ]);
  assert.match(page, /内容监控塔/);
  assert.match(page, /内容渠道全局筛选/);
  assert.match(page, /Top 5 内容/);
  assert.match(page, /仅展示近 30 天已正式发布内容/);
  assert.doesNotMatch(page, /产品投入|24h 存活|72h 存活/);
  assert.match(service, /selectedPlatforms/);
  assert.match(service, /schedule\.status === "failed" && schedule\.retryCount < 3/);
  assert.match(service, /schedule\.status === "removed_after_publish"/);
  assert.match(service, /deduplicated/);
  assert.match(alertRoute, /getContentMonitorFailureAlerts/);
});

test("content monitor APIs are no-store and expose explicit sync status", async () => {
  const [overviewRoute, syncRoute] = await Promise.all([
    read("src/app/api/v5/content-monitor/overview/route.ts"),
    read("src/app/api/v5/content-monitor/sync/route.ts")
  ]);
  assert.match(overviewRoute, /cache-control.*no-store/);
  assert.match(overviewRoute, /getContentMonitorOverview/);
  assert.match(syncRoute, /syncContentMonitorMetrics/);
  assert.match(syncRoute, /pending_config|status/);
});
