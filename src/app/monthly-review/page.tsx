"use client";

import { Alert, Button, Card, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi } from "@/lib/client-api";
import type { BlogArticle, PublishRecord } from "@/lib/types";
import { useState } from "react";

interface MonthlyReview {
  month: string;
  executiveSummary: string;
  publishRecords: PublishRecord[];
  blogDiagnostics: BlogArticle[];
  nextMonthSuggestions: string[];
  dataSource: string;
}

type ReportActionStep = "publish_records" | "fill_url" | "record_metrics" | "blog_candidates" | "create_next_plan" | "ready";
type MonthlySuggestionStep = "generate_report" | "review_suggestion" | "create_next_plan";

interface ReportActionItem {
  key: ReportActionStep;
  issue: string;
  count: number;
  actionText: string;
  nextStep: string;
  entryHref: string;
  entryLabel: string;
}

interface MonthlySuggestionAction {
  key: string;
  suggestion: string;
  nextStep: MonthlySuggestionStep;
  actionText: string;
  entry: { type: "button"; label: string } | { type: "confirm"; label: string } | { type: "link"; href: string; label: string };
}

const publishStatusLabels: Record<PublishRecord["publishStatus"], string> = {
  queued: "待发布",
  published: "已发布",
  url_filled: "已回填",
  failed: "失败"
};

const blogGeoResultLabels: Record<BlogArticle["geoResult"], string> = {
  hit: "命中",
  miss: "未命中",
  partial: "部分命中"
};

const reportActionStepLabels: Record<ReportActionStep, string> = {
  publish_records: "处理发布队列",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  blog_candidates: "处理博客候选",
  create_next_plan: "生成下月计划",
  ready: "可归档"
};

const reportActionStepColors: Record<ReportActionStep, string> = {
  publish_records: "red",
  fill_url: "gold",
  record_metrics: "blue",
  blog_candidates: "purple",
  create_next_plan: "green",
  ready: "green"
};

const monthlySuggestionStepLabels: Record<MonthlySuggestionStep, string> = {
  generate_report: "先生成月度复盘",
  review_suggestion: "复核建议",
  create_next_plan: "生成计划草稿"
};

const monthlySuggestionStepColors: Record<MonthlySuggestionStep, string> = {
  generate_report: "blue",
  review_suggestion: "gold",
  create_next_plan: "green"
};

function createReportActionItems(
  reportPublishRecords: PublishRecord[],
  reportBlogDiagnostics: BlogArticle[],
  hasActiveReport: boolean
): ReportActionItem[] {
  const queuedPublishCount = reportPublishRecords.filter((item) => item.publishStatus === "queued").length;
  const missingUrlCount = reportPublishRecords.filter((item) => item.publishStatus === "published" && !item.publishedUrl).length;
  const missingMetricsCount = reportPublishRecords.filter(
    (item) => (item.publishStatus === "published" || item.publishStatus === "url_filled") && !item.channelMetrics
  ).length;
  const blogCandidateCount = reportBlogDiagnostics.filter(
    (item) =>
      item.candidateStatus === "candidate" ||
      ((item.geoResult === "miss" || item.seoIssueCount > 0) && item.candidateStatus !== "planned" && item.candidateStatus !== "dismissed")
  ).length;
  const actionItems: ReportActionItem[] = [];

  if (queuedPublishCount) {
    actionItems.push({
      key: "publish_records",
      issue: "还有内容停在发布队列",
      count: queuedPublishCount,
      actionText: "确认是否已经人工发布",
      nextStep: "标记发布状态，再回填 URL",
      entryHref: "/publish",
      entryLabel: "去发布队列"
    });
  }

  if (missingUrlCount) {
    actionItems.push({
      key: "fill_url",
      issue: "已发布内容缺少 URL",
      count: missingUrlCount,
      actionText: "补齐可追踪的发布链接",
      nextStep: "回填 URL 后再录入表现指标",
      entryHref: "/publish",
      entryLabel: "回填 URL"
    });
  }

  if (missingMetricsCount) {
    actionItems.push({
      key: "record_metrics",
      issue: "已发布内容缺少渠道指标",
      count: missingMetricsCount,
      actionText: "补阅读、赞藏评转数据",
      nextStep: "用真实表现判断下月渠道分配",
      entryHref: "/publish",
      entryLabel: "录入指标"
    });
  }

  if (blogCandidateCount) {
    actionItems.push({
      key: "blog_candidates",
      issue: "博客诊断存在可转化候选",
      count: blogCandidateCount,
      actionText: "确认候选是否进入计划",
      nextStep: "生成补强任务或标记已规划",
      entryHref: "/blog-candidates",
      entryLabel: "处理候选池"
    });
  }

  if (!actionItems.length && hasActiveReport) {
    actionItems.push({
      key: "create_next_plan",
      issue: "本月复盘可进入下月计划",
      count: 1,
      actionText: "复核下月建议",
      nextStep: "生成下月计划草稿",
      entryHref: "/monthly-plan",
      entryLabel: "看月度计划"
    });
  }

  if (!actionItems.length) {
    actionItems.push({
      key: "ready",
      issue: "先生成月度复盘再归纳行动",
      count: 1,
      actionText: "读取当前发布与博客诊断数据",
      nextStep: "点击生成月度复盘",
      entryHref: "/monthly-review",
      entryLabel: "留在本页"
    });
  }

  return actionItems;
}

function createMonthlySuggestionActions(suggestions: string[] | undefined, hasActiveReport: boolean): MonthlySuggestionAction[] {
  const fallbackSuggestions = [
    "先点击生成月度复盘，读取当前运行态中的发布记录和博客诊断。",
    "真实日志和 AI Provider 接入前，AI Bot 指标只作为流程演示，不作为正式策略判断。",
    "把 SEO 问题较多或 GEO 未命中的主题优先加入博客候选池。"
  ];
  const sourceSuggestions = suggestions?.length ? suggestions : fallbackSuggestions;

  return sourceSuggestions.map((suggestion, index) => {
    if (!hasActiveReport) {
      return {
        key: `suggestion-${index}`,
        suggestion,
        nextStep: "generate_report",
        actionText: "先生成月度复盘，把当前发布、博客诊断和 GEO 结果固化成复盘依据。",
        entry: { type: "button", label: "生成月度复盘" }
      };
    }

    return {
      key: `suggestion-${index}`,
      suggestion,
      nextStep: index === 0 ? "create_next_plan" : "review_suggestion",
      actionText: index === 0 ? "确认这条建议是否要进入下月排期，并生成下月计划草稿。" : "复核建议对应的发布或博客证据，再决定是否进入下月计划。",
      entry: index === 0 ? { type: "confirm", label: "生成计划" } : { type: "link", href: "/monthly-plan", label: "看月度计划" }
    };
  });
}

export default function MonthlyReviewPage() {
  const {
    state: { blogArticles, botVisits, publishRecords, monthlyPlan },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [generating, setGenerating] = useState(false);
  const [exportingMarkdown, setExportingMarkdown] = useState(false);
  const [creatingNextPlan, setCreatingNextPlan] = useState(false);
  const [report, setReport] = useState<MonthlyReview>();
  const [publishStatusFilter, setPublishStatusFilter] = useState<PublishRecord["publishStatus"][]>([]);
  const [blogGeoResultFilter, setBlogGeoResultFilter] = useState<BlogArticle["geoResult"][]>([]);
  const activeReport = report;
  const reportPublishRecords = activeReport?.publishRecords || publishRecords;
  const reportBlogDiagnostics = activeReport?.blogDiagnostics || blogArticles;
  const hasReportFilter = Boolean(publishStatusFilter.length || blogGeoResultFilter.length);
  const filteredReportPublishRecords = reportPublishRecords.filter((item) => !publishStatusFilter.length || publishStatusFilter.includes(item.publishStatus));
  const filteredReportBlogDiagnostics = reportBlogDiagnostics.filter((item) => !blogGeoResultFilter.length || blogGeoResultFilter.includes(item.geoResult));
  const reportActionItems = createReportActionItems(reportPublishRecords, reportBlogDiagnostics, Boolean(activeReport));
  const reportActionTotal = reportActionItems.reduce((sum, item) => sum + item.count, 0);
  const highestPriorityReportAction = reportActionItems[0];
  const monthlySuggestionActions = createMonthlySuggestionActions(activeReport?.nextMonthSuggestions, Boolean(activeReport));

  function renderChannelMetrics(record: PublishRecord) {
    if (!record.channelMetrics) {
      return <Tag>待录入</Tag>;
    }

    return (
      <Space wrap size={[4, 4]}>
        <Tag>阅读 {record.channelMetrics.views ?? 0}</Tag>
        <Tag>赞 {record.channelMetrics.likes ?? 0}</Tag>
        <Tag>藏 {record.channelMetrics.favorites ?? 0}</Tag>
        <Tag>评 {record.channelMetrics.comments ?? 0}</Tag>
        <Tag>转 {record.channelMetrics.shares ?? 0}</Tag>
      </Space>
    );
  }

  async function handleGenerateReport() {
    setGenerating(true);

    try {
      const result = await callJsonApi<MonthlyReview>(`/api/monthly-reviews/${monthlyPlan.monthStart}`, { method: "GET" });
      setReport(result);
      messageApi.success("月度复盘已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成月度复盘失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportMarkdown() {
    setExportingMarkdown(true);

    try {
      const result = await callJsonApi<{ message?: string; data?: { markdown?: string } }>(`/api/monthly-reviews/${monthlyPlan.monthStart}/export`, { method: "GET" });
      await navigator.clipboard.writeText(result.data?.markdown || "");
      messageApi.success(result.message || "月度复盘 Markdown 已复制");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出月度复盘 Markdown 失败");
    } finally {
      setExportingMarkdown(false);
    }
  }

  async function handleCreateNextPlan() {
    setCreatingNextPlan(true);

    try {
      const result = await callJsonApi(`/api/monthly-reviews/${monthlyPlan.monthStart}/next-plan`, { method: "POST" });
      await refresh();
      messageApi.success(result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : "下月计划草稿已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成下月计划草稿失败");
    } finally {
      setCreatingNextPlan(false);
    }
  }

  function clearReportFilters() {
    setPublishStatusFilter([]);
    setBlogGeoResultFilter([]);
  }

  function renderMonthlySuggestionEntry(record: MonthlySuggestionAction) {
    if (record.entry.type === "button") {
      return (
        <Button size="small" type="primary" loading={generating} onClick={handleGenerateReport}>
          {record.entry.label}
        </Button>
      );
    }

    if (record.entry.type === "confirm") {
      return (
        <Popconfirm
          title="确认生成下月计划草稿？"
          description="会用当前月度复盘建议覆盖当前月度计划任务；已生成的草稿和发布队列会清空。"
          okText="生成草稿"
          cancelText="取消"
          onConfirm={handleCreateNextPlan}
        >
          <Button size="small" type="primary" loading={creatingNextPlan}>
            {record.entry.label}
          </Button>
        </Popconfirm>
      );
    }

    return (
      <Link href={record.entry.href}>
        <Button size="small">{record.entry.label}</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="月度复盘"
        subtitle="汇总渠道执行与官网博客诊断，生成下月选题建议。"
        actions={
          <>
            <Popconfirm
              title="确认生成下月计划草稿？"
              description="会用当前月度复盘建议覆盖当前月度计划任务；已生成的草稿和发布队列会清空。"
              okText="生成草稿"
              cancelText="取消"
              onConfirm={handleCreateNextPlan}
            >
              <Button loading={creatingNextPlan}>
                生成下月计划草稿
              </Button>
            </Popconfirm>
            <Button loading={exportingMarkdown} onClick={handleExportMarkdown}>
              导出 Markdown
            </Button>
            <Button type="primary" loading={generating} onClick={handleGenerateReport}>
              生成月度复盘
            </Button>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      {activeReport ? (
        <Alert
          showIcon
          type="success"
          style={{ marginBottom: 16 }}
          message={activeReport.executiveSummary}
          description={
            <Space wrap>
              <Tag color="blue">month: {activeReport.month}</Tag>
              <Tag>data: {activeReport.dataSource}</Tag>
            </Space>
          }
        />
      ) : null}
      <div className="two-column">
        <Card title="管理层摘要">
          <p>
            {activeReport?.executiveSummary ||
              `本月度计划 ${monthlyPlan.targetTotalCount} 篇，当前已发布 ${publishRecords.filter((item) => item.publishStatus !== "queued").length} 篇；官网博客候选主题从博客监控页沉淀。`}
          </p>
          <p className="muted">AI Bot 指标当前为 Demo 数据，只用于演示流程，不作为真实策略判断。</p>
        </Card>
        <Card title="AI Bot 概览">
          <p>Demo AI Bot PV：{botVisits.reduce((sum, item) => sum + item.pv, 0)} <Tag>Demo</Tag></p>
        </Card>
      </div>
      <Card title="复盘行动队列" style={{ marginTop: 16 }}>
        <Alert
          showIcon
          type={highestPriorityReportAction.key === "ready" || highestPriorityReportAction.key === "create_next_plan" ? "success" : "info"}
          message={`当前行动项 ${reportActionTotal} 个，优先处理：${reportActionStepLabels[highestPriorityReportAction.key]}`}
          description={highestPriorityReportAction.nextStep}
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="key"
          pagination={false}
          dataSource={reportActionItems}
          columns={[
            { title: "问题", dataIndex: "issue" },
            { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
            { title: "处理动作", dataIndex: "actionText" },
            {
              title: "下一步",
              dataIndex: "key",
              render: (value) => <Tag color={reportActionStepColors[value as ReportActionStep]}>{reportActionStepLabels[value as ReportActionStep]}</Tag>
            },
            {
              title: "可执行入口",
              render: (_, record) => (
                <Link href={record.entryHref}>
                  <Button size="small">{record.entryLabel}</Button>
                </Link>
              )
            }
          ]}
        />
      </Card>
      <Card title="渠道执行复盘" style={{ marginTop: 16 }}>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按发布状态筛选"
            value={publishStatusFilter}
            onChange={(value) => setPublishStatusFilter(value)}
            options={Object.entries(publishStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearReportFilters} disabled={!hasReportFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={filteredReportPublishRecords}
          locale={{
            emptyText: (
              <ActionEmpty
                title={publishStatusFilter.length ? "当前筛选没有渠道执行记录" : "还没有可复盘的发布记录"}
                description={publishStatusFilter.length ? "清空筛选或调整发布状态后再查看。" : "先完成终稿确认、发布标记和 URL 回填，再生成更有用的月度复盘。"}
                action={
                  publishStatusFilter.length ? (
                    <Button type="primary" onClick={clearReportFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/publish">
                      <Button type="primary">去发布队列</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as keyof typeof channelLabels] },
            { title: "标题", dataIndex: "title" },
            { title: "状态", dataIndex: "publishStatus", render: (value) => <Tag>{publishStatusLabels[value as PublishRecord["publishStatus"]]}</Tag> },
            {
              title: "发布 URL",
              dataIndex: "publishedUrl",
              render: (value) =>
                value ? (
                  <a className="mono" href={value} target="_blank" rel="noreferrer">
                    {value}
                  </a>
                ) : (
                  <Tag>待回填</Tag>
                )
            },
            { title: "渠道指标", render: (_, record) => renderChannelMetrics(record) }
          ]}
        />
      </Card>
      <Card title="官网博客诊断复盘" style={{ marginTop: 16 }}>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按博客 GEO 结果筛选"
            value={blogGeoResultFilter}
            onChange={(value) => setBlogGeoResultFilter(value)}
            options={Object.entries(blogGeoResultLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearReportFilters} disabled={!hasReportFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={filteredReportBlogDiagnostics}
          locale={{
            emptyText: (
              <ActionEmpty
                title={blogGeoResultFilter.length ? "当前筛选没有博客诊断记录" : "还没有博客诊断数据"}
                description={blogGeoResultFilter.length ? "清空筛选或调整博客 GEO 结果后再查看。" : "先同步官网博客或导入博客数据，再生成 SEO 与 GEO 诊断复盘。"}
                action={
                  blogGeoResultFilter.length ? (
                    <Button type="primary" onClick={clearReportFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Space>
                      <Link href="/blog-monitor">
                        <Button type="primary">去博客监控</Button>
                      </Link>
                      <Link href="/blog-candidates">
                        <Button>看候选池</Button>
                      </Link>
                    </Space>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "标题", dataIndex: "title" },
            {
              title: "URL",
              dataIndex: "url",
              render: (value) => (
                <a className="mono" href={value} target="_blank" rel="noreferrer">
                  {value}
                </a>
              )
            },
            { title: "收录", dataIndex: "indexedStatus", render: (value) => <Tag>{value}</Tag> },
            { title: "SEO 问题", dataIndex: "seoIssueCount" },
            { title: "GEO 结果", dataIndex: "geoResult", render: (value) => <Tag color={value === "hit" ? "green" : value === "miss" ? "red" : "gold"}>{blogGeoResultLabels[value as BlogArticle["geoResult"]]}</Tag> },
            { title: "候选状态", dataIndex: "candidateStatus", render: (value) => <Tag>{value || "none"}</Tag> },
            { title: "数据来源", dataIndex: "dataConfidence", render: (value) => <DataConfidenceTag value={value} /> }
          ]}
        />
      </Card>
      <Card title="下月建议" style={{ marginTop: 16 }}>
        <Table
          rowKey="key"
          pagination={false}
          dataSource={monthlySuggestionActions}
          columns={[
            { title: "建议", dataIndex: "suggestion" },
            {
              title: "下一步",
              dataIndex: "nextStep",
              render: (value) => <Tag color={monthlySuggestionStepColors[value as MonthlySuggestionStep]}>{monthlySuggestionStepLabels[value as MonthlySuggestionStep]}</Tag>
            },
            { title: "处理动作", dataIndex: "actionText" },
            {
              title: "可执行入口",
              render: (_, record) => renderMonthlySuggestionEntry(record)
            }
          ]}
        />
      </Card>
    </>
  );
}
