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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublishSchedule, PublishScheduleStatus } from "@/lib/types";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { MonthlyWorkspaceReadModel, ProductionMatrixTask, ProductionTaskStatus } from "@/lib/v5/monthly-workspace-contracts";
import { classifyPublishResponsibility, classifyProductionResponsibility, RESPONSIBILITY_LABELS, RESPONSIBILITY_COLORS } from "@/lib/v5/responsibility";
import type { Responsibility, AttentionAlert } from "@/lib/v5/responsibility";
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
  intercepted: "已拦截",
  ready_for_generation: "待生成",
  generating: "生成中",
  available: "已成稿",
  awaiting_material: "待补资料",
  system_recovering: "系统恢复中",
  scheduled: "已排程",
  published: "已发布"
};

// Phase 0: 统一责任模型 — 只有真正需要用户介入的才计入"需你处理"
// system_recovering、awaiting_material 等属于系统自动处理或等待外部结果，不告警用户
const userActionPublishStatuses = new Set<PublishScheduleStatus>([
  "auth_expired",
  "platform_rejected",
  "removed_after_publish",
  "risk_blocked",
  "failed",
  "manual_takeover_required",
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
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
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
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
    const urlReturnedByMatrixItemId = new Set<string>();
    for (const item of state.publishJobs) {
      const schedule = item.schedule;
      if (schedule.matrixItemId && (schedule.publicUrl || schedule.urlStatus === "provisional" || schedule.urlStatus === "stable")) {
        urlReturnedByMatrixItemId.add(schedule.matrixItemId);
      }
    }
    const currentProducts = state.products.length;
    const openExceptions = workspace?.exceptionItems.filter((item) => item.status === "open") || [];

    // Phase 0: 修正责任聚合 — system_recovering、awaiting_material 不再计入"需人工处理"
    // 系统自动恢复中：system_recovering
    const systemRecoveringTasks = tasks.filter((item) => item.status === "system_recovering");
    // 等待外部结果：awaiting_material
    const externalWaitingTasks = tasks.filter((item) => item.status === "awaiting_material");

    // Phase 0: 发布任务责任判定 — 只把真正需要用户操作的状态计入"需你处理"
    const publishUserAction = state.publishJobs.filter((item) => userActionPublishStatuses.has(item.schedule.status));
    const publishSystemRecovering = state.publishJobs.filter((item) => {
      const classification = classifyPublishResponsibility(item.schedule.status);
      return classification.responsibility === "system" && classification.recoveryStatus === "retrying";
    });
    const publicJobs = state.publishJobs.filter((item) => publicPublishStatuses.has(item.schedule.status)).length;

    const statusByKey = Object.fromEntries((state.automation?.items || []).map((item) => [item.key, item])) as Record<string, { status?: PulseStatus; detail?: string }>;

    // Phase 0: 精简阶段展示 — 不再展示七段流水线，改为紧凑状态条
    const stages = [
      { key: "knowledge", label: "知识采集", metric: `${readyKnowledge}/${totalKnowledge || 0} 个可用`, progress: percent(readyKnowledge, totalKnowledge), href: "/products" },
      { key: "research", label: "GEO 调研", metric: `${questions} 个问题`, progress: questions ? 100 : 0, href: "/products" },
      { key: "strategy", label: "策略编译", metric: `${allocated}/${target || 0} 篇`, progress: percent(allocated, target), href: "/monthly-plan" },
      { key: "production", label: "内容生产", metric: `${produced}/${tasks.length} 篇`, progress: percent(produced, tasks.length), href: "/monthly-plan" },
      { key: "schedule", label: "发布排程", metric: `${scheduled}/${tasks.length} 篇`, progress: percent(scheduled, tasks.length), href: "/monthly-plan" },
      { key: "publishing", label: "发布回传", metric: `${publicJobs} 个公开结果`, progress: percent(publicJobs, state.publishJobs.length), href: "/geo-monitor" },
      { key: "review", label: "内容监控塔", metric: `${state.dashboard?.metrics.aiBotPv || 0} AI 访问`, progress: percent(published, target), href: "/content-monitor" }
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
      const productUrlReturned = group.tasks.filter((item) => Boolean(item.publicUrl) || urlReturnedByMatrixItemId.has(item.taskId)).length;
      const taskIssues = group.tasks.filter((item) => item.ctaValidationStatus === "failed").length;
      const exceptionIssues = openExceptions.filter((item) => {
        const registryProduct = productByAlias.get(normalizeProductKey(item.productId)) || productByAlias.get(normalizeProductKey(item.product));
        return (registryProduct?.productId || item.productId) === group.productId;
      }).length;
      const issueCount = taskIssues + exceptionIssues;
      const total = group.tasks.length;
      const stateRank = issueCount ? 0 : total && productPublished < total ? 1 : total ? 2 : 3;
      return { ...group, total, produced: productProduced, scheduled: productScheduled, published: productPublished, urlReturned: productUrlReturned, issueCount, stateRank };
    }).sort((left, right) => left.stateRank - right.stateRank || right.total - left.total || left.productName.localeCompare(right.productName, "zh-CN"));

    // Phase 0: 统一责任聚合 — 只把真正需要用户介入的计入 AttentionAlert
    const attentionItems: AttentionAlert[] = [
      // 生产异常（真正需要用户处理的，不含 system_recovering/awaiting_material）
      ...openExceptions.filter((item) => item.status === "open").map((item) => ({
        id: item.id,
        whatHappened: item.title || item.distilledTerm || "生产异常",
        impact: `影响 ${item.productId || item.product || "关联产品"} 的内容生产`,
        nextAction: item.nextAction || "请查看详情",
        nextCheckAt: "系统将持续监控",
        refId: item.id,
        href: "/monthly-plan",
        userAction: item.nextAction || "处理异常",
        attemptCount: 0,
        impactCount: 1,
      })),
      // 发布任务（只含真正需要用户操作的）
      ...publishUserAction.map((item) => {
        const classification = classifyPublishResponsibility(item.schedule.status);
        return {
          id: item.schedule.id,
          whatHappened: `${item.schedule.platform.toUpperCase()} 发布任务需要处理`,
          impact: `影响 ${item.schedule.platform} 渠道发布`,
          nextAction: classification.nextAutomaticAction || item.schedule.nextAction || "查看发布状态",
          nextCheckAt: classification.nextAttemptAt || "系统将持续监控",
          refId: item.schedule.id,
          href: "/geo-monitor",
          userAction: item.schedule.nextAction || "查看详情",
          attemptCount: classification.attemptCount,
          impactCount: classification.impactCount,
        };
      }),
    ].slice(0, 5);

    // Phase 0: 系统自动处理中（不告警用户）
    const systemAutoCount = systemRecoveringTasks.length + publishSystemRecovering.length;
    const externalWaitingCount = externalWaitingTasks.length;

    // Phase 0: 系统动态 — 最近自动完成的事件
    const recentTasks = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

    // Phase 0: 顶部结论 — 系统是否正常
    const systemNormal = attentionItems.length === 0;
    const statusText = systemNormal ? "系统正常运行" : `${attentionItems.length} 项需你处理`;

    return {
      currentProducts, target, allocated, readyKnowledge, questions, tasks, produced, scheduled, published,
      stages, productionBreakdown, productProduction, attentionItems, recentTasks,
      systemNormal, statusText, systemAutoCount, externalWaitingCount, publicJobs,
    };
  }, [state]);

  const initialLoading = loading && !state.workspace;

  const activeCount = derived.stages.filter((item) => item.status === "running").length;
  const attentionCount = derived.attentionItems.length;

  return (
    <div className={styles.home}>
      {/* Phase 0: 顶部结论 — 系统状态总览 */}
      <section className={styles.hero} aria-label="工作台状态与操作">
        <div>
          <div className={styles.eyebrow}><span className={styles.liveDot} />LIVE WORKSPACE · {month}</div>
        </div>
        <div className={styles.heroActions}>
          <Link href="/products/new"><Button icon={<PlusOutlined />}>绑定产品</Button></Link>
          <Link href="/products"><Button type="primary" icon={<CloudUploadOutlined />}>管理产品资料</Button></Link>
          <Button icon={<ReloadOutlined />} loading={loading || refreshing} onClick={() => void refresh(true)}>刷新</Button>
        </div>
      </section>

      {/* 核心 KPI：只保留产品、计划、成稿、发布和告警 */}
      <section className={styles.kpiRibbon} aria-label="核心指标">
        {[
          { label: "当前产品", value: derived.currentProducts, suffix: "个" },
          { label: "计划发布", value: derived.target, suffix: "篇" },
          { label: "已成稿", value: derived.produced, suffix: "篇" },
          { label: "已发布", value: derived.published, suffix: "篇" }
        ].map((item) => (
          <div className={styles.kpiItem} key={item.label}><span>{item.label}</span><strong>{initialLoading ? "—" : item.value}</strong><small>{item.suffix}</small></div>
        ))}
        <div className={`${styles.kpiItem} ${attentionCount ? styles.hasAttention : styles.isClear}`}>
          <span>失败告警</span><strong>{attentionCount}</strong><small>项</small>
        </div>
      </section>

      {error ? <div className={styles.dataNotice}><ExclamationCircleFilled />{error}</div> : null}

      {/* Phase 0: 产品进度行 — 一行一产品 */}
      <section className={styles.flowPanel} aria-label="产品推广进度">
        <div className={styles.sectionHeading}>
          <div><span>PRODUCT PROGRESS</span><h2>产品推广进度</h2></div>
          <div className={styles.liveMeta}>
            <Tag color={attentionCount ? "gold" : "green"}>{attentionCount ? `${attentionCount} 项需处理` : "无需人工介入"}</Tag>
            <span>{activeCount} 个阶段运行中 · 15 秒自动更新 · {formatUpdatedAt(updatedAt)}</span>
          </div>
        </div>
        <div className={styles.productPipelineGrid}>
          {derived.productProduction.length ? derived.productProduction.slice(0, 6).map((product) => {
            const pendingPublish = Math.max(0, product.total - product.published);
            const statusLabel = product.issueCount ? `${product.issueCount} 项待处理` : !product.total ? "本月暂无任务" : product.published === product.total ? "本月已完成" : "自动运行中";
            const productHref = product.total ? `/monthly-plan?productId=${encodeURIComponent(product.productId)}` : `/products/${encodeURIComponent(product.productId)}`;
            return (
              <article className={`${styles.productPipelineCard} ${product.issueCount ? styles.productPipelineCardAttention : ""}`} key={product.productId}>
                <div className={styles.productPipelineHeading}>
                  <div><span>当前产品</span><h3>{product.productName}</h3></div>
                  <Tag color={product.issueCount ? "gold" : product.total ? "success" : "default"}>{statusLabel}</Tag>
                </div>
                {product.total ? (
                  <>
                    <div className={styles.productPipelineStages}>
                      <span><strong>{product.total}</strong><small>计划状态</small></span>
                      <span><strong>{product.produced}</strong><small>成稿状态</small></span>
                      <span><strong>{pendingPublish}</strong><small>待发布状态</small></span>
                      <span><strong>{product.published}</strong><small>已发布状态</small></span>
                      <span><strong>{product.urlReturned}</strong><small>回传 URL 状态</small></span>
                    </div>
                  </>
                ) : <p className={styles.productPipelineEmpty}>资料、GEO 调研和策略条件满足后，系统会自动创建文章任务。</p>}
                <div className={styles.productPipelineFooter}>
                  <span>{product.issueCount ? "受影响任务已暂停，等待明确处理" : product.total ? "当前没有需要人工处理的异常" : "尚未进入本月生产计划"}</span>
                  <Link href={product.issueCount ? `${productHref}#production-exceptions` : productHref}>
                    {product.issueCount ? "处理异常" : product.total ? "查看任务" : "查看产品资料"} <ArrowRightOutlined />
                  </Link>
                </div>
              </article>
            );
          }) : <p className={styles.emptyText}>创建产品并确认内容策略后，这里会按产品展示生产进程。</p>}
        </div>
      </section>

      <div className={styles.operationsGrid}>
        {/* Phase 0: 系统动态 — 最近自动完成什么 */}
        <section className={styles.panel} aria-label="系统动态">
          <div className={styles.sectionHeading}>
            <div><span>SYSTEM ACTIVITY</span><h2>系统动态</h2></div>
            <Link href="/monthly-plan">查看全部 <ArrowRightOutlined /></Link>
          </div>
          <div className={styles.pipelineOverview}>
            <div><strong>{initialLoading ? "—" : derived.tasks.length}</strong><span>本月任务</span></div>
            <div><strong>{initialLoading ? "—" : derived.productProduction.filter((item) => item.total > 0).length}</strong><span>生产产品</span></div>
            <div><strong>{initialLoading ? "—" : derived.published}</strong><span>已发布</span></div>
            <div className={attentionCount ? styles.overviewAttention : styles.overviewClear}>
              <strong>{initialLoading ? "—" : attentionCount}</strong><span>待处理</span>
            </div>
          </div>
          <div className={styles.pipelineAutomationMeta}>
            <span className={styles.liveDot} />
            <strong>自动化运行中</strong>
            <span>系统按产品持续推进正文、排程和发布</span>
          </div>
          {/* Phase 0: 最近流转 */}
          <div className={styles.activityList}>
            {derived.recentTasks.length ? derived.recentTasks.map((task: ProductionMatrixTask) => {
              const classification = classifyProductionResponsibility(task.status);
              return (
                <Link href="/monthly-plan" key={task.taskId}>
                  <span className={`${styles.activityDot} ${styles[`task_${task.status}`]}`} />
                  <div><strong>{task.title}</strong><span>{task.channel} · {task.articleTypeNameSnapshot || task.contentType}</span></div>
                  <Tag color={RESPONSIBILITY_COLORS[classification.responsibility]}>{taskStatusLabels[task.status]}</Tag>
                  <time>{formatUpdatedAt(task.updatedAt)}</time>
                </Link>
              );
            }) : <p className={styles.emptyText}>还没有月度内容任务。系统生成策略和任务后，流转记录会出现在这里。</p>}
          </div>
        </section>

        {/* Phase 0: 失败告警 — 只有失败且需要关注的项目才出现在这里 */}
        <section className={`${styles.panel} ${styles.attentionPanel}`} aria-label="失败告警">
          <div className={styles.sectionHeading}>
            <div><span>FAILURE ALERTS</span><h2>失败告警</h2></div>
            {attentionCount ? <Tag color="gold">{attentionCount} 项</Tag> : <CheckCircleFilled className={styles.clearIcon} />}
          </div>
          {derived.attentionItems.length ? (
            <div className={styles.attentionList}>
              {derived.attentionItems.map((item) => (
                <Link href={item.href || "#"} key={item.id}>
                  <ExclamationCircleFilled />
                  <div>
                    <strong>{item.whatHappened}</strong>
                    <span>{item.impact}</span>
                    <small>{item.nextAction}</small>
                  </div>
                  <ArrowRightOutlined />
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.clearState}>
              <CheckCircleFilled />
              <strong>当前无需介入</strong>
              <span>系统会继续执行调研、生产、排程和回传。</span>
            </div>
          )}
        </section>
      </div>

      {/* Phase 0: 紧凑自动化流水线 — 保留但缩小 */}
      <section className={styles.activityPanel} aria-label="自动化流水线">
        <div className={styles.sectionHeading}>
          <div><span>PIPELINE STATUS</span><h2>自动化流水线</h2></div>
          <span>15 秒自动更新 · {formatUpdatedAt(updatedAt)}</span>
        </div>
        <div className={styles.flowTrack}>
          {derived.stages.map((stage, index) => (
            <Link className={`${styles.flowStage} ${styles[`status_${stage.status}`]}`} href={stage.href} key={stage.key} title={stage.detail}>
              <div className={styles.stageTop}><span className={styles.stageIndex}>{String(index + 1).padStart(2, "0")}</span><span className={styles.stageStatus}>{stage.status === "healthy" ? "已就绪" : stage.status === "running" ? "运行中" : stage.status === "attention" ? "需处理" : "等待"}</span></div>
              <strong>{stage.label}</strong>
              <b>{initialLoading ? "读取中" : stage.metric}</b>
              <span className={styles.stageHelper}>{stage.status === "healthy" ? "运行正常" : stage.status === "running" ? "正在执行" : stage.status === "attention" ? "需要关注" : "等待触发"}</span>
              <span className={styles.progressTrack}><span style={{ width: `${stage.progress}%` }} /></span>
              <ArrowRightOutlined className={styles.stageArrow} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
