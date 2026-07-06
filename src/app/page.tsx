"use client";

import { Alert, Button, Card, Table, Tag } from "antd";
import Link from "next/link";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { PageErrorState } from "@/components/PageErrorState";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { isDateInWeek } from "@/lib/date-utils";
import type { ArticleDraft, BlogArticle, ContentTask, GeoTestResult, PublishRecord } from "@/lib/types";
import { useMemo } from "react";

type PlanNextStep = "confirm" | "generate" | "fix_generation" | "fix_qa" | "review_draft" | "publish" | "fill_url" | "record_metrics" | "retrospect" | "failed";
type BlogNextStep = "diagnose" | "add_candidate" | "candidate_pool" | "planned" | "observe" | "dismissed";
type GeoNextStep = "configure_models" | "inspect_failure" | "add_candidate" | "fix_citation" | "candidate_pool" | "planned" | "dismissed" | "observe";
type DashboardActionStep = "confirm_plan" | "generate_draft" | "review_draft" | "publish" | "blog" | "geo" | "retrospect";

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

const dashboardActionStepLabels: Record<DashboardActionStep, string> = {
  confirm_plan: "待确认",
  generate_draft: "待生成/排查",
  review_draft: "待终稿处理",
  publish: "待发布/回填",
  blog: "博客待处置",
  geo: "GEO 待处置",
  retrospect: "可复盘"
};

const dashboardActionStepColors: Record<DashboardActionStep, string> = {
  confirm_plan: "gold",
  generate_draft: "blue",
  review_draft: "purple",
  publish: "volcano",
  blog: "cyan",
  geo: "magenta",
  retrospect: "green"
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

function getGeoNextStep(result: GeoTestResult, candidateArticle?: BlogArticle): GeoNextStep {
  const executionStatus = result.executionStatus || "success";
  const candidateStatus = candidateArticle?.candidateStatus || "none";

  if (executionStatus === "pending_config") {
    return "configure_models";
  }

  if (executionStatus === "failed") {
    return "inspect_failure";
  }

  if (candidateStatus === "planned") {
    return "planned";
  }

  if (candidateStatus === "dismissed") {
    return "dismissed";
  }

  if (candidateStatus === "candidate") {
    return "candidate_pool";
  }

  if (!result.mentionedJoto) {
    return "add_candidate";
  }

  if (!result.citedOfficialUrl) {
    return "fix_citation";
  }

  return "observe";
}

function getDashboardActionText(step: DashboardActionStep, count: number) {
  if (step === "confirm_plan") {
    return count ? `还有 ${count} 条计划中任务未进入今日生成队列，先完成确认。` : "当前没有待确认的周计划任务。";
  }

  if (step === "generate_draft") {
    return count ? `还有 ${count} 条任务需要生成稿件或排查生成配置，先补齐稿件承接。` : "当前没有待生成稿件或待排查生成的问题。";
  }

  if (step === "review_draft") {
    return count ? `还有 ${count} 条任务卡在质检或终稿确认阶段，先处理稿件质量闭环。` : "当前没有待终稿处理的稿件。";
  }

  if (step === "publish") {
    return count ? `还有 ${count} 条记录等待人工发布确认、URL 回填、指标录入或失败排查。` : "当前没有今日发布侧待处理记录。";
  }

  if (step === "blog") {
    return count ? `还有 ${count} 条博客记录需要诊断、进入候选池或继续候选处理。` : "当前没有博客侧待处理记录。";
  }

  if (step === "geo") {
    return count ? `还有 ${count} 条 GEO 结果需要补配置、排查失败、补官网引用或转入候选池。` : "当前没有 GEO 待处理结果。";
  }

  return count ? `已有 ${count} 条任务完成发布与指标回填，可以进入周报复盘。` : "当前还没有可直接进入周报复盘的任务。";
}

export default function DashboardPage() {
  const { state, summary, loading, error, refresh } = useWorkbenchSnapshot();
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
  const currentWeekTasks = useMemo(
    () => state.tasks.filter((task) => task.weeklyPlanId === state.weeklyPlan.id || isDateInWeek(task.publishDate, state.weeklyPlan.weekStart)),
    [state.tasks, state.weeklyPlan.id, state.weeklyPlan.weekStart]
  );
  const candidateByGeoResultId = useMemo(
    () =>
      new Map(
        state.blogArticles
          .map((article) => {
            if (!article.url.startsWith("geo://result/")) {
              return undefined;
            }

            return [article.url.replace("geo://result/", ""), article] as const;
          })
          .filter((item): item is readonly [string, BlogArticle] => Boolean(item))
      ),
    [state.blogArticles]
  );
  const taskNextSteps = useMemo(
    () =>
      currentWeekTasks.map((task) => ({
        task,
        nextStep: getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id))
      })),
    [currentWeekTasks, draftByTaskId, publishRecordByTaskId]
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
  const geoActionCount = state.geoResults.filter((result) => {
    const nextStep = getGeoNextStep(result, candidateByGeoResultId.get(result.id));

    return nextStep === "configure_models" || nextStep === "inspect_failure" || nextStep === "add_candidate" || nextStep === "fix_citation" || nextStep === "candidate_pool";
  }).length;
  const dashboardActionItems: DashboardActionItem[] = [
    {
      key: "confirm_plan",
      title: "周计划待确认",
      count: pendingConfirmCount,
      step: "confirm_plan" as const,
      href: "/weekly-plan",
      currentAction: getDashboardActionText("confirm_plan", pendingConfirmCount),
      entryLabel: "去确认",
      description: pendingConfirmCount ? `还有 ${pendingConfirmCount} 条计划中任务未进入今日生成队列。` : "当前没有待确认的周计划任务。"
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
      title: "今日发布待处理",
      count: pendingPublishCount,
      step: "publish" as const,
      href: "/today",
      currentAction: getDashboardActionText("publish", pendingPublishCount),
      entryLabel: "去今日发布",
      description: pendingPublishCount ? `还有 ${pendingPublishCount} 条记录等待人工发布确认、URL 回填或数据回传。` : "当前没有今日发布侧待处理记录。"
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
      key: "geo",
      title: "GEO 待处置",
      count: geoActionCount,
      step: "geo" as const,
      href: "/geo-test",
      currentAction: getDashboardActionText("geo", geoActionCount),
      entryLabel: "去 GEO",
      description: geoActionCount ? `还有 ${geoActionCount} 条 GEO 结果需要补配置、排查失败、补官网引用或转入候选池。` : "当前没有 GEO 待处置结果。"
    },
    {
      key: "retrospect",
      title: "可进入复盘",
      count: retrospectCount,
      step: "retrospect" as const,
      href: "/weekly-report",
      currentAction: getDashboardActionText("retrospect", retrospectCount),
      entryLabel: "去复盘",
      description: retrospectCount ? `已有 ${retrospectCount} 条任务完成发布与指标回填，可以进入周报复盘。` : "当前还没有可直接进入周报复盘的任务。"
    }
  ];
  const dashboardActionTotal = dashboardActionItems.reduce((sum, item) => sum + item.count, 0);
  const highestPriorityAction = dashboardActionItems.find((item) => item.count > 0);

  return (
    <>
      <PageHeader
        title="首页数据看板"
        subtitle="本周内容生产和发布执行队列的总览。"
        actions={
          <>
            <Link href="/today">
              <Button type="primary">去今日发布</Button>
            </Link>
            <Link href="/geo-test">
              <Button>运行 GEO 测试</Button>
            </Link>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="本周计划" value={metrics.targetTotal} suffix="篇" />
        <MetricCard title="已生成" value={metrics.generated} suffix="篇" />
        <MetricCard title="已发布" value={metrics.published} suffix="篇" />
        <MetricCard title="待回填 URL" value={metrics.pendingUrl} suffix="条" />
        <MetricCard title="待数据回传" value={pendingPublishCount} suffix="条" />
      </div>
      <Card title="执行队列">
        <Alert
          showIcon
          type={dashboardActionTotal ? (pendingConfirmCount || pendingGenerateCount || pendingReviewCount ? "warning" : "info") : "success"}
          message={
            dashboardActionTotal
              ? `执行队列共 ${dashboardActionTotal} 条，当前优先处理「${highestPriorityAction?.title || "首页执行队列"}」`
              : "当前没有阻塞项，可以进入周报复盘或继续观察发布结果。"
          }
          description={`终稿待处理 ${pendingReviewCount} 条，发布侧待处理 ${pendingPublishCount} 条，博客 / GEO 待处置 ${blogActionCount + geoActionCount} 条。`}
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
              render: (_, record) => {
                return (
                  <Link href={record.href}>
                    <Button size="small" type={record.count ? "primary" : "default"}>
                      {record.entryLabel}
                    </Button>
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
