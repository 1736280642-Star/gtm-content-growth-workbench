"use client";

import { DownOutlined, LinkOutlined, ReloadOutlined, RocketOutlined, SyncOutlined, UpOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Progress, Row, Select, Space, Spin, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { DirectPublishPlatformKey, PublishAttempt, PublishSchedule, PublishScheduleStatus } from "@/lib/types";
import { classifyPublishResponsibility } from "@/lib/v5/responsibility";

interface PublishJobView { schedule: PublishSchedule; attempts: PublishAttempt[]; title: string; productName: string }
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
// Phase 0: 细分状态 — 可自动恢复的状态不再计入"危险"
// 系统可自动重试：precheck_failed、verification_timeout、pending_config
const needsUserAction = (schedule: PublishSchedule) =>
  classifyPublishResponsibility(schedule.status, schedule.retryCount).userActionRequired;
const isSystemRecovering = (schedule: PublishSchedule) => {
  const result = classifyPublishResponsibility(schedule.status, schedule.retryCount);
  return result.responsibility === "system" && result.recoveryStatus === "retrying";
};
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

const compactLifecycleSteps = ["发布", "URL 确认", "公开核验", "72h 稳定"];

function compactLifecycleStage(schedule: PublishSchedule) {
  if (schedule.status === "stable_published" || schedule.stablePublishedAt) return 3;
  if (schedule.publicUrl || schedule.firstPublicObservedAt) return 2;
  if (["published_verified", "published_pending_url", "pending_verify", "public_observed"].includes(schedule.status)) return 1;
  return 0;
}

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
  const [selectedProduct, setSelectedProduct] = useState("all");
  const [showAutomated, setShowAutomated] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string>();

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

  useEffect(() => {
    const roots = [document.querySelector(".unified-workspace-nav.is-monitor"), document.querySelector(".publishing-page")].filter(Boolean) as Element[];
    const stripNativeHints = () => {
      for (const root of roots) root.querySelectorAll("[title]").forEach((element) => element.removeAttribute("title"));
    };
    stripNativeHints();
    const observers = roots.map((root) => {
      const observer = new MutationObserver(stripNativeHints);
      observer.observe(root, { attributes: true, attributeFilter: ["title"], childList: true, subtree: true });
      return observer;
    });
    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

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
    running: jobs.filter((item) => !needsUserAction(item.schedule) && item.schedule.status !== "stable_published").length,
    stable: jobs.filter((item) => item.schedule.status === "stable_published" || Boolean(item.schedule.stablePublishedAt)).length,
    risk: jobs.filter((item) => needsUserAction(item.schedule)).length,
    recovering: jobs.filter((item) => isSystemRecovering(item.schedule)).length,
  }), [jobs]);

  const productGroups = useMemo(() => {
    const groups = new Map<string, { name: string; jobs: PublishJobView[] }>();
    for (const job of jobs) {
      const name = job.productName || "其他产品内容";
      const group = groups.get(name) || { name, jobs: [] };
      group.jobs.push(job);
      groups.set(name, group);
    }
    return [...groups.values()].map((group) => {
      const attention = group.jobs.filter((job) => needsUserAction(job.schedule)).length;
      const stable = group.jobs.filter((job) => job.schedule.status === "stable_published" || Boolean(job.schedule.stablePublishedAt)).length;
      const published = group.jobs.filter((job) => Boolean(job.schedule.publicUrl || job.schedule.firstPublicObservedAt || job.schedule.stablePublishedAt)).length;
      return { ...group, attention, stable, published, verifying: group.jobs.length - attention - stable };
    }).sort((left, right) => right.attention - left.attention || right.jobs.length - left.jobs.length || left.name.localeCompare(right.name));
  }, [jobs]);

  const scopedJobs = useMemo(
    () => selectedProduct === "all" ? jobs : jobs.filter((job) => job.productName === selectedProduct),
    [jobs, selectedProduct]
  );
  const attentionJobs = useMemo(() => scopedJobs.filter((job) => needsUserAction(job.schedule)), [scopedJobs]);
  const automatedJobs = useMemo(() => scopedJobs.filter((job) => !needsUserAction(job.schedule)), [scopedJobs]);
  const visibleAttentionJobs = showAllAttention ? attentionJobs : attentionJobs.slice(0, 5);

  function renderCompactJob(job: PublishJobView, needsAttention: boolean) {
    const schedule = job.schedule;
    const stage = compactLifecycleStage(schedule);
    const expanded = expandedJobId === schedule.id;
    return (
      <article className={`publish-compact-job ${needsAttention ? "is-attention" : ""}`} key={schedule.id}>
        <div className="publish-compact-row">
          <div className="publish-compact-identity">
            <strong>{job.title}</strong>
            <span><Tag>{platformLabel[schedule.platform]}</Tag>{job.productName}</span>
          </div>
          <div className="publish-compact-status">
            <Tag color={needsAttention ? "red" : schedule.status === "stable_published" ? "green" : "blue"}>{statusLabel[schedule.status]}</Tag>
            {needsAttention && (schedule.failureReason || schedule.nextAction) ? <span>{schedule.failureReason || schedule.nextAction}</span> : null}
          </div>
          <div className="publish-compact-lifecycle" aria-label="发布进度">
            {compactLifecycleSteps.map((label, index) => {
              const completed = schedule.status === "stable_published" ? index <= stage : index < stage;
              const active = schedule.status !== "stable_published" && index === stage;
              return <span className={`${completed ? "is-done" : ""} ${active ? "is-active" : ""} ${needsAttention && active ? "is-failed" : ""}`} key={label}><i />{label}</span>;
            })}
          </div>
          <div className="publish-compact-next">
            <span>{needsAttention ? "需要人工确认" : schedule.status === "stable_published" ? "已稳定发布" : "下次自动核验"}</span>
            <strong>{needsAttention ? statusLabel[schedule.status] : schedule.status === "stable_published" ? timeText(schedule.stablePublishedAt || schedule.updatedAt) : timeText(schedule.nextVerificationAt)}</strong>
          </div>
          <Button type="text" className="publish-compact-expand" onClick={() => setExpandedJobId(expanded ? undefined : schedule.id)} aria-expanded={expanded}>
            {needsAttention ? "处理异常" : "查看详情"} {expanded ? <UpOutlined /> : <DownOutlined />}
          </Button>
        </div>
        {expanded ? <div className="publish-compact-detail">
          <div className="publish-detail-facts">
            <span><b>公开地址</b>{schedule.publicUrl ? <a href={schedule.publicUrl} target="_blank" rel="noreferrer">打开文章 <LinkOutlined /></a> : "等待系统回填"}</span>
            <span><b>下次核验</b>{timeText(schedule.nextVerificationAt)}</span>
            <span><b>执行记录</b>{job.attempts.length} 次</span>
            <span><b>任务编号</b><code>{schedule.id}</code></span>
          </div>
          {schedule.failureReason || schedule.nextAction ? <div className={`publish-detail-guidance ${needsAttention ? "is-attention" : ""}`}>
            <div><b>{needsAttention ? "异常原因" : "当前说明"}</b><span>{schedule.failureReason || "系统正在继续处理"}</span></div>
            {schedule.nextAction ? <div><b>建议操作</b><span>{schedule.nextAction}</span></div> : null}
          </div> : null}
          {needsAttention ? <Space wrap className="publish-detail-actions">
            {reconcilable.has(schedule.status) ? <Button icon={<SyncOutlined />} loading={acting === `reconcile-dispatch:${schedule.id}`} onClick={() => void act(job, "reconcile-dispatch")}>重新核验</Button> : null}
            {schedule.status === "scheduled" ? <Button icon={<RocketOutlined />} loading={acting === `dispatch:${schedule.id}`} onClick={() => void act(job, "dispatch")}>启动发布</Button> : null}
            {schedule.publicUrl ? <Button type="link" href={schedule.publicUrl} target="_blank">打开公开文章</Button> : null}
          </Space> : null}
        </div> : null}
      </article>
    );
  }

  return (
    <div className="publishing-page">
      {messageContext}
      <PageHeader title="发布状态监控" subtitle="前台只下发耐久任务并展示结果；Worker 负责发布，reconciliation 负责 URL 回填与 24h/72h 存活验证。" actions={<Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button>} />

      {error ? <Alert showIcon type="error" message="发布状态读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} /> : null}
      <Card className="publish-launch-card" title="创建机器发布任务" extra={<Tag color="blue">Worker 异步执行</Tag>}>
        <Space wrap align="end">
          <div><Typography.Text type="secondary">已确认终稿</Typography.Text><Select showSearch optionFilterProp="label" value={candidateId} onChange={setCandidateId} placeholder="选择通过质检的终稿" style={{ width: 360 }} options={candidates.map((item) => ({ value: item.id, label: `${item.title} · v${item.version}` }))} /></div>
          <div><Typography.Text type="secondary">目标平台</Typography.Text><Select mode="multiple" value={platforms} onChange={setPlatforms} style={{ width: 300 }} options={(["csdn", "juejin", "zhihu"] as DirectPublishPlatformKey[]).map((value) => ({ value, label: platformLabel[value] }))} /></div>
          <Button type="primary" icon={<RocketOutlined />} disabled={!candidateId || !platforms.length} loading={acting === "create"} onClick={() => void createAndDispatch()}>创建并交给 Worker</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>月度生产与公众号生产中心的确认发布入口都会进入同一 Publish Job 队列，不再直接调用平台发布。</Typography.Paragraph>
      </Card>

      <Card title="发布任务" className="publish-jobs-card publish-monitor-card" extra={<Typography.Text type="secondary"><span className="publish-live-dot" />15 秒自动刷新</Typography.Text>}>
        {loading && !jobs.length ? <div className="v5-loading-row"><Spin /><span>正在同步发布任务</span></div> : !jobs.length ? <Empty description="暂无发布任务" /> : <>
          <div className="publish-monitor-summary" aria-label="发布任务状态汇总">
            <span><b>{stats.total}</b>全部任务</span>
            <span><b>{stats.running}</b>自动运行</span>
            <span><b>{stats.stable}</b>稳定发布</span>
            {stats.recovering > 0 ? <span className="is-recovering"><b>{stats.recovering}</b>自动恢复中</span> : null}
            <span className={stats.risk ? "is-attention" : ""}><b>{stats.risk}</b>需处理</span>
          </div>
          <div className="publish-product-filter">
            <div><Typography.Text type="secondary">按产品查看</Typography.Text><Select value={selectedProduct} onChange={setSelectedProduct} options={[{ value: "all", label: `全部产品（${jobs.length}）` }, ...productGroups.map((group) => ({ value: group.name, label: `${group.name}（${group.jobs.length}）` }))]} /></div>
            <span>正常任务由系统自动推进，仅在出现异常时需要人工处理。</span>
          </div>
          <div className="publish-product-overview" aria-label="产品发布概览">
            {productGroups.map((group) => <button type="button" className={selectedProduct === group.name ? "is-selected" : ""} onClick={() => setSelectedProduct(selectedProduct === group.name ? "all" : group.name)} key={group.name}>
              <span><strong>{group.name}</strong><em>{group.jobs.length} 篇</em></span>
              <span>已公开 {group.published} · 核验中 {group.verifying} · 异常 {group.attention}</span>
              <i><b style={{ width: `${group.jobs.length ? Math.round(group.published / group.jobs.length * 100) : 0}%` }} /></i>
            </button>)}
          </div>
          <section className="publish-task-section is-attention" aria-labelledby="publish-attention-heading">
            <div className="publish-task-section-head"><div><h3 id="publish-attention-heading">需处理任务 <Tag color={attentionJobs.length ? "red" : "green"}>{attentionJobs.length}</Tag></h3><p>{attentionJobs.length ? `优先显示最近 ${Math.min(5, attentionJobs.length)} 条，确认原因后再重新核验。` : "当前没有需要人工处理的发布异常。"}</p></div>{attentionJobs.length > 5 ? <Button type="text" onClick={() => setShowAllAttention((value) => !value)}>{showAllAttention ? "收起其余异常" : `查看全部 ${attentionJobs.length} 项`} {showAllAttention ? <UpOutlined /> : <DownOutlined />}</Button> : null}</div>
            {attentionJobs.length ? <div className="publish-compact-list">{visibleAttentionJobs.map((job) => renderCompactJob(job, true))}</div> : null}
          </section>
          <section className="publish-task-section" aria-labelledby="publish-automated-heading">
            <div className="publish-task-section-head"><div><h3 id="publish-automated-heading">自动运行中的任务 <Tag>{automatedJobs.length}</Tag></h3><p>发布、URL 回填和存活核验会持续自动执行。</p></div><Button type="text" onClick={() => setShowAutomated((value) => !value)}>{showAutomated ? "收起" : `展开 ${automatedJobs.length} 项`} {showAutomated ? <UpOutlined /> : <DownOutlined />}</Button></div>
            {showAutomated ? <div className="publish-compact-list">{automatedJobs.map((job) => renderCompactJob(job, false))}</div> : null}
          </section>
        </>}
      </Card>

      <Card title="Reliability 验收" className="publish-reliability-card">
        <Row gutter={[12, 12]}>{(["csdn", "juejin", "zhihu"] as DirectPublishPlatformKey[]).map((platform) => {
          const metric = reliability?.metrics.find((item) => item.platform === platform);
          const readiness = reliability?.readiness.find((item) => item.platform === platform);
          return <Col xs={24} lg={8} key={platform}><div className="publish-reliability-platform"><div className="publish-reliability-title"><strong>{platformLabel[platform]}</strong><Tag color={readiness?.ready ? "green" : "gold"}>{readiness?.ready ? "已达标" : "样本验收中"}</Tag></div><Progress percent={metric?.survival72hRate == null ? 0 : Math.round(metric.survival72hRate * 100)} status={readiness?.ready ? "success" : "active"} /><div className="publish-reliability-grid"><span>受理 {metric?.submitted ?? 0}</span><span>公开 {metric?.publicObserved ?? 0}</span><span>24h {rateText(metric?.survival24hRate ?? null)}</span><span>72h {rateText(metric?.survival72hRate ?? null)}</span></div><Typography.Text type="secondary">{readiness?.blockers.length ? readiness.blockers.join(" · ") : "全部门槛通过"}</Typography.Text></div></Col>;
        })}</Row>
      </Card>
    </div>
  );
}
