"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  EditOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Button, Input, Spin } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import styles from "../../../hosted-mode.module.css";

interface StrategySummary {
  targetAudience: string[];
  promotionPurpose: string;
  keyMessages: string[];
  channels: string[];
  articleDirections: Array<{ name: string; reason: string }>;
  prohibitedClaims: string[];
}

interface ReviewPayload {
  review: { gateType: "strategy" | "sample"; status: string; expiresAt: string; decision?: string; comment?: string };
  order: { orderId: string; productName: string };
  strategy?: { strategyVersion: number; summary: StrategySummary };
  sample?: { title: string; markdown: string; copyAllowed: boolean; articleTypeName: string; channel: string };
}

const channelLabels: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedReviewPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [data, setData] = useState<ReviewPayload>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const [completedMessage, setCompletedMessage] = useState<string>();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/reviews/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "审核内容读取失败。"));
      setData(payload as ReviewPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核内容读取失败。请使用最新邮件链接重试。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function decide(decision: "approve" | "changes_requested") {
    if (decision === "changes_requested" && !comment.trim()) return setError("请用一句话写下希望修改的地方。");
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/reviews/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, comment: comment.trim() || undefined })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "审核决定提交失败。"));
      const strategy = data?.review.gateType === "strategy";
      setCompletedMessage(decision === "approve"
        ? strategy ? "策略已确认。系统正在生成代表样文，完成后会继续通过邮件联系你。" : "样文已确认。系统已经进入托管发布状态。"
        : strategy ? "修改意见已保存。系统会重新整理推广策略。" : "修改意见已保存。新样文生成后会发送新的确认邮件。"
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核决定提交失败。请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在打开你的唯一待办</span></div>;
  if (!data || error && !data) return <div className={styles.reviewError}><strong>无法打开这项审核</strong><span>{error}</span><Button onClick={load}>重新读取</Button></div>;
  if (completedMessage || data.review.status === "acted") {
    return <div className={styles.reviewComplete}><CheckCircleFilled /><div className={styles.kicker}>DECISION RECORDED</div><h1>这项确认已经完成。</h1><p>{completedMessage || "系统已记录你的决定，并会从当前阶段继续。"}</p><Link href={`/hosted/success?orderId=${encodeURIComponent(data.order.orderId)}`}><Button type="primary" icon={<ArrowRightOutlined />}>查看托管状态</Button></Link></div>;
  }

  const isStrategy = data.review.gateType === "strategy";
  return (
    <div className={styles.reviewPage}>
      <section className={styles.reviewHero}>
        <div><div className={styles.kicker}>ONE DECISION · {isStrategy ? "STRATEGY" : "SAMPLE"}</div><h1>{isStrategy ? `确认 ${data.order.productName} 的推广方向` : `确认 ${data.order.productName} 的代表样文`}</h1><p>{isStrategy ? "只检查系统是否理解了产品、用户和推广边界。具体排程与指标不需要你处理。" : "只检查这篇文章是否符合你希望系统持续使用的表达方式。"}</p></div>
        <aside><SafetyCertificateOutlined /><strong>安全邮件链接</strong><span><ClockCircleOutlined /> {new Date(data.review.expiresAt).toLocaleString("zh-CN")} 前有效</span></aside>
      </section>

      {isStrategy && data.strategy ? (
        <div className={styles.reviewGrid}>
          <main className={styles.decisionCard}>
            <div className={styles.decisionHeader}><span>系统准备这样推广</span><small>确认后生成一篇代表样文</small></div>
            <section className={styles.decisionSection}><h2>推广目标</h2><p>{data.strategy.summary.promotionPurpose}</p></section>
            <section className={styles.decisionSection}><h2>主要面向</h2><div className={styles.reviewTags}>{data.strategy.summary.targetAudience.map((item) => <span key={item}>{item}</span>)}</div></section>
            <section className={styles.decisionSection}><h2>重点表达</h2><ul>{data.strategy.summary.keyMessages.map((item) => <li key={item}><CheckOutlined /> {item}</li>)}</ul></section>
            <section className={styles.decisionSection}><h2>内容方向</h2><div className={styles.directionList}>{data.strategy.summary.articleDirections.map((item) => <article key={item.name}><strong>{item.name}</strong><span>{item.reason}</span></article>)}</div></section>
            <section className={styles.decisionSection}><h2>推广渠道</h2><div className={styles.reviewTags}>{data.strategy.summary.channels.map((item) => <span key={item}>{channelLabels[item] || item}</span>)}</div></section>
            {data.strategy.summary.prohibitedClaims.length ? <details className={styles.reviewDetails}><summary>查看系统明确不会使用的表述</summary><ul>{data.strategy.summary.prohibitedClaims.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
          </main>
          <aside className={styles.decisionAside}><strong>你只需要判断</strong><span>目标用户是否正确？</span><span>重点表达是否符合产品？</span><span>有没有不能公开说的内容？</span></aside>
        </div>
      ) : null}

      {!isStrategy && data.sample ? (
        <div className={styles.sampleReviewGrid}>
          <main className={styles.samplePaper}><div className={styles.sampleMeta}><span>{channelLabels[data.sample.channel] || data.sample.channel}</span><span>{data.sample.articleTypeName}</span></div><h2>{data.sample.title}</h2><article>{data.sample.markdown}</article></main>
          <aside className={styles.decisionAside}><strong>重点检查三件事</strong><span>产品事实是否准确。</span><span>语气是否可以长期复用。</span><span>是否存在不希望公开的表述。</span></aside>
        </div>
      ) : null}

      {showRevision ? <div className={styles.revisionBox}><label>用一句话说明希望怎么改</label><Input.TextArea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} maxLength={1200} showCount placeholder={isStrategy ? "例如：目标用户应优先面向企业技术负责人，不要突出个人用户。" : "例如：减少宣传语气，增加具体使用场景和限制说明。"} /></div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>暂时不能提交</strong><span>{error}</span></div> : null}
      <div className={styles.reviewActions}>
        <Button type="primary" size="large" icon={<CheckOutlined />} loading={submitting} onClick={() => decide("approve")}>{isStrategy ? "确认策略，生成样文" : "确认样文，开始托管"}</Button>
        {showRevision ? <Button size="large" icon={<EditOutlined />} loading={submitting} onClick={() => decide("changes_requested")}>提交修改意见</Button> : <Button size="large" icon={<EditOutlined />} onClick={() => setShowRevision(true)}>需要修改</Button>}
      </div>
    </div>
  );
}
