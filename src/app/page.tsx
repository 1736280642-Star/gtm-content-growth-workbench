"use client";

import { Button, Card, Table, Tag } from "antd";
import Link from "next/link";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { BlogArticle } from "@/lib/types";
import {
  batchQueueItems,
  dailyExecutionItems,
  exceptionItems,
  monthlyGoal,
  nextMonthCandidates,
  strategyTermHits
} from "@/lib/v5-ui-mock-data";

interface DashboardActionItem {
  key: string;
  title: string;
  count: number;
  primary?: boolean;
  status: string;
  statusColor: string;
  description: string;
  href: string;
  entryLabel: string;
}

function needsBlogAction(article: BlogArticle) {
  if (article.candidateStatus === "planned" || article.candidateStatus === "dismissed") {
    return false;
  }

  return article.candidateStatus === "candidate" || article.geoResult === "miss" || article.seoIssueCount > 0 || article.indexedStatus !== "indexed";
}

export default function DashboardPage() {
  const { state, summary, loading, error, refresh } = useWorkbenchSnapshot();
  const monthlyQuota = monthlyGoal.groups.reduce((sum, group) => sum + group.articleQuota, 0);
  const generatedSampleCount = batchQueueItems.filter((item) => item.generationStatus === "generated").length;
  const passedSampleCount = batchQueueItems.filter((item) => item.qualityResult === "passed").length;
  const openExceptionCount = exceptionItems.filter((item) => item.status === "open").length;
  const strategyAttentionCount = strategyTermHits.filter((item) => item.status !== "ready").length;
  const batchAttentionCount = batchQueueItems.filter((item) => item.qualityResult !== "passed").length;
  const todayExecutionCount = dailyExecutionItems.filter((item) => item.dateKey === "today").length;
  const pendingReviewCount = nextMonthCandidates.filter((item) => item.status === "pending_review").length;
  const pendingDataReturnCount = state.publishRecords.filter(
    (record) => record.publishStatus === "published" || (record.publishStatus === "url_filled" && !record.channelMetrics)
  ).length;
  const blogActionCount = state.blogArticles.filter(needsBlogAction).length;

  const dashboardActionItems: DashboardActionItem[] = [
    {
      key: "monthly-matrix",
      title: "月度策略与矩阵",
      count: strategyAttentionCount,
      primary: true,
      status: "需人工判断",
      statusColor: "gold",
      description: "确认月度目标、产品配额、蒸馏词命中和 Evidence Preview。",
      href: "/monthly-matrix",
      entryLabel: "进入月度矩阵"
    },
    {
      key: "batch-generation",
      title: "批量生成与人工排程",
      count: batchAttentionCount,
      primary: true,
      status: "待生产处理",
      statusColor: "blue",
      description: "处理标题确认、证据检查、内容质检、异常和文章级排程。",
      href: "/batch-generation",
      entryLabel: "进入生成中心"
    },
    {
      key: "daily-execution",
      title: "当日执行",
      count: todayExecutionCount,
      primary: true,
      status: "今日任务",
      statusColor: "cyan",
      description: "查看今日发布状态、失败原因以及重试或人工接管入口。",
      href: "/daily-execution",
      entryLabel: "查看当日执行"
    },
    {
      key: "data-return",
      title: "数据回传",
      count: pendingDataReturnCount,
      status: "待跟进",
      statusColor: "gold",
      description: "导入渠道数据、匹配发布 URL，并补录关键表现指标。",
      href: "/publish",
      entryLabel: "进入数据回传"
    },
    {
      key: "blog-monitor",
      title: "博客监控",
      count: blogActionCount,
      status: "待跟进",
      statusColor: "gold",
      description: "查看博客诊断、问题分布，并处理内容优化候选。",
      href: "/blog-monitor",
      entryLabel: "查看博客监控"
    },
    {
      key: "monthly-review",
      title: "月度复盘",
      count: pendingReviewCount,
      primary: true,
      status: "候选待确认",
      statusColor: "purple",
      description: "回看月度内容表现与证据缺口，并审核下月策略候选。",
      href: "/monthly-review",
      entryLabel: "进入月度复盘"
    }
  ];

  return (
    <>
      <PageHeader
        title="首页数据看板"
        subtitle="集中查看本月内容生产进度、待处理事项和增长反馈。"
        actions={
          <>
            <Link href="/monthly-matrix">
              <Button type="primary">进入月度内容矩阵</Button>
            </Link>
            <Link href="/daily-execution">
              <Button>查看当日执行</Button>
            </Link>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />

      <div className="dashboard-section-heading">
        <div>
          <h2>本月内容进展</h2>
          <p>查看月度计划、内容生成、质量检查和异常处理进度。</p>
        </div>
      </div>
      <V5StatusRail
        items={[
          { label: "本月内容矩阵", value: `${monthlyQuota} 篇`, helper: "月度计划总量" },
          { label: "已生成", value: generatedSampleCount, helper: `共 ${batchQueueItems.length} 项内容任务` },
          { label: "质检通过", value: passedSampleCount, helper: "规则与内容质量均通过" },
          { label: "异常待处理", value: openExceptionCount, helper: "仅影响对应内容" }
        ]}
      />

      <div className="dashboard-section-heading">
        <div>
          <h2>待办与增长反馈</h2>
          <p>处理发布后的数据补全、博客优化和月度候选反馈。</p>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard title="待回填 URL" value={summary.metrics.pendingUrl} suffix="条" />
        <MetricCard title="待数据回传" value={pendingDataReturnCount} suffix="条" />
        <MetricCard title="博客待处置" value={blogActionCount} suffix="条" />
      </div>

      <Card title="重点事项">
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={dashboardActionItems}
          columns={[
            { title: "事项", dataIndex: "title" },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value} 条</Tag> },
            {
              title: "状态",
              render: (_, record) => <Tag color={record.statusColor}>{record.status}</Tag>
            },
            { title: "处理内容", dataIndex: "description" },
            {
              title: "入口",
              render: (_, record) => (
                <Link href={record.href}>
                  <Button size="small" type={record.primary ? "primary" : "default"}>
                    {record.entryLabel}
                  </Button>
                </Link>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}
