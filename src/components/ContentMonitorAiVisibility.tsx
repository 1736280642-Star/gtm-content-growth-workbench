"use client";

import { Alert, Empty, Progress, Space, Spin, Table, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeoMonitoringWorkspace, GeoQuestionMetric } from "@/lib/v5/geo-monitoring-contracts";
import type { MonthlyReview } from "@/lib/v5/monthly-review-contracts";
import type { SiteAuditWorkspace } from "@/lib/v5/site-audit-contracts";
import type { ProductGeoOptimizationWorkspace } from "@/lib/v5/product-geo-optimization-contracts";
import styles from "@/app/geo-monitor/page.module.css";

type Aggregate = { successful: number; total: number; mentions: number; owned: number; citations: number; categoryRuns: number; categoryIncluded: number; relationshipObserved: number; relationshipAccurate: number; targetSolutionRuns: number; targetPageCited: number; brandRate: number | null; ownedRate: number | null; categoryInclusionRate: number | null; relationshipAccuracyRate: number | null; targetSolutionCitationRate: number | null; citationSov: number | null; failureRate: number | null; sampleStatus: "insufficient" | "directional" | "reliable" };

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function aggregate(metrics: GeoQuestionMetric[]): Aggregate {
  const result = metrics.reduce((acc, item) => ({
    successful: acc.successful + item.successfulRuns, total: acc.total + item.totalRuns,
    mentions: acc.mentions + item.brandMentionCount, owned: acc.owned + item.ownedCitationCount,
    citations: acc.citations + item.totalCitationCount,
    categoryRuns: acc.categoryRuns + (item.categoryInclusionRate === null ? 0 : item.successfulRuns),
    categoryIncluded: acc.categoryIncluded + item.categoryInclusionCount,
    relationshipObserved: acc.relationshipObserved + (item.relationshipAccuracyRate === null ? 0 : item.brandMentionCount),
    relationshipAccurate: acc.relationshipAccurate + item.relationshipAccurateCount,
    targetSolutionRuns: acc.targetSolutionRuns + (item.targetSolutionCitationRate === null ? 0 : item.successfulRuns),
    targetPageCited: acc.targetPageCited + item.targetSolutionCitationCount
  }), { successful: 0, total: 0, mentions: 0, owned: 0, citations: 0, categoryRuns: 0, categoryIncluded: 0, relationshipObserved: 0, relationshipAccurate: 0, targetSolutionRuns: 0, targetPageCited: 0 });
  return {
    ...result,
    brandRate: result.successful ? result.mentions / result.successful : null,
    ownedRate: result.successful ? result.owned / result.successful : null,
    categoryInclusionRate: result.categoryRuns ? result.categoryIncluded / result.categoryRuns : null,
    relationshipAccuracyRate: result.relationshipObserved ? result.relationshipAccurate / result.relationshipObserved : null,
    targetSolutionCitationRate: result.targetSolutionRuns ? result.targetPageCited / result.targetSolutionRuns : null,
    citationSov: result.citations ? result.owned / result.citations : null,
    failureRate: result.total ? (result.total - result.successful) / result.total : null,
    sampleStatus: result.successful >= 30 ? "reliable" : result.successful >= 10 ? "directional" : "insufficient"
  };
}
function percent(value: number | null) { return value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`; }
function delta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return "尚无可比样本";
  const value = (current - previous) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} 个百分点`;
}

export function ContentMonitorAiVisibility({ month, review, compact = false }: { month: string; review?: MonthlyReview; compact?: boolean }) {
  const [current, setCurrent] = useState<GeoMonitoringWorkspace>();
  const [previous, setPrevious] = useState<GeoMonitoringWorkspace>();
  const [site, setSite] = useState<SiteAuditWorkspace>();
  const [optimizations, setOptimizations] = useState<ProductGeoOptimizationWorkspace>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const [currentResponse, previousResponse, siteResponse, optimizationResponse] = await Promise.all([
        fetch(`/api/v5/geo-monitoring-questions?month=${month}`, { cache: "no-store" }),
        fetch(`/api/v5/geo-monitoring-questions?month=${previousMonth(month)}`, { cache: "no-store" }),
        fetch("/api/v5/site-audits", { cache: "no-store" }),
        fetch("/api/v5/content-monitor/product-optimizations", { cache: "no-store" })
      ]);
      const [currentBody, previousBody, siteBody, optimizationBody] = await Promise.all([currentResponse.json(), previousResponse.json(), siteResponse.json(), optimizationResponse.json()]);
      if (!currentResponse.ok) throw new Error(currentBody.error?.message || "AI 可见性数据读取失败。");
      setCurrent(currentBody.data); setPrevious(previousResponse.ok ? previousBody.data : undefined); setSite(siteResponse.ok ? siteBody.data : undefined);
      setOptimizations(optimizationResponse.ok ? optimizationBody.data : undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 可见性数据读取失败。"); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void refresh(); }, [refresh]);
  const now = useMemo(() => aggregate(current?.metrics || []), [current?.metrics]);
  const before = useMemo(() => aggregate(previous?.metrics || []), [previous?.metrics]);
  const readiness = site?.score ?? review?.siteMonitoring.coreReadinessScore ?? null;
  const cards = [
    { key: "mention", label: "AI 目标提及率", value: percent(now.brandRate), change: delta(now.brandRate, before.brandRate), note: `${now.mentions}/${now.successful} 次有效回答` },
    { key: "enumeration", label: "服务商枚举进入率", value: percent(now.categoryInclusionRate), change: delta(now.categoryInclusionRate, before.categoryInclusionRate), note: now.relationshipAccuracyRate === null ? "尚无关系准确度样本" : `关系准确率 ${percent(now.relationshipAccuracyRate)}` },
    { key: "owned", label: "官网引用率", value: percent(now.ownedRate), change: delta(now.ownedRate, before.ownedRate), note: `${now.owned}/${now.successful} 次有效回答` },
    { key: "readiness", label: "官网核心准备度", value: readiness === null ? "待审计" : `${readiness.toFixed(1)}`, change: `${review?.siteMonitoring.resolvedFindingCount || 0} 项本月已解决`, note: "确定性页面审计，不由模型打分" }
  ];

  if (loading && !current) return <section className={styles.aiPanel}><div className={styles.loadingState}><Spin /><span>正在汇总 AI 可见性证据</span></div></section>;
  return <section className={styles.aiPanel}>
    <div className={styles.subheading}><div><span className={styles.eyebrow}>AI VISIBILITY / MONTHLY</span><h3>AI 可见性与优化效果</h3><p>官网审计和真实 AI 前台采集平行运行；变化只表达相关性，不自动归因为内容发布。</p></div><Tag color={now.sampleStatus === "reliable" ? "green" : now.sampleStatus === "directional" ? "blue" : "gold"}>{now.sampleStatus === "reliable" ? "可稳定判断" : now.sampleStatus === "directional" ? "仅方向性" : "样本不足"}</Tag></div>
    {error ? <Alert showIcon type="warning" message={error} /> : null}
    <div className={styles.aiMetricGrid}>{cards.map((item) => <article key={item.key}><span>{item.label}</span><strong>{item.value}</strong><em>{item.change}</em><small>{item.note}</small></article>)}</div>
    {!compact ? <>
      <div className={styles.aiEvidenceGrid}>
        <div><strong>自有引用份额</strong><Progress percent={Math.round((now.citationSov || 0) * 100)} strokeColor="#ef6843" /><span>自有域名引用 / 全部引用；当前 {percent(now.citationSov)}</span></div>
        <div><strong>回答采集成功率</strong><Progress percent={Math.round((1 - (now.failureRate || 0)) * 100)} strokeColor="#188260" /><span>{now.successful}/{now.total} 次采集成功；失败率 {percent(now.failureRate)}</span></div>
      </div>
      <Table rowKey="id" size="small" pagination={false} dataSource={review?.questions.filter((item) => item.geoMonitoringApproved) || []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="积累真实发布与 AI 回测数据后生成优化证据" /> }} columns={[
        { title: "监控问题", dataIndex: "questionText", ellipsis: true },
        { title: "内容证据", render: (_, row) => `${row.publishedContent.length} 篇已发布 · ${row.captureTaskIds.length} 次回测` },
        { title: "可见性结果", render: (_, row) => row.geoMetric ? `提及 ${percent(row.geoMetric.brandMentionRate)} · 枚举 ${percent(row.geoMetric.categoryInclusionRate)} · 目标页引用 ${percent(row.geoMetric.targetSolutionCitationRate)}` : "样本不足" },
        { title: "观察结论", dataIndex: "crossLineObservation", render: (value?: string) => value || "继续平行观察，暂不归因" },
        { title: "观察建议", dataIndex: "recommendation" },
        { title: "证据", dataIndex: "dataStatus", render: (value) => <Tag color={value === "complete" ? "green" : "gold"}>{value === "complete" ? "完整" : "待补齐"}</Tag> }
      ]} />
      <div className={styles.subheading}><div><span className={styles.eyebrow}>NEXT BATCH / PRODUCT</span><h3>产品下批优化方案</h3><p>每个发布批次完成存活观察与 AI 复测后即时判因；这里只形成候选，不新增计划入口。</p></div></div>
      <Table rowKey="id" size="small" pagination={false} dataSource={optimizations?.products || []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发布批次闭环后自动形成产品级下批方案" /> }} columns={[
        { title: "产品 / 批次", render: (_, row) => <><strong>{row.productName}</strong><br /><span>{row.month} · {row.batchClosed ? "已闭环" : "监控中"}</span></> },
        { title: "官网状态", render: (_, row) => <Tag color={row.websiteReadiness === "ready" ? "green" : row.websiteReadiness === "blocked" ? "red" : "gold"}>{row.websiteReadiness}</Tag> },
        { title: "关键指标", render: (_, row) => `枚举 ${percent(row.signals.targetMentionRate)} · 官网引用 ${percent(row.signals.ownedCitationRate)} · 关系准确 ${percent(row.signals.relationshipAccuracyRate)}` },
        { title: "下批动作", render: (_, row) => <Space direction="vertical" size={2}>{row.actions.map((item) => <span key={`${item.action}:${item.title}`}><Tag color={item.priority === "P0" ? "red" : item.priority === "P1" ? "orange" : "blue"}>{item.priority}</Tag>{item.title}</span>)}</Space> },
        { title: "进入计划", render: (_, row) => row.actions.some((item) => item.candidateDestination !== "none") ? <Tag color="blue">候选池，待 MonthlyPlan 确认</Tag> : <Tag>无需新增文章</Tag> }
      ]} />
      <Space wrap className={styles.proposalStrip}><strong>规则边界：</strong><Tag>官网阻断优先修复</Tag><Tag>已有页面优先刷新</Tag><Tag>证据不足禁止生成</Tag><Tag>不自动改 MonthlyPlan 配额</Tag></Space>
    </> : null}
  </section>;
}
