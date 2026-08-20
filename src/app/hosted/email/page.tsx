"use client";

import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  LinkOutlined,
  MailOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../../hosted-mode.module.css";

interface PublishResult {
  taskId: string;
  title: string;
  channel: string;
  status: "published" | "platform_review" | "failed" | "deferred";
  publicUrl?: string;
  publishedAt?: string;
  failureReason?: string;
}

interface DailyBatch {
  batchId: string;
  orderId: string;
  businessDate: string;
  plannedCount: number;
  publishedCount: number;
  pendingCount: number;
  failedCount: number;
  status: "collecting" | "closed";
  closedAt?: string;
  results: PublishResult[];
}

const channelLabels: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };
const resultLabels: Record<PublishResult["status"], string> = { published: "已公开", platform_review: "平台审核中", failed: "未完成", deferred: "已顺延" };

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedEmailResultPage() {
  const [orderId, setOrderId] = useState("");
  const [batches, setBatches] = useState<DailyBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async (targetOrderId: string) => {
    if (!targetOrderId) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}/daily-batches`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "发布结果读取失败。"));
      setBatches(Array.isArray(payload.batches) ? payload.batches : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布结果读取失败。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    const targetOrderId = new URLSearchParams(window.location.search).get("orderId")?.trim() || "";
    setOrderId(targetOrderId);
    if (targetOrderId) void load(targetOrderId);
    else setLoading(false);
  }, [load]);

  const latest = batches[0];
  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在读取正式发布结果</span></div>;

  return (
    <div className={styles.emailPage}>
      <div className={styles.emailToolbar}>
        <div><h1>每日发布结果</h1><span>这里只展示正式发布记录和已经取得的公开 URL</span></div>
        <div className={styles.toolbarActions}>{orderId ? <Button icon={<ReloadOutlined />} onClick={() => load(orderId)}>刷新</Button> : null}<Link href={orderId ? `/hosted/success?orderId=${encodeURIComponent(orderId)}` : "/"}><Button icon={<ArrowLeftOutlined />}>{orderId ? "返回托管状态" : "返回发起推广"}</Button></Link></div>
      </div>

      {!orderId ? <section className={styles.resultEmpty}><MailOutlined /><strong>这里不再展示模拟邮件</strong><span>从正式托管回执进入后，系统会展示该任务的真实每日批次。邮件中的链接也会直接带上对应任务。</span><Link href="/"><Button type="primary">发起一项托管推广</Button></Link></section> : null}
      {error ? <div className={styles.formError} role="alert"><strong>暂时无法读取结果</strong><span>{error}</span></div> : null}
      {orderId && !latest && !error ? <section className={styles.resultEmpty}><ClockCircleOutlined /><strong>还没有关闭的每日批次</strong><span>系统获得当日公开 URL，或到达当日截止时间后，会在这里生成汇总并发送邮件。</span></section> : null}

      {latest ? (
        <section className={styles.mailWindow} aria-label="真实每日发布结果">
          <div className={styles.mailChrome}><div className={styles.mailChromeBrand}><i>邮</i> JOTO GTM <span>每日发布结果</span></div><span>{latest.businessDate} · {latest.status === "closed" ? "批次已关闭" : "仍在收集中"}</span></div>
          <article className={styles.mailBody}>
            <header className={styles.mailMeta}><h2>今日计划 {latest.plannedCount} 篇，已获得 {latest.publishedCount} 个公开结果</h2><div className={styles.mailSender}><span className={styles.senderAvatar}>J</span><div><strong>JOTO GTM · 自动结果通知</strong><span>每个当日批次只发送一次</span></div></div></header>
            <div className={styles.mailConclusion}><strong>{latest.status === "closed" ? <CheckCircleFilled /> : <ClockCircleOutlined />} 先看结论</strong><p>已发布 {latest.publishedCount} 篇，平台审核或顺延 {latest.pendingCount} 篇，未完成 {latest.failedCount} 篇。系统只把完成初次可访问检查的地址计为公开 URL。</p></div>
            <section className={styles.mailSection}><h3>公开结果与状态</h3><div className={styles.resultList}>{latest.results.map((result) => <div className={styles.resultRow} key={result.taskId}><div className={styles.resultIdentity}><strong>{result.title}</strong><span>{result.publishedAt ? new Date(result.publishedAt).toLocaleString("zh-CN") : resultLabels[result.status]}</span></div><span className={styles.resultChannel}>{channelLabels[result.channel] || result.channel}</span>{result.publicUrl ? <a className={styles.resultLink} href={result.publicUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 查看公开文章</a> : <span className={styles.resultState}>{resultLabels[result.status]}</span>}</div>)}</div></section>
            <footer className={styles.mailFooter}>平台审核中的内容会继续由系统跟踪；没有需要你判断的异常时，不会追加操作邮件。</footer>
          </article>
        </section>
      ) : null}
    </div>
  );
}
