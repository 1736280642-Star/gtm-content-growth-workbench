"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  FileTextOutlined,
  MailOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { Button, Popconfirm, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { hostedHistoryHref, type HostedHistoryStep, type HostedResultSummary } from "@/lib/v5/hosted-history-contracts";
import styles from "../../hosted-mode.module.css";

type HostedStatus = "preparing" | "pending_strategy_review" | "generating_sample" | "pending_sample_review" | "running" | "action_required" | "paused" | "completed";

interface HostedOrder {
  orderId: string;
  productId: string;
  productName: string;
  contactEmail: string;
  contactEmailVerified: boolean;
  status: HostedStatus;
  currentActionType?: string;
  channels: Array<{ channel: string; dailyCap?: number }>;
  materialSummary: {
    officialUrl?: string;
    fileNames: string[];
    acceptedSourceCount: number;
    failedSources: Array<{ name: string; reason: string }>;
    importStatus: string;
  };
  lastError?: { code: string; message: string };
  rowVersion: number;
}

interface NextAction {
  type: string;
  label: string;
  description: string;
  href?: string;
}

interface PendingReview {
  gateType: "strategy" | "sample";
  status: string;
  expiresAt: string;
}

interface SampleProgress {
  operationStatus?: string;
  progressStage?: string;
  attemptCount: number;
}

interface DailyBatch {
  businessDate: string;
  publishedCount: number;
  results: Array<{ taskId: string; title: string; publicUrl?: string; status: string }>;
}

const channelLabels: Record<string, string> = {
  wechat: "微信公众号",
  zhihu: "知乎",
  csdn: "CSDN",
  juejin: "掘金"
};

const statusCopy: Record<HostedStatus, { label: string; title: string; description: string }> = {
  preparing: { label: "准备中", title: "系统已经接手，下一次会通过邮件联系你。", description: "现在正在整理资料并完成 GEO 调研。策略准备好后，会发送一封需要你确认的邮件。" },
  pending_strategy_review: { label: "待确认策略", title: "GEO 策略已经准备好。", description: "打开邮件中的安全链接确认策略；通过后系统会立即生成代表样文。" },
  generating_sample: { label: "正在生成样文", title: "策略已确认，正在生成代表样文。", description: "系统正在调用 AI 生成并检查样文；完成后本页面会自动更新，无需重复确认策略。" },
  pending_sample_review: { label: "待确认样文", title: "代表样文已经准备好。", description: "确认样文后，产品会进入正式托管发布状态。" },
  running: { label: "托管发布中", title: "系统正在按本轮计划自动发布。", description: "没有异常时不需要每天操作；当日批次关闭后会收到公开 URL 汇总。" },
  action_required: { label: "需要你处理", title: "有一项问题无法由系统自动判断。", description: "处理完成后系统会从当前阶段继续，不需要重新提交。" },
  paused: { label: "已暂停", title: "这项推广当前已暂停。", description: "恢复后会继续执行本轮剩余任务，不会创建新的计划周期。" },
  completed: { label: "本轮已完成", title: "本轮托管任务已经完成。", description: "公开结果已经汇总，下一轮建议将在复盘完成后生成。" }
};

const sampleProgressLabels: Record<string, string> = {
  queued: "已进入生成队列",
  retrieving_evidence: "正在整理正式资料与证据",
  freezing_evidence: "正在冻结本次样文使用的证据",
  calling_provider: "正在调用 AI 生成正文",
  validating_draft: "正在检查事实、格式与发布规则",
  completed: "样文已生成"
};

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedSuccessPage() {
  const [history, setHistory] = useState<HostedResultSummary[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [order, setOrder] = useState<HostedOrder>();
  const [nextAction, setNextAction] = useState<NextAction>();
  const [latestBatch, setLatestBatch] = useState<DailyBatch>();
  const [pendingReview, setPendingReview] = useState<PendingReview>();
  const [sampleProgress, setSampleProgress] = useState<SampleProgress>();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mutating, setMutating] = useState(false);
  const [resending, setResending] = useState(false);
  const [retryingSample, setRetryingSample] = useState(false);
  const backgroundRefreshRef = useRef(false);

  const loadOrder = useCallback(async (targetOrderId: string, background = false) => {
    if (background && backgroundRefreshRef.current) return;
    backgroundRefreshRef.current = true;
    if (!background) {
      setLoading(true);
      setError(undefined);
    }
    try {
      const orderRequest = fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}`, { cache: "no-store" });
      const batchesRequest = fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}/daily-batches`, { cache: "no-store" })
        .catch(() => undefined);
      const response = await orderRequest;
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "托管回执读取失败。"));
      setOrder(payload.order as HostedOrder);
      setNextAction(payload.nextAction as NextAction);
      setPendingReview(payload.pendingReview as PendingReview | undefined);
      setSampleProgress(payload.sampleProgress as SampleProgress | undefined);
      try {
        const historyResponse = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}/history`, { cache: "no-store" });
        if (!historyResponse.ok) throw new Error("history_unavailable");
        const historyPayload = await historyResponse.json();
        setHistory(Array.isArray(historyPayload.entries) ? historyPayload.entries : []);
        setHistoryError(false);
      } catch { setHistoryError(true); }
      const batchesResponse = await batchesRequest;
      if (batchesResponse?.ok) {
        const batchesPayload = await batchesResponse.json();
        setLatestBatch(Array.isArray(batchesPayload.batches) ? batchesPayload.batches[0] : undefined);
      }
    } catch (cause) {
      if (!background) setError(cause instanceof Error ? cause.message : "托管回执读取失败。请稍后重试。");
    } finally {
      backgroundRefreshRef.current = false;
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    const targetOrderId = new URLSearchParams(window.location.search).get("orderId")?.trim() || "";
    setOrderId(targetOrderId);
    if (!targetOrderId) {
      setError("缺少托管任务编号，请从提交成功页面重新进入。");
      setLoading(false);
      return;
    }
    void loadOrder(targetOrderId);
  }, [loadOrder]);

  useEffect(() => {
    if (order?.status !== "generating_sample") return;
    const timer = window.setInterval(() => {
      void loadOrder(order.orderId, true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadOrder, order?.orderId, order?.status]);

  async function changePauseState(action: "pause" | "resume") {
    if (!order) return;
    setMutating(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(order.orderId)}/pause`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `hosted-${action}-${crypto.randomUUID()}` },
        body: JSON.stringify({ action, expectedVersion: order.rowVersion })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, action === "pause" ? "暂停失败。" : "恢复失败。"));
      setOrder(payload.order as HostedOrder);
      if (payload.nextAction) setNextAction(payload.nextAction as NextAction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "托管状态修改失败。请刷新后重试。");
    } finally {
      setMutating(false);
    }
  }

  async function resendReviewEmail() {
    if (!order) return;
    setResending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(order.orderId)}/review-email`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "确认邮件重新发送失败。"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认邮件重新发送失败。请稍后重试。");
    } finally {
      setResending(false);
    }
  }

  async function retrySampleGeneration() {
    if (!order) return;
    setRetryingSample(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(order.orderId)}/sample-retry`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "样文重新生成失败。"));
      setOrder(payload.order as HostedOrder);
      setNextAction(payload.nextAction as NextAction);
      setPendingReview(payload.pendingReview as PendingReview | undefined);
      setSampleProgress(payload.sampleProgress as SampleProgress | undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "样文重新生成失败，请稍后重试。");
    } finally {
      setRetryingSample(false);
    }
  }

  if (loading) return <div className={styles.successLoading}><Spin /><span>正在读取正式托管回执</span></div>;
  if (!order || error) {
    return <div className={styles.successError}><strong>暂时无法打开托管回执</strong><span>{error}</span><div><Button icon={<ReloadOutlined />} onClick={() => orderId && loadOrder(orderId)}>重新读取</Button><Link href="/"><Button type="primary">返回发起推广</Button></Link></div></div>;
  }

  const copy = statusCopy[order.status];
  const channelText = order.channels.map((item) => channelLabels[item.channel] || item.channel).join("、");
  const materialText = order.materialSummary.acceptedSourceCount
    ? `${order.materialSummary.acceptedSourceCount} 个来源已接收`
    : order.materialSummary.importStatus === "not_required" ? "沿用已有产品资料" : "资料需要补充";
  const sampleStepActive = order.status === "generating_sample" || order.currentActionType === "retry_sample";
  const sampleStepDone = ["pending_sample_review", "running", "completed"].includes(order.status);
  const strategyStepDone = sampleStepActive || sampleStepDone;
  const progressText = sampleProgressLabels[sampleProgress?.progressStage || sampleProgress?.operationStatus || "queued"] || "正在生成代表样文";
  function resultLink(step: HostedHistoryStep) {
    const entries = history.filter(item => item.step === step);
    return <Link className={styles.timelineResult} href={hostedHistoryHref(order!.orderId, step, entries[0]?.resultId)}>{historyError ? "重新读取历史结果" : entries.length ? "查看结果" : "查看步骤记录"}<ArrowRightOutlined /><small>{historyError ? "历史读取暂不可用" : entries.length ? `${entries.length} 份留存` : "尚无留存结果"}</small></Link>;
  }

  return (
    <div className={styles.successPage}>
      <section className={styles.successIntro}>
        <span className={styles.successIcon}><CheckCircleFilled /></span>
        <div className={styles.kicker}>HANDOFF ACCEPTED · {order.orderId}</div>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </section>

      <div className={styles.successGrid}>
        <section className={styles.successPanel}>
          <div className={styles.successPanelHeader}><h2>正式托管回执</h2><span className={styles.statusPill}>{copy.label}</span></div>
          <div className={styles.taskFacts}>
            <div className={styles.taskFact}><span>推广产品</span><strong>{order.productName}</strong></div>
            <div className={styles.taskFact}><span>资料状态</span><strong>{materialText}</strong></div>
            <div className={styles.taskFact}><span>推广渠道</span><strong>{channelText}</strong></div>
          </div>
          <div className={styles.timeline}>
            <div className={`${styles.timelineItem} ${order.status === "preparing" ? styles.isActive : styles.isDone}`}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>资料处理与 GEO 调研</strong><span>系统整理官网与文件，并生成受治理的推广策略</span>{resultLink("research")}</div><span className={styles.timelineTime}>{order.status === "preparing" ? "进行中" : "已完成"}</span></div>
            <div className={`${styles.timelineItem} ${order.status === "pending_strategy_review" ? styles.isActive : strategyStepDone ? styles.isDone : ""}`}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>确认 GEO 策略</strong><span>邮件链接直达目标用户、核心表达、渠道和内容方向</span>{resultLink("strategy")}</div><span className={styles.timelineTime}>{order.status === "pending_strategy_review" ? "等你确认" : strategyStepDone ? "已完成" : "随后"}</span></div>
            <div className={`${styles.timelineItem} ${sampleStepActive ? styles.isActive : sampleStepDone ? styles.isDone : ""}`}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>生成代表样文</strong><span>系统自动生成并检查事实、表达与渠道格式</span>{resultLink("sample-generation")}</div><span className={styles.timelineTime}>{order.currentActionType === "retry_sample" ? "需要重试" : order.status === "generating_sample" ? "进行中" : sampleStepDone ? "已完成" : "随后"}</span></div>
            <div className={`${styles.timelineItem} ${order.status === "pending_sample_review" ? styles.isActive : ["running", "completed"].includes(order.status) ? styles.isDone : ""}`}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>确认代表样文</strong><span>样文通过后才进入正式批量生产</span>{resultLink("sample-review")}</div><span className={styles.timelineTime}>{order.status === "pending_sample_review" ? "等你确认" : ["running", "completed"].includes(order.status) ? "已完成" : "随后"}</span></div>
            <div className={`${styles.timelineItem} ${order.status === "running" ? styles.isActive : order.status === "completed" ? styles.isDone : ""}`}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>托管发布与 URL 回传</strong><span>按渠道每日安全上限执行，当日批次关闭后发送一封汇总邮件</span>{resultLink("publishing")}</div><span className={styles.timelineTime}>{order.status === "running" ? "自动运行" : "本轮内"}</span></div>
          </div>
          {latestBatch ? <div className={styles.recentResults}><div><strong>最近公开结果</strong><span>{latestBatch.businessDate} · {latestBatch.publishedCount} 个公开 URL</span></div>{latestBatch.results.filter((item) => item.publicUrl).slice(0, 3).map((item) => <a href={item.publicUrl} target="_blank" rel="noreferrer" key={item.taskId}>{item.title} <ArrowRightOutlined /></a>)}</div> : null}
        </section>

        <aside className={styles.successSide}>
          <div className={styles.mailNotice}><strong><MailOutlined /> 下一步会发送到邮箱</strong><span>{order.contactEmail} · {order.contactEmailVerified ? "已通过邮件链接验证" : "首次打开确认链接后完成验证"}<br />{nextAction?.description}</span></div>
          {order.status === "generating_sample" ? <div className={styles.sideNote}><strong>样文生成进度</strong><span>{progressText}。页面每 4 秒自动更新。</span></div> : null}
          {order.lastError ? <div className={styles.sideNote}><strong>需要处理的问题</strong><span>{order.lastError.message}</span></div> : <div className={styles.sideNote}><strong>现在需要做什么？</strong><span>{order.status === "preparing" ? "可以关闭页面。调研完成后再通过邮件确认策略。" : nextAction?.description}</span></div>}
          <div className={styles.sideNote}><strong>系统会自行完成</strong><span>内容生产、本轮排程、渠道发布、失败重试、公开 URL 回填和初次可访问检查。</span></div>
        </aside>
      </div>

      <div className={styles.successActions}>
        {nextAction?.href ? <Link href={nextAction.href}><Button type="primary" icon={<ArrowRightOutlined />}>{nextAction.label}</Button></Link> : null}
        {order.lastError?.code === "hosted_sample_generation_failed" ? <Button type="primary" loading={retryingSample} onClick={retrySampleGeneration}>重新生成样文</Button> : null}
        {order.status === "running" || order.status === "completed" ? <Link href={`/hosted/email?orderId=${encodeURIComponent(order.orderId)}`}><Button type="primary" icon={<MailOutlined />}>查看每日发布结果</Button></Link> : null}
        {pendingReview?.status === "pending" ? <Button icon={<MailOutlined />} loading={resending} onClick={resendReviewEmail}>重新发送确认邮件</Button> : null}
        <Button icon={<ReloadOutlined />} onClick={() => loadOrder(order.orderId)}>刷新当前状态</Button>
        <Link href="/"><Button icon={<FileTextOutlined />}>再发起一项推广</Button></Link>
        {order.status === "paused" ? <Button type="text" loading={mutating} onClick={() => changePauseState("resume")}>恢复托管</Button> : <Popconfirm title="暂停这项托管推广？" description="新发布作业会停止；已经交给平台处理或已经公开的内容不会撤回。" okText="暂停" cancelText="取消" onConfirm={() => changePauseState("pause")}><Button type="text" icon={<PauseCircleOutlined />} loading={mutating}>暂停托管</Button></Popconfirm>}
        <Link href={`/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`}><Button type="text" icon={<SettingOutlined />}>托管设置</Button></Link>
        <Link href={`/?orderId=${encodeURIComponent(order.orderId)}#setup-accounts`}><Button type="text" icon={<SettingOutlined />}>继续完成渠道连接</Button></Link>
      </div>
    </div>
  );
}
