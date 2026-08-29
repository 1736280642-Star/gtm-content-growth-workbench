"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  EditOutlined,
  SaveOutlined,
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
  articleDirections: Array<{ portfolioItemId: string; name: string; direction: string }>;
  prohibitedClaims: string[];
}

interface ReviewPayload {
  review: { gateType: "strategy" | "sample"; status: string; expiresAt: string; decision?: string; comment?: string };
  order: { orderId: string; productName: string };
  strategy?: { strategyVersion: number; rowVersion: number; summary: StrategySummary };
  sample?: { title: string; markdown: string; copyAllowed: boolean; articleTypeName: string; channel: string };
}

const channelLabels: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };

type EditableStrategy = Omit<StrategySummary, "channels">;

function editableStrategy(strategy: ReviewPayload["strategy"]): EditableStrategy | undefined {
  if (!strategy) return undefined;
  const { channels: _channels, ...editable } = strategy.summary;
  return editable;
}

function lines(value: string) {
  return value.split(/\r?\n/);
}

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
  const [saving, setSaving] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [comment, setComment] = useState("");
  const [strategyDraft, setStrategyDraft] = useState<EditableStrategy>();
  const [savedStrategyDraft, setSavedStrategyDraft] = useState<EditableStrategy>();
  const [error, setError] = useState<string>();
  const [saveMessage, setSaveMessage] = useState<string>();
  const [completedMessage, setCompletedMessage] = useState<string>();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/reviews/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "审核内容读取失败。"));
      const next = payload as ReviewPayload;
      const editable = editableStrategy(next.strategy);
      setData(next);
      setStrategyDraft(editable);
      setSavedStrategyDraft(editable);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核内容读取失败。请使用最新邮件链接重试。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function saveStrategy() {
    if (!token || !data?.strategy || !strategyDraft) return;
    setSaving(true);
    setError(undefined);
    setSaveMessage(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/reviews/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: data.strategy.rowVersion, edit: strategyDraft })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "策略保存失败。"));
      const strategy = payload.strategy as ReviewPayload["strategy"];
      const editable = editableStrategy(strategy);
      setData((current) => current ? { ...current, strategy } : current);
      setStrategyDraft(editable);
      setSavedStrategyDraft(editable);
      setSaveMessage("人工修改已写入当前候选策略，没有重新调研或调用模型。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "策略保存失败，请刷新后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function decide(decision: "approve" | "changes_requested") {
    if (data?.review.gateType === "strategy" && decision === "approve"
      && JSON.stringify(strategyDraft) !== JSON.stringify(savedStrategyDraft)) {
      return setError("还有未保存的策略修改，请先点击“保存人工修改”。");
    }
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
            <div className={styles.decisionHeader}><span>直接修改策略文字</span><small>保存只更新当前候选策略，不会重新调研</small></div>
            {strategyDraft ? <>
              <section className={styles.decisionSection}>
                <h2>推广目标</h2>
                <Input.TextArea value={strategyDraft.promotionPurpose} rows={4} maxLength={1000} showCount onChange={(event) => setStrategyDraft((current) => current ? { ...current, promotionPurpose: event.target.value } : current)} />
              </section>
              <section className={styles.decisionSection}>
                <h2>主要面向</h2>
                <small className={styles.editHint}>每行填写一个目标用户</small>
                <Input.TextArea value={strategyDraft.targetAudience.join("\n")} rows={4} maxLength={2000} onChange={(event) => setStrategyDraft((current) => current ? { ...current, targetAudience: lines(event.target.value) } : current)} />
              </section>
              <section className={styles.decisionSection}>
                <h2>重点表达</h2>
                <small className={styles.editHint}>每行填写一条，保存后会进入样文生成约束</small>
                <Input.TextArea value={strategyDraft.keyMessages.join("\n")} rows={7} maxLength={6000} onChange={(event) => setStrategyDraft((current) => current ? { ...current, keyMessages: lines(event.target.value) } : current)} />
              </section>
              <section className={styles.decisionSection}>
                <h2>内容方向</h2>
                <div className={styles.directionEditorList}>{strategyDraft.articleDirections.map((item) => <article key={item.portfolioItemId}>
                  <label>方向名称</label>
                  <Input value={item.name} maxLength={120} onChange={(event) => setStrategyDraft((current) => current ? { ...current, articleDirections: current.articleDirections.map((direction) => direction.portfolioItemId === item.portfolioItemId ? { ...direction, name: event.target.value } : direction) } : current)} />
                  <label>写作方向</label>
                  <Input.TextArea value={item.direction} rows={4} maxLength={1200} showCount onChange={(event) => setStrategyDraft((current) => current ? { ...current, articleDirections: current.articleDirections.map((direction) => direction.portfolioItemId === item.portfolioItemId ? { ...direction, direction: event.target.value } : direction) } : current)} />
                </article>)}</div>
              </section>
              <section className={styles.decisionSection}>
                <h2>禁止表述</h2>
                <small className={styles.editHint}>每行填写一条；可以留空</small>
                <Input.TextArea value={strategyDraft.prohibitedClaims.join("\n")} rows={5} maxLength={10000} onChange={(event) => setStrategyDraft((current) => current ? { ...current, prohibitedClaims: lines(event.target.value) } : current)} />
              </section>
            </> : null}
            <section className={styles.decisionSection}><h2>推广渠道</h2><div className={styles.reviewTags}>{data.strategy.summary.channels.map((item) => <span key={item}>{channelLabels[item] || item}</span>)}</div></section>
          </main>
          <aside className={styles.decisionAside}><strong>保存与确认分开</strong><span>“保存人工修改”只更新文字。</span><span>“确认策略”才会进入样文生成。</span><span>推广渠道请在托管设置中调整。</span></aside>
        </div>
      ) : null}

      {!isStrategy && data.sample ? (
        <div className={styles.sampleReviewGrid}>
          <main className={styles.samplePaper}><div className={styles.sampleMeta}><span>{channelLabels[data.sample.channel] || data.sample.channel}</span><span>{data.sample.articleTypeName}</span></div><h2>{data.sample.title}</h2><article>{data.sample.markdown}</article></main>
          <aside className={styles.decisionAside}><strong>重点检查三件事</strong><span>产品事实是否准确。</span><span>语气是否可以长期复用。</span><span>是否存在不希望公开的表述。</span></aside>
        </div>
      ) : null}

      {showRevision ? <div className={styles.revisionBox}><label>{isStrategy ? "只有需要补充资料或重新调研时才使用这里" : "用一句话说明希望怎么改"}</label><Input.TextArea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} maxLength={1000} showCount placeholder={isStrategy ? "例如：现有资料不足，请补充目标行业案例后重新调研。普通文字修改请直接在上方编辑并保存。" : "例如：减少宣传语气，增加具体使用场景和限制说明。"} /></div> : null}
      {saveMessage ? <div className={styles.strategySaveSuccess} role="status"><CheckCircleFilled /><span>{saveMessage}</span></div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>暂时不能提交</strong><span>{error}</span></div> : null}
      <div className={styles.reviewActions}>
        {isStrategy ? <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} disabled={JSON.stringify(strategyDraft) === JSON.stringify(savedStrategyDraft)} onClick={() => void saveStrategy()}>保存人工修改</Button> : null}
        <Button type={isStrategy ? "default" : "primary"} size="large" icon={<CheckOutlined />} loading={submitting} disabled={isStrategy && JSON.stringify(strategyDraft) !== JSON.stringify(savedStrategyDraft)} onClick={() => decide("approve")}>{isStrategy ? "确认策略，生成样文" : "确认样文，开始托管"}</Button>
        {showRevision ? <Button size="large" icon={<EditOutlined />} loading={submitting} onClick={() => decide("changes_requested")}>{isStrategy ? "提交并重新调研" : "提交修改意见"}</Button> : <Button size="large" icon={<EditOutlined />} onClick={() => setShowRevision(true)}>{isStrategy ? "需要重新调研" : "需要修改"}</Button>}
      </div>
    </div>
  );
}
