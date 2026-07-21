"use client";

import { Alert, Button, Card, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { PageErrorState } from "@/components/PageErrorState";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { ArticleDraft, BlogArticle, ContentTask, PublishRecord } from "@/lib/types";
import type { PipelineRunRecord } from "@/lib/workbench-store";
import { useMemo, useState } from "react";

type PipelineRunStatus = "success" | "partial" | "failed";

const pipelineStatusLabels: Record<PipelineRunStatus, string> = {
  success: "成功",
  partial: "部分完成",
  failed: "失败"
};

type PlanNextStep = "confirm" | "generate" | "fix_generation" | "fix_qa" | "review_draft" | "publish" | "fill_url" | "record_metrics" | "retrospect" | "failed";
type BlogNextStep = "diagnose" | "add_candidate" | "candidate_pool" | "planned" | "observe" | "dismissed";
type DashboardActionStep = "confirm_plan" | "generate_draft" | "review_draft" | "publish" | "blog" | "retrospect";
type DashboardOverviewStep = "import_log" | "handle_blog" | "monthly_report";
type PipelineRunNextStep = "read_report" | "inspect_partial" | "rerun_pipeline";

interface DashboardActionItem {
  key: DashboardActionStep;
  title: string;
  count: number;
  step: DashboardActionStep;
  href: string;
  currentAction: string;
  entryLabel: string;
  description: string;
}

interface DashboardOverviewItem {
  key: DashboardOverviewStep;
  item: string;
  currentStatus: string;
  nextStep: DashboardOverviewStep;
  actionText: string;
  href: string;
  entryLabel: string;
}

const dashboardActionStepLabels: Record<DashboardActionStep, string> = {
  confirm_plan: "待确认",
  generate_draft: "待生成/排查",
  review_draft: "待终稿处理",
  publish: "待发布/回填",
  blog: "博客待处置",
  retrospect: "可复盘"
};

const dashboardActionStepColors: Record<DashboardActionStep, string> = {
  confirm_plan: "gold",
  generate_draft: "blue",
  review_draft: "purple",
  publish: "volcano",
  blog: "cyan",
  retrospect: "green"
};

const dashboardOverviewStepLabels: Record<DashboardOverviewStep, string> = {
  import_log: "导入日志",
  handle_blog: "处理博客",
  monthly_report: "进入月度复盘"
};

const dashboardOverviewStepColors: Record<DashboardOverviewStep, string> = {
  import_log: "gold",
  handle_blog: "cyan",
  monthly_report: "green"
};

const pipelineRunNextStepLabels: Record<PipelineRunNextStep, string> = {
  read_report: "进入月度复盘",
  inspect_partial: "补齐缺口",
  rerun_pipeline: "排查后重跑"
};

const pipelineRunNextStepColors: Record<PipelineRunNextStep, string> = {
  read_report: "green",
  inspect_partial: "gold",
  rerun_pipeline: "red"
};

function getDraftHandoffStatus(draft: ArticleDraft | undefined) {
  if (!draft) {
    return "none" as const;
  }

  const generationStatus = draft.generationSource?.status;

  if (generationStatus === "pending_config") {
    return "pending_config" as const;
  }

  if (generationStatus === "failed") {
    return "failed" as const;
  }

  if (!draft.qaResult.passed) {
    return "blocked" as const;
  }

  if (draft.status === "final") {
    return "final" as const;
  }

  return "draft" as const;
}

function getPublishHandoffStatus(record: PublishRecord | undefined) {
  if (!record) {
    return "none" as const;
  }

  if (record.publishStatus === "failed") {
    return "failed" as const;
  }

  if (record.channelMetrics) {
    return "measured" as const;
  }

  if (record.publishStatus === "url_filled") {
    return "url_filled" as const;
  }

  if (record.publishStatus === "published") {
    return "published" as const;
  }

  return "queued" as const;
}

function getPlanNextStep(task: ContentTask, draft?: ArticleDraft, record?: PublishRecord): PlanNextStep {
  const draftHandoff = getDraftHandoffStatus(draft);
  const publishHandoff = getPublishHandoffStatus(record);

  if (publishHandoff === "failed") {
    return "failed";
  }

  if (publishHandoff === "queued") {
    return "publish";
  }

  if (publishHandoff === "published") {
    return "fill_url";
  }

  if (publishHandoff === "url_filled") {
    return "record_metrics";
  }

  if (publishHandoff === "measured") {
    return "retrospect";
  }

  if (draftHandoff === "pending_config" || draftHandoff === "failed") {
    return "fix_generation";
  }

  if (draftHandoff === "blocked") {
    return "fix_qa";
  }

  if (draftHandoff === "draft" || draftHandoff === "final") {
    return "review_draft";
  }

  if (task.status === "planned") {
    return "confirm";
  }

  return "generate";
}

function getBlogNextStep(article: BlogArticle): BlogNextStep {
  if (article.candidateStatus === "planned") {
    return "planned";
  }

  if (article.candidateStatus === "candidate") {
    return "candidate_pool";
  }

  if (article.candidateStatus === "dismissed") {
    return "dismissed";
  }

  if (article.geoResult === "miss" || article.seoIssueCount > 0 || article.indexedStatus === "not_indexed") {
    return "add_candidate";
  }

  if (article.indexedStatus === "unknown") {
    return "diagnose";
  }

  return "observe";
}

function getDashboardActionText(step: DashboardActionStep, count: number) {
  if (step === "confirm_plan") {
    return count ? `还有 ${count} 条计划中任务未进入今日生成队列，先完成确认。` : "当前没有待确认的月度计划任务。";
  }

  if (step === "generate_draft") {
    return count ? `还有 ${count} 条任务需要生成稿件或排查生成配置，先补齐稿件承接。` : "当前没有待生成稿件或待排查生成的问题。";
  }

  if (step === "review_draft") {
    return count ? `还有 ${count} 条任务卡在质检或终稿确认阶段，先处理稿件质量闭环。` : "当前没有待终稿处理的稿件。";
  }

  if (step === "publish") {
    return count ? `还有 ${count} 条记录等待人工发布、URL 回填、指标录入或失败排查。` : "当前没有发布侧待处理记录。";
  }

  if (step === "blog") {
    return count ? `还有 ${count} 条博客记录需要诊断、进入候选池或继续候选处理。` : "当前没有博客侧待处理记录。";
  }

  return count ? `已有 ${count} 条任务完成发布与指标回填，可以进入月度复盘。` : "当前还没有可直接进入月度复盘的任务。";
}

function getPipelineRunNextStep(record: PipelineRunRecord): PipelineRunNextStep {
  if (record.status === "failed") {
    return "rerun_pipeline";
  }

  if (record.status === "partial" || record.steps.some((step) => step.status !== "success")) {
    return "inspect_partial";
  }

  return "read_report";
}

function getPipelineRunActionText(record: PipelineRunRecord) {
  const nextStep = getPipelineRunNextStep(record);

  if (nextStep === "rerun_pipeline") {
    return "先去真实接入页排查失败步骤的配置、权限或文件路径，再回首页重跑 Pipeline。";
  }

  if (nextStep === "inspect_partial") {
    return "先补齐未成功步骤对应的数据源或配置，再决定是否重新运行整条 Pipeline。";
  }

  return "Pipeline 已跑通，进入月度复盘查看发布与博客诊断是否能形成下月建议。";
}

function getPipelineRunEntry(record: PipelineRunRecord) {
  const nextStep = getPipelineRunNextStep(record);

  if (nextStep === "read_report") {
    return { href: "/monthly-review", label: "去月度复盘" };
  }

  return { href: "/real-integration", label: "看接入" };
}

export default function DashboardPage() {
  const { state, summary, loading, error, refresh } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [exportingPipelineRuns, setExportingPipelineRuns] = useState(false);
  const [pipelineStatusFilter, setPipelineStatusFilter] = useState<PipelineRunStatus[]>([]);
  const [pipelineMonthFilter, setPipelineMonthFilter] = useState<string[]>([]);
  const { metrics } = summary;
  const draftById = useMemo(() => new Map(state.drafts.map((draft) => [draft.id, draft])), [state.drafts]);
  const draftByTaskId = useMemo(() => new Map(state.drafts.map((draft) => [draft.taskId, draft])), [state.drafts]);
  const publishRecordByTaskId = useMemo(
    () =>
      new Map(
        state.publishRecords
          .map((record) => {
            const draft = draftById.get(record.draftId);

            return draft ? ([draft.taskId, record] as const) : undefined;
          })
          .filter((item): item is readonly [string, PublishRecord] => Boolean(item))
      ),
    [draftById, state.publishRecords]
  );
  const taskNextSteps = useMemo(
    () =>
      state.tasks.map((task) => ({
        task,
        nextStep: getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id))
      })),
    [draftByTaskId, publishRecordByTaskId, state.tasks]
  );
  const pendingConfirmCount = taskNextSteps.filter((item) => item.nextStep === "confirm").length;
  const pendingGenerateCount = taskNextSteps.filter((item) => item.nextStep === "generate" || item.nextStep === "fix_generation").length;
  const pendingReviewCount = taskNextSteps.filter((item) => item.nextStep === "review_draft" || item.nextStep === "fix_qa").length;
  const pendingPublishCount = taskNextSteps.filter(
    (item) => item.nextStep === "publish" || item.nextStep === "fill_url" || item.nextStep === "record_metrics" || item.nextStep === "failed"
  ).length;
  const retrospectCount = taskNextSteps.filter((item) => item.nextStep === "retrospect").length;
  const blogActionCount = state.blogArticles.filter((article) => {
    const nextStep = getBlogNextStep(article);

    return nextStep === "diagnose" || nextStep === "add_candidate" || nextStep === "candidate_pool";
  }).length;
  const dashboardActionItems: DashboardActionItem[] = [
    {
      key: "confirm_plan",
      title: "月度计划待确认",
      count: pendingConfirmCount,
      step: "confirm_plan" as const,
      href: "/monthly-plan",
      currentAction: getDashboardActionText("confirm_plan", pendingConfirmCount),
      entryLabel: "去确认",
      description: pendingConfirmCount ? `还有 ${pendingConfirmCount} 条计划中任务未进入今日生成队列。` : "当前没有待确认的月度计划任务。"
    },
    {
      key: "generate_draft",
      title: "稿件待生成/排查",
      count: pendingGenerateCount,
      step: "generate_draft" as const,
      href: "/today",
      currentAction: getDashboardActionText("generate_draft", pendingGenerateCount),
      entryLabel: "去生成",
      description: pendingGenerateCount ? `还有 ${pendingGenerateCount} 条任务需要生成稿件或排查模型配置。` : "当前没有待生成稿件或生成异常任务。"
    },
    {
      key: "review_draft",
      title: "终稿待处理",
      count: pendingReviewCount,
      step: "review_draft" as const,
      href: "/today",
      currentAction: getDashboardActionText("review_draft", pendingReviewCount),
      entryLabel: "去处理",
      description: pendingReviewCount ? `还有 ${pendingReviewCount} 条任务卡在质检或终稿确认阶段。` : "当前没有待终稿处理的稿件。"
    },
    {
      key: "publish",
      title: "发布侧待处理",
      count: pendingPublishCount,
      step: "publish" as const,
      href: "/publish",
      currentAction: getDashboardActionText("publish", pendingPublishCount),
      entryLabel: "去发布",
      description: pendingPublishCount ? `还有 ${pendingPublishCount} 条记录等待人工发布、URL 回填、指标录入或失败排查。` : "当前没有发布侧待处理记录。"
    },
    {
      key: "blog",
      title: "博客待处置",
      count: blogActionCount,
      step: "blog" as const,
      href: "/blog-monitor",
      currentAction: getDashboardActionText("blog", blogActionCount),
      entryLabel: "去博客侧",
      description: blogActionCount ? `还有 ${blogActionCount} 条博客记录需要诊断、入候选池或转入候选池继续处理。` : "当前没有博客侧待处置记录。"
    },
    {
      key: "retrospect",
      title: "可进入复盘",
      count: retrospectCount,
      step: "retrospect" as const,
      href: "/monthly-review",
      currentAction: getDashboardActionText("retrospect", retrospectCount),
      entryLabel: "去复盘",
      description: retrospectCount ? `已有 ${retrospectCount} 条任务完成发布与指标回填，可以进入月度复盘。` : "当前还没有可直接进入月度复盘的任务。"
    }
  ];
  const dashboardActionTotal = dashboardActionItems.reduce((sum, item) => sum + item.count, 0);
  const highestPriorityAction = dashboardActionItems.find((item) => item.count > 0);
  const botConfidence = state.botVisits.some((item) => item.dataConfidence === "real")
    ? "real"
    : state.botVisits.some((item) => item.dataConfidence === "imported")
      ? "imported"
      : "demo";
  const blogNeedsWorkCount = state.blogArticles.filter((item) => getBlogNextStep(item) === "diagnose" || getBlogNextStep(item) === "add_candidate" || getBlogNextStep(item) === "candidate_pool").length;
  const dashboardOverviewItems: DashboardOverviewItem[] = [
    {
      key: "handle_blog",
      item: "博客候选与 SEO/GEO 诊断",
      currentStatus: blogNeedsWorkCount ? `还有 ${blogNeedsWorkCount} 篇博客待诊断、入池或候选池继续处理` : "当前博客侧没有阻塞项",
      nextStep: blogNeedsWorkCount ? "handle_blog" : "monthly_report",
      actionText: blogNeedsWorkCount ? "去博客监控页判断是继续诊断、加入候选池，还是转到候选池继续承接。" : "博客侧已无阻塞，继续看月度复盘是否需要把博客结果带入下月建议。",
      href: blogNeedsWorkCount ? "/blog-monitor" : "/monthly-review",
      entryLabel: blogNeedsWorkCount ? "去博客侧" : "去月度复盘"
    },
    {
      key: "import_log",
      item: "AI Bot 日志可信度",
      currentStatus: `当前 AI Bot PV ${metrics.aiBotPv}，数据标签为 ${botConfidence}`,
      nextStep: botConfidence === "demo" ? "import_log" : "monthly_report",
      actionText: botConfidence === "demo" ? "先去博客监控页导入真实日志，避免把 Demo PV 当成正式策略判断。" : "日志已不是纯 Demo，可以进入月度复盘判断渠道与博客动作。",
      href: botConfidence === "demo" ? "/blog-monitor" : "/monthly-review",
      entryLabel: botConfidence === "demo" ? "去导入" : "去月度复盘"
    }
  ];
  const pipelineMonths = useMemo(() => Array.from(new Set((state.pipelineRuns || []).map((item) => item.month).filter(Boolean))), [state.pipelineRuns]);
  const hasPipelineFilter = Boolean(pipelineStatusFilter.length || pipelineMonthFilter.length);
  const filteredPipelineRuns = useMemo(() => {
    return (state.pipelineRuns || []).filter((item) => {
      const statusMatched = !pipelineStatusFilter.length || pipelineStatusFilter.includes(item.status);
      const monthMatched = !pipelineMonthFilter.length || pipelineMonthFilter.includes(item.month);

      return statusMatched && monthMatched;
    });
  }, [pipelineStatusFilter, pipelineMonthFilter, state.pipelineRuns]);

  function clearPipelineFilters() {
    setPipelineStatusFilter([]);
    setPipelineMonthFilter([]);
  }

  async function handleRunPipeline() {
    setRunningPipeline(true);

    try {
      const result = await callJsonApi("/api/pipeline/run", {
        method: "POST",
        body: JSON.stringify({
          skipBlog: false,
          skipLog: false,
          skipChannelMetrics: false,
          month: state.monthlyPlan.monthStart,
          log: {
            sourceType: "demo_csv",
            filePath: "data/demo-ai-bot-log.csv"
          },
          channelMetrics: {
            filePath: "imports/channel-metrics-smoke.csv"
          }
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "Pipeline 已运行"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Pipeline 运行失败");
    } finally {
      setRunningPipeline(false);
    }
  }

  async function handleExportPipelineRuns() {
    setExportingPipelineRuns(true);

    try {
      const result = await callJsonApi<{ message?: string; data?: { csv?: string } }>("/api/pipeline/runs/export", { method: "GET" });
      await navigator.clipboard.writeText(result.data?.csv || "");
      messageApi.success(formatApiMessage(result, "Pipeline 运行记录 CSV 已复制"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出 Pipeline 运行记录失败");
    } finally {
      setExportingPipelineRuns(false);
    }
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="工作台首页"
        subtitle="今天需要处理的任务、发布回填和官网博客诊断都在这里汇总。"
        actions={
          <>
            <Button loading={runningPipeline} onClick={handleRunPipeline}>
              运行 GTM Pipeline
            </Button>
            <Link href="/today">
              <Button type="primary">生成今日文章</Button>
            </Link>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid">
        <MetricCard title="本月度计划" value={metrics.targetTotal} suffix="篇" />
        <MetricCard title="已生成" value={metrics.generated} suffix="篇" />
        <MetricCard title="已发布" value={metrics.published} suffix="篇" />
        <MetricCard title="待回填 URL" value={metrics.pendingUrl} suffix="条" />
      </div>
      <div className="two-column">
        <Card title="执行队列">
          <Alert
            showIcon
            type={dashboardActionTotal ? (pendingConfirmCount || pendingGenerateCount || pendingReviewCount ? "warning" : "info") : "success"}
            message={
              dashboardActionTotal
                ? `执行队列共 ${dashboardActionTotal} 条，当前优先处理「${highestPriorityAction?.title || "首页执行队列"}」`
                : "当前没有阻塞项，可以继续观察 Pipeline、博客和月度复盘变化。"
            }
            description={`终稿待处理 ${pendingReviewCount} 条，发布侧待处理 ${pendingPublishCount} 条，博客待处置 ${blogActionCount} 条。`}
            style={{ marginBottom: 16 }}
          />
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={dashboardActionItems}
            columns={[
              { title: "事项", dataIndex: "title" },
              { title: "当前状态", dataIndex: "description" },
              { title: "数量", dataIndex: "count", render: (value) => <Tag>{value} 条</Tag> },
              {
                title: "下一步",
                dataIndex: "step",
                render: (value) => <Tag color={dashboardActionStepColors[value as DashboardActionStep]}>{dashboardActionStepLabels[value as DashboardActionStep]}</Tag>
              },
              { title: "处理动作", dataIndex: "currentAction" },
              {
                title: "可执行入口",
                render: (_, record) => (
                  <Link href={record.href}>
                    <Button size="small" type={record.count ? "primary" : "default"}>
                      {record.entryLabel}
                    </Button>
                  </Link>
                )
              }
            ]}
          />
        </Card>
        <Card title="官网博客概览">
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={dashboardOverviewItems}
            columns={[
              { title: "事项", dataIndex: "item" },
              {
                title: "当前状态",
                render: (_, record) => (
                  <Space wrap>
                    <span>{record.currentStatus}</span>
                    {record.key === "import_log" ? <DataConfidenceTag value={botConfidence} /> : null}
                  </Space>
                )
              },
              {
                title: "下一步",
                dataIndex: "nextStep",
                render: (value) => <Tag color={dashboardOverviewStepColors[value as DashboardOverviewStep]}>{dashboardOverviewStepLabels[value as DashboardOverviewStep]}</Tag>
              },
              { title: "处理动作", dataIndex: "actionText" },
              {
                title: "可执行入口",
                render: (_, record) => (
                  <Link href={record.href}>
                    <Button size="small" type={record.nextStep === "monthly_report" ? "default" : "primary"}>
                      {record.entryLabel}
                    </Button>
                  </Link>
                )
              }
            ]}
          />
        </Card>
      </div>
      <Card
        title="Pipeline 运行记录"
        style={{ marginTop: 16 }}
        extra={
          <Button size="small" loading={exportingPipelineRuns} onClick={handleExportPipelineRuns}>
            导出 CSV
          </Button>
        }
      >
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按运行状态筛选"
            value={pipelineStatusFilter}
            onChange={(value) => setPipelineStatusFilter(value)}
            options={Object.entries(pipelineStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按月份筛选"
            value={pipelineMonthFilter}
            onChange={(value) => setPipelineMonthFilter(value)}
            options={pipelineMonths.map((value) => ({ value, label: value }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearPipelineFilters} disabled={!hasPipelineFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={filteredPipelineRuns}
          pagination={false}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasPipelineFilter ? "当前筛选没有 Pipeline 记录" : "还没有 Pipeline 运行记录"}
                description={
                  hasPipelineFilter
                    ? "清空筛选或调整运行状态、月份条件后再查看。"
                    : "从首页运行 GTM Pipeline 后，这里会保留最近 20 次运行结果。"
                }
                action={
                  hasPipelineFilter ? (
                    <Button type="primary" onClick={clearPipelineFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Button type="primary" loading={runningPipeline} onClick={handleRunPipeline}>
                      运行 GTM Pipeline
                    </Button>
                  )
                }
              />
            )
          }}
          columns={[
            {
              title: "状态",
              dataIndex: "status",
              render: (value) => (
                <Tag color={value === "success" ? "green" : value === "partial" ? "gold" : "red"}>
                  {pipelineStatusLabels[value as PipelineRunStatus] || value}
                </Tag>
              )
            },
            { title: "开始时间", dataIndex: "startedAt" },
            { title: "结束时间", dataIndex: "finishedAt" },
            { title: "月度复盘", dataIndex: "month" },
            {
              title: "步骤",
              dataIndex: "steps",
              render: (steps) => (
                <Space wrap>
                  {steps.map((step: { name: string; status: string }) => (
                    <Tag key={step.name} color={step.status === "success" ? "green" : step.status === "failed" ? "red" : "gold"}>
                      {step.name}:{step.status}
                    </Tag>
                  ))}
                </Space>
              )
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getPipelineRunNextStep(record);

                return <Tag color={pipelineRunNextStepColors[nextStep]}>{pipelineRunNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getPipelineRunActionText(record)
            },
            {
              title: "可执行入口",
              render: (_, record) => {
                const entry = getPipelineRunEntry(record);

                return (
                  <Link href={entry.href}>
                    <Button size="small">{entry.label}</Button>
                  </Link>
                );
              }
            }
          ]}
        />
      </Card>
    </>
  );
}
