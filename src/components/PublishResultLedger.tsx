"use client";

import { ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Space, Spin, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule, PublishScheduleStatus } from "@/lib/types";
import { PublishLifecycleRail } from "./PublishLifecycleRail";

interface PublishJobView { schedule: PublishSchedule; attempts: PublishAttempt[] }
interface ReliabilityMetric {
  platform: DirectPublishPlatformKey;
  submitted: number;
  publicObserved: number;
  stablePublished: number;
  survival24hRate: number | null;
  survival72hRate: number | null;
}
interface ReliabilityPayload {
  metrics: ReliabilityMetric[];
  readiness: Array<{ platform: DirectPublishPlatformKey; ready: boolean; blockers: string[] }>;
  rolloutReady: boolean;
}

const platformLabel: Record<DirectPublishPlatformKey, string> = { wechat: "公众号", csdn: "CSDN", juejin: "掘金", zhihu: "知乎" };
const statusLabel: Record<PublishScheduleStatus, string> = {
  scheduled: "等待 Worker", precheck_failed: "预检未通过", publishing: "Worker 执行中", published_verified: "发布已确认",
  published_pending_url: "等待 URL", pending_verify: "等待公开核验", public_observed: "已公开", stable_published: "72h 稳定",
  platform_rejected: "平台拒绝", removed_after_publish: "发布后删除", risk_blocked: "风控阻断", verification_timeout: "核验超时",
  auth_expired: "登录失效", failed: "失败", manual_takeover_required: "需处理", pending_config: "待配置"
};
const dangerStatuses = new Set<PublishScheduleStatus>(["precheck_failed", "platform_rejected", "removed_after_publish", "risk_blocked", "verification_timeout", "auth_expired", "failed", "manual_takeover_required", "pending_config"]);
const reconcilable = new Set<PublishScheduleStatus>(["published_verified", "published_pending_url", "pending_verify", "public_observed", "stable_published", "manual_takeover_required", "risk_blocked", "auth_expired"]);

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(body?.message || body?.error?.message || `请求失败 (${response.status})`);
  return body as T;
}

function timeText(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function observedStatus(schedule: PublishSchedule) {
  if (dangerStatuses.has(schedule.status)) return { label: statusLabel[schedule.status], color: "red" };
  if (schedule.status === "stable_published" || schedule.stablePublishedAt) return { label: "72h 稳定", color: "green" };
  if (schedule.firstPublicObservedAt) {
    const age = Date.now() - Date.parse(schedule.firstPublicObservedAt);
    return age >= 24 * 3_600_000
      ? { label: "24h 存活", color: "cyan" }
      : { label: "已公开", color: "cyan" };
  }
  if (schedule.publicUrl) return { label: "URL 已回填", color: "blue" };
  return { label: statusLabel[schedule.status], color: "blue" };
}

export function PublishResultLedger({ matchedPublishRecordIds }: { matchedPublishRecordIds: Set<string> }) {
  const [messageApi, messageContext] = message.useMessage();
  const [jobs, setJobs] = useState<PublishJobView[]>([]);
  const [reliability, setReliability] = useState<ReliabilityPayload>();
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [jobBody, reliabilityBody] = await Promise.all([
        readJson<{ jobs: PublishJobView[] }>("/api/publish-jobs"),
        readJson<ReliabilityPayload>("/api/publish-reliability")
      ]);
      setJobs(jobBody.jobs.sort((a, b) => (b.schedule.updatedAt || b.schedule.createdAt).localeCompare(a.schedule.updatedAt || a.schedule.createdAt)));
      setReliability(reliabilityBody);
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "自动发布结果读取失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function reconcile(schedule: PublishSchedule) {
    setActing(schedule.id);
    try {
      await readJson(`/api/publish-jobs/${encodeURIComponent(schedule.id)}/reconcile-dispatch`, { method: "POST" });
      messageApi.success("只读 reconciliation 已排队，结果会自动回填。");
      await refresh(true);
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "核验排队失败");
    } finally {
      setActing(undefined);
    }
  }

  const summary = useMemo(() => ({
    total: jobs.length,
    urls: jobs.filter((item) => Boolean(item.schedule.publicUrl)).length,
    stable: jobs.filter((item) => item.schedule.status === "stable_published").length,
    exceptions: jobs.filter((item) => dangerStatuses.has(item.schedule.status)).length
  }), [jobs]);

  return (
    <Card
      className="publish-jobs-card publish-result-ledger"
      title={<span>发布结果账本 <Typography.Text type="secondary">Publish Job → URL → 存活 → 指标</Typography.Text></span>}
      extra={<Space><Tag color={reliability?.rolloutReady ? "green" : "gold"}>{reliability?.rolloutReady ? "Reliability 已达标" : "Reliability 验收中"}</Tag><Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button></Space>}
    >
      {messageContext}
      {error ? <Alert showIcon type="error" message="自动发布数据同步失败" description={error} style={{ marginBottom: 14 }} /> : null}
      <div className="publish-ledger-summary">
        <span><b>{summary.total}</b> Publish Jobs</span>
        <span><b>{summary.urls}</b> URL 已回填</span>
        <span><b>{summary.stable}</b> 72h 稳定</span>
        <span className={summary.exceptions ? "is-risk" : ""}><b>{summary.exceptions}</b> 异常</span>
      </div>
      <div className="publish-ledger-readiness">
        {(reliability?.metrics || []).filter((item) => item.platform !== "wechat").map((metric) => {
          const ready = reliability?.readiness.find((item) => item.platform === metric.platform)?.ready;
          return <Tag key={metric.platform} color={ready ? "green" : "default"}>{platformLabel[metric.platform]} · 24h {metric.survival24hRate == null ? "待样本" : `${Math.round(metric.survival24hRate * 100)}%`} · 72h {metric.survival72hRate == null ? "待样本" : `${Math.round(metric.survival72hRate * 100)}%`}</Tag>;
        })}
      </div>
      {loading && !jobs.length ? <div className="v5-loading-row"><Spin /><span>正在同步发布结果</span></div> : !jobs.length ? <Empty description="暂无 Publish Job；发布控制台创建的任务会自动出现在这里。" /> : (
        <div className="publish-job-list">
          {jobs.map(({ schedule }) => {
            const matched = Boolean(schedule.publishRecordId && matchedPublishRecordIds.has(schedule.publishRecordId));
            const observed = observedStatus(schedule);
            return (
              <article className="publish-job" key={schedule.id}>
                <div className="publish-job-head">
                  <div>
                    <Space wrap>
                      <Tag>{platformLabel[schedule.platform]}</Tag>
                      <Tag color={observed.color}>{observed.label}</Tag>
                      <Tag color={matched ? "green" : schedule.publicUrl ? "gold" : "default"}>{matched ? "渠道指标已匹配" : schedule.publicUrl ? "待导入渠道指标" : "等待公开 URL"}</Tag>
                    </Space>
                    <Typography.Text strong>{schedule.id}</Typography.Text>
                  </div>
                  {reconcilable.has(schedule.status) ? <Button size="small" icon={<SyncOutlined />} loading={acting === schedule.id} onClick={() => void reconcile(schedule)}>只读核验</Button> : null}
                </div>
                <PublishLifecycleRail schedule={schedule} />
                <div className="publish-job-meta">
                  <span><b>PUBLIC URL</b>{schedule.publicUrl ? <a href={schedule.publicUrl} target="_blank" rel="noreferrer">{schedule.publicUrl}</a> : "等待自动回填"}</span>
                  <span><b>首次公开</b>{timeText(schedule.firstPublicObservedAt)}</span>
                  <span><b>最近核验</b>{timeText(schedule.lastVerifiedAt)}</span>
                  <span><b>下次核验</b>{timeText(schedule.nextVerificationAt)}</span>
                </div>
                {schedule.failureReason || schedule.nextAction ? <Alert showIcon type="warning" message={schedule.failureReason || "需要处理"} description={schedule.nextAction} /> : null}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
