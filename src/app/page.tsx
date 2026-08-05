"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloudUploadOutlined,
  ExclamationCircleFilled,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublishSchedule, PublishScheduleStatus } from "@/lib/types";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { MonthlyWorkspaceReadModel, ProductionMatrixTask, ProductionTaskStatus } from "@/lib/v5/monthly-workspace-contracts";
import styles from "./workbench-home.module.css";

type PulseStatus = "healthy" | "running" | "attention" | "waiting";

interface AutomationStatusResponse {
  ok: boolean;
  status?: string;
  data?: {
    month: string;
    items: Array<{ key: string; label: string; status: PulseStatus; detail?: string }>;
    message?: string;
  };
}

interface WorkspaceResponse {
  ok: boolean;
  data?: MonthlyWorkspaceReadModel;
  error?: { message?: string };
}

interface DashboardSummary {
  period: { monthStart: string; monthEnd: string };
  metrics: { targetTotal: number; generated: number; approved: number; published: number; pendingUrl: number; aiBotPv: number };
  dataSource: string;
}

interface PublishJobsResponse {
  jobs?: Array<{ schedule: PublishSchedule }>;
}

interface ProductsResponse {
  ok: boolean;
  products?: ProductRegistryItem[];
}

interface HomeState {
  workspace?: MonthlyWorkspaceReadModel;
  automation?: AutomationStatusResponse["data"];
  dashboard?: DashboardSummary;
  publishJobs: Array<{ schedule: PublishSchedule }>;
  products: ProductRegistryItem[];
}

const initialState: HomeState = { publishJobs: [], products: [] };

const taskStatusLabels: Record<ProductionTaskStatus, string> = {
  ready_for_generation: "待生成",
  generating: "生成中",
  available: "已成稿",
  awaiting_material: "待补资料",
  system_recovering: "系统恢复中",
  scheduled: "已排程",
  published: "已发布"
};

const attentionPublishStatuses = new Set<PublishScheduleStatus>([
  "precheck_failed",
  "platform_rejected",
  "removed_after_publish",
  "risk_blocked",
  "verification_timeout",
  "auth_expired",
  "failed",
  "manual_takeover_required",
  "pending_config"
]);

const publicPublishStatuses = new Set<PublishScheduleStatus>(["public_observed", "stable_published"]);

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || payload?.message || `读取失败 (${response.status})`);
  return payload as T;
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function normalizeProductKey(value?: string) {
  return (value || "").normalize("NFKC").toLowerCase().replace(/[\s·×_\-—–/\\|()（）]+/g, "");
}

function formatUpdatedAt(value?: string) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export default function WorkbenchHomePage() {
  const month = currentMonth();
  const [state, setState] = useState<HomeState>(initialState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<string>();

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    const results = await Promise.allSettled([
      readJson<WorkspaceResponse>(`/api/v5/monthly-workspace?month=${encodeURIComponent(month)}&projection=compact`),
      readJson<AutomationStatusResponse>(`/api/v5/automation/status?month=${encodeURIComponent(month)}`),
      readJson<DashboardSummary>("/api/dashboard/summary"),
      readJson<PublishJobsResponse>("/api/publish-jobs"),
      readJson<ProductsResponse>("/api/v5/products")
    ]);

    const failures = results.filter((item) => item.status === "rejected");
    setState((current) => ({
      workspace: results[0].status === "fulfilled" ? results[0].value.data : current.workspace,
      automation: results[1].status === "fulfilled" ? results[1].value.data : current.automation,
      dashboard: results[2].status === "fulfilled" ? results[2].value : current.dashboard,
      publishJobs: results[3].status === "fulfilled" ? results[3].value.jobs || [] : current.publishJobs,
      products: results[4].status === "fulfilled" ? results[4].value.products || [] : current.products
    }));
    setError(failures.length ? `${failures.length} 个实时数据源暂时不可用，页面已保留最近一次有效数据。` : undefined);
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
    setRefreshing(false);
  }, [month]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const derived = useMemo(() => {
    const workspace = state.workspace;
    const tasks = workspace?.productionTasks || [];
    const target = workspace?.strategyPackage?.targetDeliverableCount || workspace?.draftPlan.targetDeliverableCount || tasks.length;
    const allocated = (workspace?.draftPlan.quotaRules || []).reduce((sum, item) => sum + item.expandedDeliverableCount, 0);
    const readyKnowledge = workspace?.knowledgeBases.filter((item) => item.status === "ready").length || 0;
    const totalKnowledge = workspace?.knowledgeBases.length || 0;
    const questions = workspace?.targetQuestions.length || 0;
    const produced = tasks.filter((item) => ["available", "scheduled", "published"].includes(item.status)).length;
    const scheduled = tasks.filter((item) => ["scheduled", "published"].includes(item.status)).length;
    const published = tasks.filter((item) => item.status === "published").length;
    const blockedTasks = tasks.filter((item) => item.status === "awaiting_material" || item.status === "system_recovering");
    const openExceptions = workspace?.exceptionItems.filter((item) => item.status === "open") || [];
    const publishAttention = state.publishJobs.filter((item) => attentionPublishStatuses.has(item.schedule.status));
    const publicJobs = state.publishJobs.filter((item) => publicPublishStatuses.has(item.schedule.status)).length;
    const statusByKey = Object.fromEntries((state.automation?.items || []).map((item) => [item.key, item])) as Record<string, { status?: PulseStatus; detail?: string }>;

    const stages = [
      { key: "knowledge", label: "产品与资料", metric: `${readyKnowledge}/${totalKnowledge || 0} 个可用`, helper: "资料快照", progress: percent(readyKnowledge, totalKnowledge), href: "/products" },
      { key: "research", label: "GEO 调研", metric: `${questions} 个问题`, helper: "真实问题与关键词", progress: questions ? 100 : 0, href: "/products" },
      { key: "strategy", label: "月度策略", metric: `${allocated}/${target || 0} 篇`, helper: "渠道配额已分配", progress: percent(allocated, target), href: "/monthly-plan?step=strategy" },
      { key: "production", label: "文章任务编排", metric: `${produced}/${tasks.length} 篇`, helper: "系统按产品自动推进", progress: percent(produced, tasks.length), href: "/monthly-plan?step=production" },
      { key: "schedule", label: "自动排程", metric: `${scheduled}/${tasks.length} 篇`, helper: "已绑定发布时间", progress: percent(scheduled, tasks.length), href: "/monthly-plan?step=execution&view=schedule" },
      { key: "publishing", label: "发布回传", metric: `${publicJobs} 个公开结果`, helper: `${state.publishJobs.length} 个发布任务`, progress: percent(publicJobs, state.publishJobs.length), href: "/geo-monitor?tab=publishing" },
      { key: "review", label: "数据复盘", metric: `${state.dashboard?.metrics.aiBotPv || 0} AI 访问`, helper: `${published} 篇进入复盘`, progress: percent(published, target), href: "/geo-monitor?tab=review" }
    ].map((item) => ({ ...item, status: statusByKey[item.key]?.status || "waiting", detail: statusByKey[item.key]?.detail }));

    const productionBreakdown = (["ready_for_generation", "generating", "available", "scheduled", "published", "awaiting_material", "system_recovering"] as ProductionTaskStatus[])
      .map((status) => ({ status, label: taskStatusLabels[status], count: tasks.filter((item) => item.status === status).length }))
      .filter((item) => item.count > 0);

    const packageByVersion = new Map((workspace?.rulePackages || []).map((item) => [item.id, item]));
    const questionProduct = new Map((workspace?.targetQuestions || []).map((item) => [item.questionVersionId, item.productId]));
    const productGroupMap = new Map<string, { productId: string; productName: string; tasks: ProductionMatrixTask[] }>();
    const productByAlias = new Map<string, ProductRegistryItem>();
    for (const product of state.products) {
      productGroupMap.set(product.productId, { productId: product.productId, productName: product.displayName, tasks: [] });
      for (const alias of [product.productId, product.displayName, product.canonicalName, product.officialEntity, ...(product.aliases || [])]) {
        const key = normalizeProductKey(alias);
        if (key) productByAlias.set(key, product);
      }
    }
    for (const task of tasks) {
      const rulePackage = packageByVersion.get(task.rulePackageVersionId);
      const candidates = [task.productId, task.productNameSnapshot, rulePackage?.productId, rulePackage?.productName, questionProduct.get(task.questionVersionId)];
      const registryProduct = candidates.map((value) => productByAlias.get(normalizeProductKey(value))).find(Boolean);
      const productId = registryProduct?.productId || task.productId || rulePackage?.productId || questionProduct.get(task.questionVersionId) || "unassigned";
      const productName = registryProduct?.displayName || task.productNameSnapshot || rulePackage?.productName || (productId === "unassigned" ? "待确认产品" : productId);
      const group = productGroupMap.get(productId) || { productId, productName, tasks: [] };
      group.tasks.push(task);
      productGroupMap.set(productId, group);
    }
    const productProduction = Array.from(productGroupMap.values()).map((group) => {
      const productProduced = group.tasks.filter((item) => ["available", "scheduled", "published"].includes(item.status)).length;
      const productScheduled = group.tasks.filter((item) => ["scheduled", "published"].includes(item.status)).length;
      const productPublished = group.tasks.filter((item) => item.status === "published").length;
      const taskIssues = group.tasks.filter((item) => item.status === "awaiting_material" || item.status === "system_recovering" || item.ctaValidationStatus === "failed").length;
      const exceptionIssues = openExceptions.filter((item) => {
        const registryProduct = productByAlias.get(normalizeProductKey(item.productId)) || productByAlias.get(normalizeProductKey(item.product));
        return (registryProduct?.productId || item.productId) === group.productId;
      }).length;
      const issueCount = taskIssues + exceptionIssues;
      const total = group.tasks.length;
      const stateRank = issueCount ? 0 : total && productPublished < total ? 1 : total ? 2 : 3;
      return { ...group, total, produced: productProduced, scheduled: productScheduled, published: productPublished, issueCount, stateRank };
    }).sort((left, right) => left.stateRank - right.stateRank || right.total - left.total || left.productName.localeCompare(right.productName, "zh-CN"));

    const attentionItems = [
      ...openExceptions.map((item) => ({ id: item.id, title: item.title || item.distilledTerm, reason: item.reason, nextAction: item.nextAction, href: "/monthly-plan?step=production" })),
      ...blockedTasks.map((item) => ({ id: item.taskId, title: item.title, reason: item.failureReason || taskStatusLabels[item.status], nextAction: item.status === "awaiting_material" ? "补充关键资料" : "等待系统恢复", href: "/monthly-plan?step=production" })),
      ...publishAttention.map((item) => ({ id: item.schedule.id, title: `${item.schedule.platform.toUpperCase()} 发布任务`, reason: item.schedule.failureReason || "发布链路需要处理", nextAction: item.schedule.nextAction || "查看发布状态", href: "/geo-monitor?tab=publishing" }))
    ].slice(0, 5);

    const recentTasks = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    return { target, allocated, readyKnowledge, questions, tasks, produced, scheduled, published, stages, productionBreakdown, productProduction, attentionItems, recentTasks };
  }, [state]);

  const initialLoading = loading && !state.workspace;

  const activeCount = derived.stages.filter((item) => item.status === "running").length;
  const attentionCount = derived.attentionItems.length;

  return (
    <div className={styles.home}>
      <section className={styles.hero} aria-labelledby="workbench-home-title">
        <div>
          <div className={styles.eyebrow}><span className={styles.liveDot} />LIVE WORKSPACE · {month}</div>
          <h1 id="workbench-home-title">GEO 内容正在自动流转</h1>
          <p>首页集中呈现系统进度与关键数据；进入具体页面时，只处理当前步骤和异常。</p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/products/new"><Button icon={<PlusOutlined />}>绑定产品</Button></Link>
          <Link href="/products"><Button type="primary" icon={<CloudUploadOutlined />}>管理产品资料</Button></Link>
          <Button icon={<ReloadOutlined />} loading={loading || refreshing} onClick={() => void refresh(true)}>刷新</Button>
        </div>
      </section>

      <section className={styles.kpiRibbon} aria-label="本月关键指标">
        {[
          { label: "知识可用", value: derived.readyKnowledge, suffix: "个" },
          { label: "真实问题", value: derived.questions, suffix: "个" },
          { label: "本月目标", value: derived.target, suffix: "篇" },
          { label: "已成稿", value: derived.produced, suffix: "篇" },
          { label: "已排程", value: derived.scheduled, suffix: "篇" },
          { label: "已发布", value: derived.published, suffix: "篇" }
        ].map((item) => (
          <div className={styles.kpiItem} key={item.label}><span>{item.label}</span><strong>{initialLoading ? "—" : item.value}</strong><small>{item.suffix}</small></div>
        ))}
        <div className={`${styles.kpiItem} ${attentionCount ? styles.hasAttention : styles.isClear}`}>
          <span>需人工处理</span><strong>{attentionCount}</strong><small>项</small>
        </div>
      </section>

      {error ? <div className={styles.dataNotice}><ExclamationCircleFilled />{error}</div> : null}

      <section className={styles.flowPanel} aria-label="GEO 自动化实时流程">
        <div className={styles.sectionHeading}>
          <div><span>REAL-TIME FLOW</span><h2>本月自动化流水线</h2></div>
          <div className={styles.liveMeta}><Tag color={attentionCount ? "gold" : "green"}>{attentionCount ? `${attentionCount} 项需处理` : "无需人工介入"}</Tag><span>{activeCount} 个阶段运行中 · 15 秒自动更新 · {formatUpdatedAt(updatedAt)}</span></div>
        </div>
        <div className={styles.flowTrack}>
          {derived.stages.map((stage, index) => (
            <Link className={`${styles.flowStage} ${styles[`status_${stage.status}`]}`} href={stage.href} key={stage.key} title={stage.detail}>
              <div className={styles.stageTop}><span className={styles.stageIndex}>{String(index + 1).padStart(2, "0")}</span><span className={styles.stageStatus}>{stage.status === "healthy" ? "已就绪" : stage.status === "running" ? "运行中" : stage.status === "attention" ? "需处理" : "等待"}</span></div>
              <strong>{stage.label}</strong>
              <b>{initialLoading ? "读取中" : stage.metric}</b>
              <span className={styles.stageHelper}>{stage.helper}</span>
              <span className={styles.progressTrack}><span style={{ width: `${stage.progress}%` }} /></span>
              <ArrowRightOutlined className={styles.stageArrow} />
            </Link>
          ))}
        </div>
      </section>

      <div className={styles.operationsGrid}>
        <section className={styles.panel} aria-label="内容产线进度">
          <div className={styles.sectionHeading}><div><span>CONTENT PIPELINE</span><h2>内容产线</h2></div><Link href="/monthly-plan?step=production">查看全部 <ArrowRightOutlined /></Link></div>
          <div className={styles.pipelineOverview}>
            <div><strong>{initialLoading ? "—" : derived.tasks.length}</strong><span>本月任务</span></div>
            <div><strong>{initialLoading ? "—" : derived.productProduction.filter((item) => item.total > 0).length}</strong><span>生产产品</span></div>
            <div><strong>{initialLoading ? "—" : derived.published}</strong><span>已发布</span></div>
            <div className={attentionCount ? styles.overviewAttention : styles.overviewClear}><strong>{initialLoading ? "—" : attentionCount}</strong><span>待处理</span></div>
          </div>
          <div className={styles.pipelineAutomationMeta}><span className={styles.liveDot} /><strong>自动化运行中</strong><span>系统按产品持续推进正文、排程和发布</span></div>
          <div className={styles.productPipelineGrid}>
            {derived.productProduction.length ? derived.productProduction.slice(0, 6).map((product) => {
              const scheduledOnly = Math.max(0, product.scheduled - product.published);
              const producedOnly = Math.max(0, product.produced - product.scheduled);
              const pending = Math.max(0, product.total - product.produced);
              const statusLabel = product.issueCount ? `${product.issueCount} 项待处理` : !product.total ? "本月暂无任务" : product.published === product.total ? "本月已完成" : "自动运行中";
              const productHref = product.total ? `/monthly-plan?step=production&productId=${encodeURIComponent(product.productId)}` : `/products/${encodeURIComponent(product.productId)}`;
              return (
                <article className={`${styles.productPipelineCard} ${product.issueCount ? styles.productPipelineCardAttention : ""}`} key={product.productId}>
                  <div className={styles.productPipelineHeading}>
                    <div><span>当前产品</span><h3>{product.productName}</h3></div>
                    <Tag color={product.issueCount ? "gold" : product.total ? "success" : "default"}>{statusLabel}</Tag>
                  </div>
                  {product.total ? (
                    <>
                      <div className={styles.productPipelineNumbers}><strong>{product.total} 篇任务</strong><span>{product.published} 篇已发布</span></div>
                      <div className={styles.productPipelineStages}><span>策略已确认</span><i /><span>正文 {product.produced}/{product.total}</span><i /><span>排程 {product.scheduled}/{product.total}</span><i /><span>发布 {product.published}/{product.total}</span></div>
                      <div className={styles.productPipelineBar} aria-label={`${product.productName}任务状态`}>
                        <span className={styles.segmentPublished} style={{ width: `${percent(product.published, product.total)}%` }} />
                        <span className={styles.segmentScheduled} style={{ width: `${percent(scheduledOnly, product.total)}%` }} />
                        <span className={styles.segmentProduced} style={{ width: `${percent(producedOnly, product.total)}%` }} />
                        <span className={product.issueCount ? styles.segmentAttention : styles.segmentPending} style={{ width: `${percent(pending, product.total)}%` }} />
                      </div>
                      <div className={styles.productPipelineLegend}><span><i className={styles.segmentPublished} />已发布 {product.published}</span><span><i className={styles.segmentScheduled} />已排程 {scheduledOnly}</span><span><i className={styles.segmentProduced} />待排程 {producedOnly}</span>{pending ? <span><i className={product.issueCount ? styles.segmentAttention : styles.segmentPending} />继续推进 {pending}</span> : null}</div>
                    </>
                  ) : <p className={styles.productPipelineEmpty}>资料、GEO 调研和策略条件满足后，系统会自动创建文章任务。</p>}
                  <div className={styles.productPipelineFooter}><span>{product.issueCount ? "受影响任务已暂停，等待明确处理" : product.total ? "当前没有需要人工处理的异常" : "尚未进入本月生产计划"}</span><Link href={product.issueCount ? `${productHref}#production-exceptions` : productHref}>{product.issueCount ? "处理异常" : product.total ? "查看任务" : "查看产品资料"} <ArrowRightOutlined /></Link></div>
                </article>
              );
            }) : <p className={styles.emptyText}>创建产品并确认内容策略后，这里会按产品展示生产进程。</p>}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.attentionPanel}`} aria-label="需人工处理">
          <div className={styles.sectionHeading}><div><span>HUMAN IN THE LOOP</span><h2>需你处理</h2></div>{attentionCount ? <Tag color="gold">{attentionCount} 项</Tag> : <CheckCircleFilled className={styles.clearIcon} />}</div>
          {derived.attentionItems.length ? (
            <div className={styles.attentionList}>
              {derived.attentionItems.map((item) => (
                <Link href={item.href} key={item.id}><ExclamationCircleFilled /><div><strong>{item.title}</strong><span>{item.reason}</span><small>{item.nextAction}</small></div><ArrowRightOutlined /></Link>
              ))}
            </div>
          ) : (
            <div className={styles.clearState}><CheckCircleFilled /><strong>当前无需人工介入</strong><span>系统会继续执行调研、生产、排程和回传。</span></div>
          )}
        </section>
      </div>

      <section className={styles.activityPanel} aria-label="最近流转">
        <div className={styles.sectionHeading}><div><span>LIVE ACTIVITY</span><h2>最近流转</h2></div><span>来自当前月度生产任务</span></div>
        <div className={styles.activityList}>
          {derived.recentTasks.length ? derived.recentTasks.map((task: ProductionMatrixTask) => (
            <Link href="/monthly-plan?step=production" key={task.taskId}>
              <span className={`${styles.activityDot} ${styles[`task_${task.status}`]}`} />
              <div><strong>{task.title}</strong><span>{task.channel} · {task.articleTypeNameSnapshot || task.contentType}</span></div>
              <Tag>{taskStatusLabels[task.status]}</Tag><time>{formatUpdatedAt(task.updatedAt)}</time>
            </Link>
          )) : <p className={styles.emptyText}>还没有月度内容任务。系统生成策略和任务后，流转记录会出现在这里。</p>}
        </div>
      </section>
    </div>
  );
}
