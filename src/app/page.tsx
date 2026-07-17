"use client";

import { Alert, Button, Card, Table, Tag } from "antd";
import Link from "next/link";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { BlogArticle, GeoTestResult } from "@/lib/types";
import {
  batchQueueItems,
  dailyExecutionItems,
  exceptionItems,
  monthlyGoal,
  nextMonthCandidates,
  strategyTermHits,
  v5DemoLabel
} from "@/lib/v5-ui-mock-data";
import { useMemo } from "react";

type DashboardActionSource = "v5_mock" | "current_runtime";

interface DashboardActionItem {
  key: string;
  title: string;
  count: number;
  source: DashboardActionSource;
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

function needsGeoAction(result: GeoTestResult, candidateArticle?: BlogArticle) {
  const executionStatus = result.executionStatus || "success";
  const candidateStatus = candidateArticle?.candidateStatus || "none";

  if (candidateStatus === "planned" || candidateStatus === "dismissed") {
    return false;
  }

  return executionStatus !== "success" || candidateStatus === "candidate" || !result.mentionedJoto || !result.citedOfficialUrl;
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
  const blogActionCount = state.blogArticles.filter(needsBlogAction).length;
  const geoActionCount = state.geoResults.filter((result) => needsGeoAction(result, candidateByGeoResultId.get(result.id))).length;

  const dashboardActionItems: DashboardActionItem[] = [
    {
      key: "monthly-matrix",
      title: "月度策略与矩阵",
      count: strategyAttentionCount,
      source: "v5_mock",
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
      source: "v5_mock",
      status: "待生产处理",
      statusColor: "blue",
      description: "处理标题确认、Final Evidence Gate、生成质检、异常和文章级排程。",
      href: "/batch-generation",
      entryLabel: "进入生成中心"
    },
    {
      key: "daily-execution",
      title: "当日执行",
      count: todayExecutionCount,
      source: "v5_mock",
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
      source: "current_runtime",
      status: "V4 保持不变",
      statusColor: "green",
      description: "继续使用现有渠道数据导入、URL 匹配和手动指标补录能力。",
      href: "/publish",
      entryLabel: "进入数据回传"
    },
    {
      key: "blog-monitor",
      title: "博客监控",
      count: blogActionCount,
      source: "current_runtime",
      status: "V4 保持不变",
      statusColor: "green",
      description: "继续使用现有博客诊断、问题分布和候选池处理流程。",
      href: "/blog-monitor",
      entryLabel: "查看博客监控"
    },
    {
      key: "geo-test",
      title: "GEO 测试",
      count: geoActionCount,
      source: "current_runtime",
      status: "V4 保持不变",
      statusColor: "green",
      description: "继续使用现有平台测试、引用诊断和 GEO 缺口处理能力。",
      href: "/geo-test",
      entryLabel: "查看 GEO 测试"
    },
    {
      key: "monthly-review",
      title: "月度复盘",
      count: pendingReviewCount,
      source: "v5_mock",
      status: "候选待确认",
      statusColor: "purple",
      description: "回看 baseline / exploration、GEO 缺口并审核下月策略候选。",
      href: "/monthly-review",
      entryLabel: "进入月度复盘"
    }
  ];

  return (
    <>
      <PageHeader
        title="首页数据看板"
        subtitle="月度内容生产主流程，以及数据回传、博客和 GEO 等原有能力的统一入口。"
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
          <h2>V5 月度生产概览</h2>
          <p>只展示月度矩阵、生成准入和异常状态；当前数据尚未接入真实 V5 后端。</p>
        </div>
        <Tag>demo / mock</Tag>
      </div>
      <V5StatusRail
        items={[
          { label: "本月内容矩阵", value: `${monthlyQuota} 篇`, helper: "月度计划总配额", status: "mock" },
          { label: "样例已生成", value: generatedSampleCount, helper: `当前展示 ${batchQueueItems.length} 条队列样例`, status: "mock" },
          { label: "样例质检通过", value: passedSampleCount, helper: "硬规则与软质量均通过", status: "mock" },
          { label: "异常待处理", value: openExceptionCount, helper: "仅阻断受影响矩阵项", status: "mock" }
        ]}
      />
      <Alert
        showIcon
        type="info"
        message="V5 生产数据与现有运行态分开呈现"
        description={`${v5DemoLabel}；待回填 URL、数据回传、博客监控和 GEO 测试继续读取当前工作台运行态。`}
        style={{ marginBottom: 16 }}
      />

      <div className="dashboard-section-heading">
        <div>
          <h2>保留能力运行态</h2>
          <p>这些功能未被 V5 重构，继续沿用 V4 页面、接口和数据逻辑。</p>
        </div>
        <Tag color="green">当前运行态</Tag>
      </div>
      <div className="metric-grid metric-grid-four">
        <MetricCard title="待回填 URL" value={summary.metrics.pendingUrl} suffix="条" />
        <MetricCard title="待数据回传" value={pendingDataReturnCount} suffix="条" />
        <MetricCard title="博客待处置" value={blogActionCount} suffix="条" />
        <MetricCard title="GEO 待处置" value={geoActionCount} suffix="条" />
      </div>

      <Card title="主流程与保留能力">
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={dashboardActionItems}
          columns={[
            { title: "事项", dataIndex: "title" },
            {
              title: "数据来源",
              dataIndex: "source",
              render: (value: DashboardActionSource) => <Tag>{value === "v5_mock" ? "V5 mock" : "当前运行态"}</Tag>
            },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value} 条</Tag> },
            {
              title: "状态",
              render: (_, record) => <Tag color={record.statusColor}>{record.status}</Tag>
            },
            { title: "当前职责", dataIndex: "description" },
            {
              title: "入口",
              render: (_, record) => (
                <Link href={record.href}>
                  <Button size="small" type={record.source === "v5_mock" ? "primary" : "default"}>
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
