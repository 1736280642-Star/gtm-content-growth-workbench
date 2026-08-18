import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { readWorkbenchState } from "../workbench-store";
import type { ChannelKey, DirectPublishPlatformKey } from "../types";
import {
  getV5GovernancePool,
  hasV5GovernanceDatabaseConfig,
  parseV5Json,
  stringifyV5Json,
  withV5GovernanceTransaction,
  V5GovernanceRepositoryError
} from "./knowledge-governance-repository";
import type {
  ContentMonitorMetricKey,
  ContentMonitorMetricValues,
  ContentMonitorFailureAlert,
  ContentMonitorOverview,
  ContentMonitorPlatform,
  ContentMonitorPlatformSync,
  ContentMonitorPublishedItem,
  ContentMonitorSnapshot,
  ContentMonitorSyncResult,
  ContentMonitorTrendPoint
} from "./content-monitor-contracts";
import { getMonthlyWorkspaceReadModel } from "./monthly-workspace-read-model";
import { fetchContentMetricsRunner, getContentMetricsRunnerUrl, isTrustedContentMetricsRunnerUrl } from "../content-metrics-client";

const platforms: ContentMonitorPlatform[] = ["wechat", "csdn", "juejin", "zhihu"];
const metricKeys: ContentMonitorMetricKey[] = ["publications", "views", "likes", "favorites"];

function toIso(value: unknown) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function dateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function startOfShanghaiDay(daysAgo: number) {
  const current = new Date();
  const shanghai = new Date(current.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  shanghai.setHours(0, 0, 0, 0);
  shanghai.setDate(shanghai.getDate() - daysAgo);
  return shanghai;
}

function normalizePlatform(value: string): ContentMonitorPlatform | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "zhihu_toutiao_general" || normalized === "知乎" || normalized.includes("知乎")) return "zhihu";
  if (normalized === "wechat" || normalized === "weixin" || normalized.includes("公众号")) return "wechat";
  if (normalized === "csdn") return "csdn";
  if (normalized === "juejin" || normalized.includes("掘金")) return "juejin";
  return undefined;
}

function finiteMetric(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : undefined;
}

function normalizeMetrics(value: unknown): ContentMonitorMetricValues {
  const record = parseV5Json<Record<string, unknown>>(value, {});
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const metric = finiteMetric(record[key]);
      if (metric !== undefined) return metric;
    }
    return undefined;
  };
  return {
    views: read("views", "reads", "readCount", "阅读量", "浏览量"),
    likes: read("likes", "likeCount", "votes", "点赞数", "赞同数"),
    favorites: read("favorites", "collects", "collections", "favoriteCount", "收藏数")
  };
}

function emptySync(platform: ContentMonitorPlatform): ContentMonitorPlatformSync {
  return { platform, status: "never_synced", message: "尚未收到平台后台数据" };
}

async function readFormalSource(days: number) {
  const pool = getV5GovernancePool();
  const [publicationRows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id AS publish_result_id, r.matrix_item_id, i.title, r.channel, r.public_url,
            r.external_content_id, COALESCE(r.published_at, i.scheduled_at, CAST(i.publish_date AS DATETIME)) AS effective_published_at,
            r.metrics, r.updated_at
       FROM content_publish_result r
       JOIN content_matrix_item i ON i.id = r.matrix_item_id
      WHERE r.status = 'published'
        AND COALESCE(r.published_at, i.scheduled_at, CAST(i.publish_date AS DATETIME)) >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY effective_published_at DESC`,
    [days * 2]
  );

  const content: ContentMonitorPublishedItem[] = publicationRows.flatMap((row) => {
    const platform = normalizePlatform(String(row.channel || ""));
    const publishedAt = toIso(row.effective_published_at);
    if (!platform || !publishedAt) return [];
    const metrics = normalizeMetrics(row.metrics);
    return [{
      publishResultId: String(row.publish_result_id),
      matrixItemId: String(row.matrix_item_id),
      title: String(row.title || "未命名内容"),
      platform,
      publicUrl: row.public_url ? String(row.public_url) : undefined,
      externalContentId: row.external_content_id ? String(row.external_content_id) : undefined,
      publishedAt,
      latestMetrics: metrics,
      latestCapturedAt: Object.values(metrics).some((item) => item !== undefined) ? toIso(row.updated_at) : undefined
    }];
  });

  let snapshots: ContentMonitorSnapshot[] = [];
  let syncs: ContentMonitorPlatformSync[] = platforms.map(emptySync);
  try {
    const [snapshotRows] = await pool.query<RowDataPacket[]>(
      `SELECT s.publish_result_id, s.matrix_item_id, s.platform, s.metric_date, s.captured_at, s.views, s.likes, s.favorites
         FROM content_metric_snapshot s
        WHERE s.captured_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY s.matrix_item_id, s.captured_at`,
      [days * 2]
    );
    snapshots = snapshotRows.flatMap((row) => {
      const platform = normalizePlatform(String(row.platform || ""));
      const capturedAt = toIso(row.captured_at);
      if (!platform || !capturedAt) return [];
      return [{
        publishResultId: row.publish_result_id ? String(row.publish_result_id) : `workspace-${String(row.matrix_item_id)}`,
        platform,
        metricDate: dateKey(row.metric_date instanceof Date ? row.metric_date : String(row.metric_date)),
        capturedAt,
        views: finiteMetric(row.views),
        likes: finiteMetric(row.likes),
        favorites: finiteMetric(row.favorites)
      }];
    });
    const [syncRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.platform, r.status, r.started_at, r.completed_at, r.next_sync_at, r.message
         FROM content_metric_sync_run r
         JOIN (
           SELECT platform, MAX(started_at) AS latest_started_at
             FROM content_metric_sync_run
            GROUP BY platform
         ) latest
           ON latest.platform = r.platform AND latest.latest_started_at = r.started_at`
    );
    const byPlatform = new Map(syncRows.map((row) => [String(row.platform), row]));
    syncs = platforms.map((platform) => {
      const row = byPlatform.get(platform);
      if (!row) return emptySync(platform);
      const rawStatus = String(row.status || "failed");
      return {
        platform,
        status: rawStatus === "completed" ? "ready" : rawStatus === "running" ? "syncing" : rawStatus === "auth_required" ? "auth_required" : "failed",
        lastSyncedAt: toIso(row.completed_at || row.started_at),
        nextSyncAt: toIso(row.next_sync_at),
        message: row.message ? String(row.message) : undefined
      };
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ER_NO_SUCH_TABLE") throw error;
  }

  const latestByContent = new Map<string, ContentMonitorSnapshot>();
  for (const snapshot of snapshots) latestByContent.set(snapshot.publishResultId, snapshot);
  for (const item of content) {
    const latest = latestByContent.get(item.publishResultId);
    if (!latest) continue;
    item.latestMetrics = { views: latest.views, likes: latest.likes, favorites: latest.favorites };
    item.latestCapturedAt = latest.capturedAt;
  }
  return { content, snapshots, syncs };
}

function readLocalSource(days: number) {
  const threshold = startOfShanghaiDay(days * 2 - 1).getTime();
  const content = readWorkbenchState().publishRecords.flatMap((record) => {
    if (!["published", "url_filled"].includes(record.publishStatus) || !record.publishedAt) return [];
    if (new Date(record.publishedAt).getTime() < threshold) return [];
    const platform = normalizePlatform(record.channel);
    if (!platform) return [];
    return [{
      publishResultId: record.id,
      matrixItemId: record.draftId,
      title: record.title,
      platform,
      publicUrl: record.publishedUrl,
      externalContentId: record.platformResults?.[platform as DirectPublishPlatformKey]?.platformArticleId,
      publishedAt: record.publishedAt,
      latestMetrics: normalizeMetrics(record.channelMetrics),
      latestCapturedAt: record.channelMetrics?.importedAt
    } satisfies ContentMonitorPublishedItem];
  });
  const snapshots = content.flatMap((item) => item.latestCapturedAt ? [{
    publishResultId: item.publishResultId,
    platform: item.platform,
    metricDate: dateKey(item.latestCapturedAt),
    capturedAt: item.latestCapturedAt,
    ...item.latestMetrics
  }] : []);
  const syncs = platforms.map((platform) => {
    const lastSyncedAt = content.filter((item) => item.platform === platform).map((item) => item.latestCapturedAt || "").sort().at(-1);
    return lastSyncedAt
      ? { platform, status: "ready", lastSyncedAt, message: "来自现有渠道指标回传" } as ContentMonitorPlatformSync
      : emptySync(platform);
  });
  return { content, snapshots, syncs };
}

function attachLatestSnapshots(content: ContentMonitorPublishedItem[], snapshots: ContentMonitorSnapshot[]) {
  const latestByContent = new Map<string, ContentMonitorSnapshot>();
  for (const snapshot of [...snapshots].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))) {
    latestByContent.set(snapshot.publishResultId, snapshot);
  }
  return content.map((item) => {
    const latest = latestByContent.get(item.publishResultId);
    return latest ? {
      ...item,
      latestMetrics: { views: latest.views, likes: latest.likes, favorites: latest.favorites },
      latestCapturedAt: latest.capturedAt
    } : item;
  });
}

function monthKeysBetween(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

async function readFormalWorkspaceSource(days: number) {
  const threshold = startOfShanghaiDay(days * 2 - 1);
  const months = monthKeysBetween(threshold, new Date());
  const workspaces = await Promise.all(months.map((month) => getMonthlyWorkspaceReadModel(month)));
  const seen = new Set<string>();
  const content = workspaces.flatMap((workspace) => workspace.productionTasks).flatMap((task) => {
    if (seen.has(task.taskId) || task.status !== "published" || !task.publicUrl) return [];
    const platform = normalizePlatform(task.channel);
    const publishedAt = task.scheduledAt || task.updatedAt;
    if (!platform || !publishedAt || new Date(publishedAt) < threshold) return [];
    seen.add(task.taskId);
    return [{
      publishResultId: `workspace-${task.taskId}`,
      matrixItemId: task.taskId,
      title: task.title,
      platform,
      publicUrl: task.publicUrl,
      externalContentId: task.externalContentId,
      publishedAt,
      latestMetrics: {}
    } satisfies ContentMonitorPublishedItem];
  });
  return { content, snapshots: [] as ContentMonitorSnapshot[], syncs: platforms.map(emptySync) };
}

function dateRange(daysAgo: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = startOfShanghaiDay(daysAgo - index);
    return dateKey(date);
  });
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : undefined;
  return Number(((current - previous) / previous).toFixed(4));
}

function createTrend(content: ContentMonitorPublishedItem[], snapshots: ContentMonitorSnapshot[], rangeDays: number) {
  const dates = dateRange(rangeDays - 1, rangeDays);
  const points = new Map<string, ContentMonitorTrendPoint>();
  for (const date of dates) {
    points.set(date, {
      date,
      totals: { publications: 0, views: 0, likes: 0, favorites: 0 },
      platforms: Object.fromEntries(platforms.map((platform) => [platform, { publications: 0, views: 0, likes: 0, favorites: 0 }])) as ContentMonitorTrendPoint["platforms"]
    });
  }
  for (const item of content) {
    const point = points.get(dateKey(item.publishedAt));
    if (!point) continue;
    point.totals.publications += 1;
    point.platforms[item.platform].publications += 1;
  }
  const previousByContent = new Map<string, ContentMonitorMetricValues>();
  for (const snapshot of [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    const previous = previousByContent.get(snapshot.publishResultId) || {};
    const point = points.get(snapshot.metricDate);
    if (point) {
      for (const key of ["views", "likes", "favorites"] as const) {
        const current = snapshot[key];
        if (current === undefined) continue;
        const delta = Math.max(0, current - (previous[key] || 0));
        point.totals[key] += delta;
        point.platforms[snapshot.platform][key] += delta;
      }
    }
    previousByContent.set(snapshot.publishResultId, snapshot);
  }
  return dates.map((date) => points.get(date)!);
}

function summarize(
  content: ContentMonitorPublishedItem[],
  sourceSnapshots: ContentMonitorSnapshot[],
  syncs: ContentMonitorPlatformSync[],
  rangeDays: number,
  source: ContentMonitorOverview["source"],
  message?: string
): ContentMonitorOverview {
  const start = startOfShanghaiDay(rangeDays - 1);
  const previousStart = startOfShanghaiDay(rangeDays * 2 - 1);
  const currentContent = content.filter((item) => new Date(item.publishedAt) >= start);
  const previousContent = content.filter((item) => new Date(item.publishedAt) >= previousStart && new Date(item.publishedAt) < start);
  const latest = (items: ContentMonitorPublishedItem[], key: keyof ContentMonitorMetricValues) => items.reduce((sum, item) => sum + (item.latestMetrics[key] || 0), 0);
  const covered = (items: ContentMonitorPublishedItem[], key: keyof ContentMonitorMetricValues) => items.filter((item) => item.latestMetrics[key] !== undefined).length;
  const snapshots = sourceSnapshots.length ? sourceSnapshots : content.flatMap((item) => item.latestCapturedAt ? [{
    publishResultId: item.publishResultId,
    platform: item.platform,
    metricDate: dateKey(item.latestCapturedAt),
    capturedAt: item.latestCapturedAt,
    ...item.latestMetrics
  }] : []);
  const summaries = Object.fromEntries(metricKeys.map((key) => {
    const value = key === "publications" ? currentContent.length : latest(currentContent, key);
    const previousValue = key === "publications" ? previousContent.length : latest(previousContent, key);
    return [key, {
      key,
      value,
      previousValue,
      changeRate: percentageChange(value, previousValue),
      coveredContent: key === "publications" ? currentContent.length : covered(currentContent, key),
      totalContent: currentContent.length
    }];
  })) as ContentMonitorOverview["metrics"];
  const latestCapturedAt = currentContent.map((item) => item.latestCapturedAt || "").sort().at(-1);
  return {
    rangeDays,
    rangeStart: dateKey(start),
    rangeEnd: dateKey(new Date()),
    previousRangeStart: dateKey(previousStart),
    dataAsOf: latestCapturedAt || new Date().toISOString(),
    source,
    metrics: summaries,
    trend: createTrend(currentContent, snapshots, rangeDays),
    platforms: platforms.map((platform) => {
      const items = currentContent.filter((item) => item.platform === platform);
      return {
        platform,
        publications: items.length,
        views: latest(items, "views"),
        likes: latest(items, "likes"),
        favorites: latest(items, "favorites"),
        coveredContent: items.filter((item) => Object.values(item.latestMetrics).some((metric) => metric !== undefined)).length,
        sync: syncs.find((item) => item.platform === platform) || emptySync(platform)
      };
    }),
    content: currentContent,
    message
  };
}

export async function getContentMonitorOverview(rangeDays = 30, selectedPlatforms: ContentMonitorPlatform[] = platforms): Promise<ContentMonitorOverview> {
  const days = Math.min(90, Math.max(7, Math.trunc(rangeDays || 30)));
  const selected = new Set(selectedPlatforms.length ? selectedPlatforms : platforms);
  const summarizeSelected = (
    content: ContentMonitorPublishedItem[],
    snapshots: ContentMonitorSnapshot[],
    syncs: ContentMonitorPlatformSync[],
    source: ContentMonitorOverview["source"],
    message?: string
  ) => summarize(content.filter((item) => selected.has(item.platform)), snapshots.filter((item) => selected.has(item.platform)), syncs, days, source, message);
  if (!hasV5GovernanceDatabaseConfig()) {
    const local = readLocalSource(days);
    return summarizeSelected(local.content, local.snapshots, local.syncs, "local_adapter", "正式数据库未配置，当前展示已有发布记录与渠道回传数据。");
  }
  const formal = await readFormalSource(days);
  if (!formal.content.length) {
    const workspace = await readFormalWorkspaceSource(days);
    if (workspace.content.length) {
      const message = formal.snapshots.length
        ? "发布数来自正式月度工作区；渠道指标来自平台后台回传。"
        : "发布数来自正式月度工作区；渠道指标尚待平台后台回传。";
      return summarizeSelected(attachLatestSnapshots(workspace.content, formal.snapshots), formal.snapshots, formal.syncs, "formal_workspace", message);
    }
  }
  return summarizeSelected(formal.content, formal.snapshots, formal.syncs, "formal_database");
}

export function getContentMonitorFailureAlerts(): ContentMonitorFailureAlert[] {
  const state = readWorkbenchState();
  const drafts = new Map(state.drafts.map((item) => [item.id, item]));
  const records = new Map(state.publishRecords.map((item) => [item.id, item]));
  const alerts: ContentMonitorFailureAlert[] = [];
  for (const schedule of state.publishSchedules) {
    const platform = normalizePlatform(schedule.platform);
    if (!platform) continue;
    const record = schedule.publishRecordId ? records.get(schedule.publishRecordId) : undefined;
    const title = record?.title || drafts.get(schedule.draftId)?.title || "未命名内容";
    if (schedule.status === "failed" && schedule.retryCount < 3) alerts.push({
      id: schedule.id, kind: "publish_retry" as const, title, platform,
      occurredAt: schedule.updatedAt || schedule.createdAt,
      reason: schedule.failureReason || "自动发布失败，系统正在等待下一次重试。",
      nextAction: schedule.nextAction || "系统自动重试，无需人工处理。",
      retryCount: schedule.retryCount, publicUrl: schedule.publicUrl
    });
    if (schedule.status === "removed_after_publish") alerts.push({
      id: schedule.id, kind: "removed_after_publish" as const, title, platform,
      occurredAt: schedule.removedAt || schedule.lastVerifiedAt || schedule.updatedAt || schedule.createdAt,
      reason: schedule.failureReason || "发布后 24h/72h 回测发现内容已被平台删除或不可见。",
      nextAction: schedule.nextAction || "检查平台原因并决定是否重新发布。",
      retryCount: schedule.retryCount, publicUrl: schedule.publicUrl
    });
  }
  const deduplicated = new Map<string, ContentMonitorFailureAlert>();
  for (const alert of alerts.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    const key = `${alert.kind}:${alert.platform}:${alert.title}`;
    if (!deduplicated.has(key)) deduplicated.set(key, alert);
  }
  return [...deduplicated.values()];
}

export async function syncContentMonitorMetrics(platform?: ContentMonitorPlatform | ContentMonitorPlatform[]): Promise<ContentMonitorSyncResult> {
  const runnerUrl = getContentMetricsRunnerUrl();
  const token = (process.env.CONTENT_METRICS_RUNNER_TOKEN || "").trim();
  if (!runnerUrl || !token) {
    return { accepted: false, status: "pending_config", syncedPlatforms: [], capturedItems: 0, message: "指标采集器尚未配置，现有 CSV 与手工回传仍可继续使用。" };
  }
  if (!isTrustedContentMetricsRunnerUrl(runnerUrl)) throw new V5GovernanceRepositoryError("metrics_runner_must_be_private", "指标采集器必须使用本机地址或 Docker 私有服务名。", 422);
  const overview = await getContentMonitorOverview(30);
  const selected = Array.isArray(platform) ? platform : platform ? [platform] : platforms;
  const targets = overview.content.filter((item) => selected.includes(item.platform));
  try {
    const response = await fetchContentMetricsRunner("/metrics/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platforms: selected, targets }),
      signal: AbortSignal.timeout(90_000)
    });
    const payload = await response.json().catch(() => ({})) as ContentMonitorSyncResult & {
      message?: string;
      items?: Array<ContentMonitorMetricValues & {
        publishResultId: string;
        platform: ContentMonitorPlatform;
        capturedAt?: string;
        source?: string;
        rawDataHash?: string;
      }>;
    };
    if (!response.ok) return { accepted: false, status: "failed", syncedPlatforms: [], capturedItems: 0, message: payload.message || `指标采集器返回 HTTP ${response.status}。` };
    const allowedIds = new Set(targets.map((item) => item.publishResultId));
    const capturedItems = (payload.items || []).filter((item) => allowedIds.has(item.publishResultId) && selected.includes(item.platform));
    if (capturedItems.length && hasV5GovernanceDatabaseConfig()) {
      const capturedAt = new Date();
      await withV5GovernanceTransaction(async (connection) => {
        const syncRunIds = new Map<ContentMonitorPlatform, string>();
        for (const selectedPlatform of selected) {
          const syncRunId = `metric-sync-${randomUUID()}`;
          const platformTargets = targets.filter((item) => item.platform === selectedPlatform);
          const platformCapturedItems = capturedItems.filter((item) => item.platform === selectedPlatform);
          await connection.query(
            `INSERT INTO content_metric_sync_run
              (id, platform, status, scanned_count, captured_count, failed_count, message, started_at, completed_at, next_sync_at)
             VALUES (?, ?, 'completed', ?, ?, 0, ?, ?, ?, DATE_ADD(?, INTERVAL 6 HOUR))`,
            [syncRunId, selectedPlatform, platformTargets.length, platformCapturedItems.length, payload.message || "平台指标更新完成。", capturedAt, capturedAt, capturedAt]
          );
          syncRunIds.set(selectedPlatform, syncRunId);
        }
        for (const item of capturedItems) {
          const target = targets.find((candidate) => candidate.publishResultId === item.publishResultId)!;
          const itemCapturedAt = item.capturedAt && !Number.isNaN(new Date(item.capturedAt).getTime()) ? new Date(item.capturedAt) : capturedAt;
          const normalized = normalizeMetrics(item);
          const rawDataHash = item.rawDataHash || createHash("sha256").update(JSON.stringify(item)).digest("hex");
          await connection.query(
            `INSERT INTO content_metric_snapshot
              (id, publish_result_id, matrix_item_id, sync_run_id, platform, metric_date, captured_at,
               views, likes, favorites, source, confidence, raw_data_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'real', ?)`,
            [
              `metric-${randomUUID()}`,
              item.publishResultId.startsWith("workspace-") ? null : item.publishResultId,
              target.matrixItemId,
              syncRunIds.get(item.platform),
              item.platform,
              dateKey(itemCapturedAt),
              itemCapturedAt,
              normalized.views ?? null,
              normalized.likes ?? null,
              normalized.favorites ?? null,
              item.source || "platform_backend",
              rawDataHash
            ]
          );
          if (!item.publishResultId.startsWith("workspace-")) {
            const [rows] = await connection.query<RowDataPacket[]>("SELECT metrics FROM content_publish_result WHERE id = ? FOR UPDATE", [item.publishResultId]);
            const current = parseV5Json<Record<string, unknown>>(rows[0]?.metrics, {});
            await connection.query(
              "UPDATE content_publish_result SET metrics = ?, version = version + 1 WHERE id = ?",
              [stringifyV5Json({ ...current, ...normalized, importedAt: itemCapturedAt.toISOString(), source: item.source || "platform_backend" }), item.publishResultId]
            );
          }
        }
      });
    }
    return {
      accepted: payload.accepted !== false,
      status: payload.status || "completed",
      syncedPlatforms: payload.syncedPlatforms || selected,
      capturedItems: capturedItems.length || Number(payload.capturedItems || 0),
      message: payload.message || "平台数据更新完成。"
    };
  } catch (error) {
    return { accepted: false, status: "failed", syncedPlatforms: [], capturedItems: 0, message: error instanceof Error ? error.message : "指标采集器不可达。" };
  }
}
