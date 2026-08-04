"use client";

import { ReloadOutlined, RocketOutlined, SafetyCertificateOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Progress, Row, Select, Space, Spin, Statistic, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PublishLifecycleRail } from "@/components/PublishLifecycleRail";
import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule, PublishScheduleStatus } from "@/lib/types";

interface PublishJobView { schedule: PublishSchedule; attempts: PublishAttempt[] }
interface PublishCandidate { id: string; title: string; channel: string; version: number; updatedAt?: string; existingPlatforms: DirectPublishPlatformKey[] }
interface ReliabilityMetric {
  platform: DirectPublishPlatformKey; submitted: number; publicObserved: number; stablePublished: number;
  removedAfterPublish: number; submissionAcceptanceRate: number | null; publicConversionRate: number | null;
  survival24hRate: number | null; survival72hRate: number | null; averageUrlBackfillLatencyMinutes: number | null;
}
interface ReliabilityPayload {
  generatedAt: string; metrics: ReliabilityMetric[]; readiness: Array<{ platform: DirectPublishPlatformKey; ready: boolean; blockers: string[] }>;
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

function rateText(value: number | null) { return value === null ? "待样本" : `${Math.round(value * 100)}%`; }

export default function PublishingPage() {
  const [messageApi, messageContext] = message.useMessage();
  const [jobs, setJobs] = useState<PublishJobView[]>([]);
  const [candidates, setCandidates] = useState<PublishCandidate[]>([]);
  const [reliability, setReliability] = useState<ReliabilityPayload>();
  const [candidateId, setCandidateId] = useState<string>();
  const [platforms, setPlatforms] = useState<DirectPublishPlatformKey[]>(["csdn", "juejin", "zhihu"]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [jobBody, candidateBody, reliabilityBody] = await Promise.all([
        readJson<{ jobs: PublishJobView[] }>("/api/publish-jobs"),
        readJson<{ candidates: PublishCandidate[] }>("/api/publish-jobs/candidates"),
        readJson<ReliabilityPayload>("/api/publish-reliability")
      ]);
      setJobs(jobBody.jobs.sort((a, b) => (b.schedule.updatedAt || b.schedule.createdAt).localeCompare(a.schedule.updatedAt || a.schedule.createdAt)));
      setCandidates(candidateBody.candidates);
      setReliability(reliabilityBody);
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发布状态读取失败");
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function createAndDispatch() {
    if (!candidateId || !platforms.length) return;
    setActing("create");
    try {
      const created = await readJson<{ data?: { schedules?: PublishSchedule[] } }>("/api/publish-jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: candidateId, platforms, scheduledAt: new Date().toISOString() })
      });
      for (const schedule of created.data?.schedules || []) {
        await readJson(`/api/publish-jobs/${encodeURIComponent(schedule.id)}/dispatch`, { method: "POST" });
      }
      messageApi.success("Publish Job 已创建并交给常驻 Worker。");
      await refresh(true);
    } catch (requestError) { messageApi.error(requestError instanceof Error ? requestError.message : "创建失败"); }
    finally { setActing(undefined); }
  }

  async function act(job: PublishJobView, action: "dispatch" | "reconcile-dispatch") {
    setActing(`${action}:${job.schedule.id}`);
    try {
      await readJson(`/api/publish-jobs/${encodeURIComponent(job.schedule.id)}/${action}`, { method: "POST" });
      messageApi.success(action === "dispatch" ? "已进入 Worker 队列。" : "只读 reconciliation 已排队。");
      await refresh(true);
    } catch (requestError) { messageApi.error(requestError instanceof Error ? requestError.message : "操作失败"); }
    finally { setActing(undefined); }
  }

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter((item) => ["scheduled", "publishing"].includes(item.schedule.status)).length,
    public: jobs.filter((item) => ["public_observed", "stable_published"].includes(item.schedule.status)).length,
    risk: jobs.filter((item) => dangerStatuses.has(item.schedule.status)).length
  }), [jobs]);

  return (
    <>
      {messageContext}
      <PageHeader title="发布状态监控" subtitle="前台只下发耐久任务并展示结果；Worker 负责发布，reconciliation 负责 URL 回填与 24h/72h 存活验证。" actions={<Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button>} />
      <div className="publish-control-hero">
        <div><span className="v5-kicker">MACHINE PUBLISHING</span><h2>一次下发，持续追踪到稳定发布</h2><p>按钮点击不等于成功；只有公开 URL 被观察并通过存活窗口，才进入可靠性样本。</p></div>
        <div className={`publish-rollout-seal ${reliability?.rolloutReady ? "is-ready" : ""}`}><SafetyCertificateOutlined /><strong>{reliability?.rolloutReady ? "可规模化" : "验收中"}</strong><span>三平台 reliability</span></div>
      </div>

      {error ? <Alert showIcon type="error" message="发布状态读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} /> : null}
      <Row gutter={[12, 12]} className="publish-stat-row">
        <Col xs={12} lg={6}><Card size="small"><Statistic title="Publish Jobs" value={stats.total} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="队列 / 执行中" value={stats.running} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="公开可访问" value={stats.public} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="阻断 / 异常" value={stats.risk} valueStyle={{ color: stats.risk ? "#b42318" : undefined }} /></Card></Col>
      </Row>

      <Card className="publish-launch-card" title="创建机器发布任务" extra={<Tag color="blue">Worker 异步执行</Tag>}>
        <Space wrap align="end">
          <div><Typography.Text type="secondary">已确认终稿</Typography.Text><Select showSearch optionFilterProp="label" value={candidateId} onChange={setCandidateId} placeholder="选择通过质检的终稿" style={{ width: 360 }} options={candidates.map((item) => ({ value: item.id, label: `${item.title} · v${item.version}` }))} /></div>
          <div><Typography.Text type="secondary">目标平台</Typography.Text><Select mode="multiple" value={platforms} onChange={setPlatforms} style={{ width: 300 }} options={(["csdn", "juejin", "zhihu"] as DirectPublishPlatformKey[]).map((value) => ({ value, label: platformLabel[value] }))} /></div>
          <Button type="primary" icon={<RocketOutlined />} disabled={!candidateId || !platforms.length} loading={acting === "create"} onClick={() => void createAndDispatch()}>创建并交给 Worker</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>月度生产与公众号生产中心的确认发布入口都会进入同一 Publish Job 队列，不再直接调用平台发布。</Typography.Paragraph>
      </Card>

      <Card title="任务生命周期" className="publish-jobs-card" extra={<Typography.Text type="secondary">15 秒自动刷新</Typography.Text>}>
        {loading && !jobs.length ? <div className="v5-loading-row"><Spin /><span>正在读取耐久任务</span></div> : !jobs.length ? <Empty description="暂无 Publish Job" /> : <div className="publish-job-list">
          {jobs.map((job) => {
            const schedule = job.schedule;
            const metric = reliability?.metrics.find((item) => item.platform === schedule.platform);
            return <article className="publish-job" key={schedule.id}>
              <div className="publish-job-head">
                <div><Space wrap><Tag>{platformLabel[schedule.platform]}</Tag><Tag color={dangerStatuses.has(schedule.status) ? "red" : schedule.status === "stable_published" ? "green" : "blue"}>{statusLabel[schedule.status]}</Tag><Typography.Text code>{schedule.id}</Typography.Text></Space><Typography.Text type="secondary">最近更新 {timeText(schedule.updatedAt || schedule.createdAt)} · {job.attempts.length} 次执行/核验</Typography.Text></div>
                <Space wrap>
                  {schedule.status === "scheduled" ? <Button size="small" icon={<RocketOutlined />} loading={acting === `dispatch:${schedule.id}`} onClick={() => void act(job, "dispatch")}>交给 Worker</Button> : null}
                  {reconcilable.has(schedule.status) ? <Button size="small" icon={<SyncOutlined />} loading={acting === `reconcile-dispatch:${schedule.id}`} onClick={() => void act(job, "reconcile-dispatch")}>排队核验</Button> : null}
                  {schedule.publicUrl ? <Button size="small" type="link" href={schedule.publicUrl} target="_blank">打开公开 URL</Button> : null}
                </Space>
              </div>
              <PublishLifecycleRail schedule={schedule} />
              <div className="publish-job-meta">
                <span><b>URL</b>{schedule.publicUrl || "等待 reconciliation 回填"}</span>
                <span><b>首次公开</b>{timeText(schedule.firstPublicObservedAt)}</span>
                <span><b>下次核验</b>{timeText(schedule.nextVerificationAt)}</span>
                <span><b>平台 72h</b>{rateText(metric?.survival72hRate ?? null)}</span>
              </div>
              {schedule.failureReason || schedule.nextAction ? <Alert type={dangerStatuses.has(schedule.status) ? "warning" : "info"} showIcon message={schedule.failureReason || schedule.nextAction} description={schedule.failureReason && schedule.nextAction ? schedule.nextAction : undefined} /> : null}
            </article>;
          })}
        </div>}
      </Card>

      <Card title="Reliability 验收" className="publish-reliability-card">
        <Row gutter={[12, 12]}>{(["csdn", "juejin", "zhihu"] as DirectPublishPlatformKey[]).map((platform) => {
          const metric = reliability?.metrics.find((item) => item.platform === platform);
          const readiness = reliability?.readiness.find((item) => item.platform === platform);
          return <Col xs={24} lg={8} key={platform}><div className="publish-reliability-platform"><div className="publish-reliability-title"><strong>{platformLabel[platform]}</strong><Tag color={readiness?.ready ? "green" : "gold"}>{readiness?.ready ? "已达标" : "样本验收中"}</Tag></div><Progress percent={metric?.survival72hRate == null ? 0 : Math.round(metric.survival72hRate * 100)} status={readiness?.ready ? "success" : "active"} /><div className="publish-reliability-grid"><span>受理 {metric?.submitted ?? 0}</span><span>公开 {metric?.publicObserved ?? 0}</span><span>24h {rateText(metric?.survival24hRate ?? null)}</span><span>72h {rateText(metric?.survival72hRate ?? null)}</span></div><Typography.Text type="secondary">{readiness?.blockers.length ? readiness.blockers.join(" · ") : "全部门槛通过"}</Typography.Text></div></Col>;
        })}</Row>
      </Card>
    </>
  );
}
