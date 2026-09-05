"use client";

import { ArrowLeftOutlined, HistoryOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { hostedHistoryHref, hostedHistorySteps, type HostedHistoryStep, type HostedHistoryView } from "@/lib/v5/hosted-history-contracts";
import { SampleMarkdown } from "../_components/SampleMarkdown";
import { historyChannelLabels, historyStatusLabels, historyStepLabels, historyTime } from "../_components/history-labels";
import styles from "../../hosted-mode.module.css";

function safePublicUrl(value?: string) {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function HistoryContent() {
  const search = useSearchParams();
  const orderId = search.get("orderId") || "";
  const step = (search.get("step") || "research") as HostedHistoryStep;
  const resultId = search.get("resultId");
  const [data, setData] = useState<HostedHistoryView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(undefined); setError(undefined);
    if (!orderId) { setError("缺少托管任务编号，请从托管回执进入历史结果。"); setLoading(false); return; }
    const query = new URLSearchParams({ step });
    if (resultId) query.set("resultId", resultId);
    void (async () => {
      try {
        const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(orderId)}/history?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "历史结果读取失败，请刷新重试。");
        if (!controller.signal.aborted) setData(payload);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "历史结果读取失败，请刷新重试。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [orderId, step, resultId, attempt]);

  const result = data?.result;
  const versions = data?.entries.filter(item => item.step === step) || [];
  return <div className={styles.historyPage}>
    <header className={styles.emailToolbar}>
      <div><h1>步骤历史结果</h1><span>{data?.order.productName || "托管推广"} · 只读存档，查看不会修改当前流程</span></div>
      <div className={styles.toolbarActions}><Link href={orderId ? `/hosted/success?orderId=${encodeURIComponent(orderId)}` : "/"}><Button icon={<ArrowLeftOutlined />}>返回托管回执</Button></Link><Link href={`/hosted/email?orderId=${encodeURIComponent(orderId)}`}><Button>查看当前发布结果</Button></Link></div>
    </header>
    {loading ? <div className={styles.reviewLoading}><Spin /><span>正在读取历史结果</span></div> : error ? <div className={styles.reviewError} role="alert"><strong>无法打开历史结果</strong><span>{error}</span><Button icon={<ReloadOutlined />} onClick={() => setAttempt(value => value + 1)}>重新读取</Button></div> : <>
      <nav className={styles.historySteps} aria-label="结果步骤">{hostedHistorySteps.map((key, index) => <Link key={key} href={hostedHistoryHref(orderId, key)} aria-current={key === step ? "page" : undefined}>{index + 1}. {historyStepLabels[key]}<small>{data?.entries.filter(item => item.step === key).length || 0} 份结果</small></Link>)}</nav>
      <div className={styles.historyGrid}>
        <aside className={styles.historyVersions} aria-label="历史版本"><h2><HistoryOutlined /> 历史版本</h2>{versions.map((item, index) => <Link key={item.resultId} href={hostedHistoryHref(orderId, step, item.resultId)} aria-current={result?.resultId === item.resultId ? "page" : undefined}><strong>记录 {versions.length - index}{index === 0 ? " · 最近留存" : ""}</strong><span>{historyTime(item.createdAt)}</span><span>{item.sourceVersion}</span>{item.decision ? <span>{item.decision === "approve" ? "已确认通过" : "已提出修改意见"}</span> : null}</Link>)}{!versions.length ? <p>本步骤暂无历史记录</p> : null}</aside>
        <main className={styles.historyResult}>
          {!result ? <section className={styles.resultEmpty}><HistoryOutlined /><strong>尚无可查看的历史结果</strong><span>本步骤尚未生成结果，或旧任务未留存当时的快照。完成后会保留结果；历史不会用当前内容替代。</span></section> : <>
            <section className={styles.decisionCard}>
              <div className={styles.decisionHeader}><span>{historyStepLabels[result.step]}</span><small>历史结果 · 只读</small></div>
              <div className={styles.decisionSection}><h2>{result.title}</h2><p>{result.summary}</p><span className={styles.historyMeta}>留存于 {historyTime(result.createdAt)}（北京时间） · {result.sourceVersion}</span></div>
              {result.decision || result.step === "strategy" || result.step === "sample-review" ? <div className={styles.decisionSection}><h2>当时的确认结果</h2><p>{result.decision === "approve" ? "已确认通过" : result.decision === "changes_requested" ? "已提出修改意见" : "旧记录未留存确认决定"}</p>{result.comment ? <p>确认意见：{result.comment}</p> : null}</div> : null}
              {result.sections.map((section, index) => <section className={styles.decisionSection} key={`${index}-${section.title}`}><h2>{section.title}</h2>{section.items.length ? <ul>{section.items.map((item, itemIndex) => <li key={itemIndex}>{historyChannelLabels[item] || item}</li>)}</ul> : <p>本版本未记录该项内容</p>}</section>)}
            </section>
            {result.article ? <section className={styles.samplePaper}><div className={styles.sampleMeta}><span>留存正文 · 不随重新生成而变化</span></div><h2>{result.article.title}</h2><SampleMarkdown title={result.article.title} markdown={result.article.markdown} /></section> : null}
            {result.publications ? <section className={styles.decisionCard}><div className={styles.decisionHeader}><span>当时的公开结果与状态</span></div><div className={styles.decisionSection}><p>这里显示留存时的状态。公开文章链接由平台维护，内容可能变化；最新进展请查看当前发布结果。</p></div>{result.publications.map(item => <div className={styles.decisionSection} key={item.taskId}><h2>{historyChannelLabels[item.channel] || item.channel} · {historyStatusLabels[item.status] || item.status}</h2><p>{item.title}</p>{item.failureReason ? <p>原因：{item.failureReason}</p> : null}{item.nextAction && !item.publicUrl ? <p>当时的下一步：{item.nextAction}</p> : null}{safePublicUrl(item.publicUrl) ? <a href={safePublicUrl(item.publicUrl)} target="_blank" rel="noreferrer">查看公开文章 ↗</a> : <span className={styles.historyMeta}>当时尚未取得公开 URL</span>}</div>)}</section> : null}
          </>}
        </main>
      </div>
    </>}
  </div>;
}
export default function HostedHistoryPage() {
  return <Suspense fallback={<div className={styles.reviewLoading}><Spin /></div>}><HistoryContent /></Suspense>;
}
