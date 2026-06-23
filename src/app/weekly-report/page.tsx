"use client";

import { Alert, Button, Card, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels } from "@/lib/labels";
import { promptTemplates, type PromptTemplate } from "@/lib/prompt-templates";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi } from "@/lib/client-api";
import type { BlogArticle, DistilledTerm, GeoTestResult, PublishRecord } from "@/lib/types";
import { useState } from "react";

interface WeeklyReport {
  week: string;
  executiveSummary: string;
  publishRecords: PublishRecord[];
  blogDiagnostics: BlogArticle[];
  geoResults: GeoTestResult[];
  distilledTerms?: DistilledTerm[];
  distilledTermMatrix?: DistilledTermMatrixRow[];
  promptTemplates?: PromptTemplate[];
  nextWeekSuggestions: string[];
  dataSource: string;
}

interface DistilledTermMatrixRow {
  id: string;
  term: string;
  contentCoverage: number;
  typeCompleteness: string;
  geoLift: number;
  competitorOccupied: boolean;
  nextSuggestion: string;
}

type ReportActionStep = "publish_records" | "fill_url" | "record_metrics" | "blog_candidates" | "geo_config" | "geo_candidates" | "create_next_plan" | "ready";
type WeeklySuggestionStep = "generate_report" | "review_suggestion" | "create_next_plan";

interface ReportActionItem {
  key: ReportActionStep;
  issue: string;
  count: number;
  actionText: string;
  nextStep: string;
  entryHref: string;
  entryLabel: string;
}

interface WeeklySuggestionAction {
  key: string;
  suggestion: string;
  nextStep: WeeklySuggestionStep;
  actionText: string;
  entry: { type: "button"; label: string } | { type: "link"; href: string; label: string };
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

const geoExecutionStatusLabels: Record<NonNullable<GeoTestResult["executionStatus"]>, string> = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败"
};

const reportActionStepLabels: Record<ReportActionStep, string> = {
  publish_records: "处理发布队列",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  blog_candidates: "处理博客候选",
  geo_config: "排查 GEO",
  geo_candidates: "沉淀候选",
  create_next_plan: "生成下周计划",
  ready: "可归档"
};

const reportActionStepColors: Record<ReportActionStep, string> = {
  publish_records: "red",
  fill_url: "gold",
  record_metrics: "blue",
  blog_candidates: "purple",
  geo_config: "red",
  geo_candidates: "purple",
  create_next_plan: "green",
  ready: "green"
};

const weeklySuggestionStepLabels: Record<WeeklySuggestionStep, string> = {
  generate_report: "先生成周报",
  review_suggestion: "复核建议",
  create_next_plan: "进入周计划生成预览"
};

const weeklySuggestionStepColors: Record<WeeklySuggestionStep, string> = {
  generate_report: "blue",
  review_suggestion: "gold",
  create_next_plan: "green"
};

function createReportActionItems(
  reportPublishRecords: PublishRecord[],
  reportBlogDiagnostics: BlogArticle[],
  reportGeoResults: GeoTestResult[],
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
  const geoConfigCount = reportGeoResults.filter((item) => item.executionStatus === "pending_config" || item.executionStatus === "failed").length;
  const geoCandidateCount = reportGeoResults.filter(
    (item) => (item.executionStatus || "success") === "success" && (!item.mentionedJoto || !item.citedOfficialUrl)
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
      nextStep: "用真实表现判断下周渠道分配",
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

  if (geoConfigCount) {
    actionItems.push({
      key: "geo_config",
      issue: "GEO 测试待配置或失败",
      count: geoConfigCount,
      actionText: "先排查模型配置与执行失败",
      nextStep: "诊断通过后重新运行 GEO 测试",
      entryHref: "/ai-config",
      entryLabel: "看 AI 配置"
    });
  }

  if (geoCandidateCount) {
    actionItems.push({
      key: "geo_candidates",
      issue: "GEO 命中或官网引用不足",
      count: geoCandidateCount,
      actionText: "把缺口沉淀为内容候选",
      nextStep: "加入博客候选池后进入周计划",
      entryHref: "/geo-test",
      entryLabel: "去 GEO 测试"
    });
  }

  if (!actionItems.length && hasActiveReport) {
    actionItems.push({
      key: "create_next_plan",
      issue: "本周复盘可进入下周计划",
      count: 1,
      actionText: "复核下周建议",
      nextStep: "生成下周计划草稿",
      entryHref: "/weekly-plan",
      entryLabel: "看周计划"
    });
  }

  if (!actionItems.length) {
    actionItems.push({
      key: "ready",
      issue: "先生成周报再归纳行动",
      count: 1,
      actionText: "读取当前发布、博客和 GEO 数据",
      nextStep: "点击生成周报",
      entryHref: "/weekly-report",
      entryLabel: "留在本页"
    });
  }

  return actionItems;
}

function createWeeklySuggestionActions(suggestions: string[] | undefined, hasActiveReport: boolean): WeeklySuggestionAction[] {
  const fallbackSuggestions = [
    "先点击生成周报，读取当前运行态中的发布记录、博客诊断和 GEO 测试结果。",
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
        actionText: "先生成周报，把当前发布、博客诊断和 GEO 结果固化成复盘依据。",
        entry: { type: "button", label: "生成周报" }
      };
    }

    return {
      key: `suggestion-${index}`,
      suggestion,
      nextStep: index === 0 ? "create_next_plan" : "review_suggestion",
      actionText: index === 0 ? "把这条建议带到周计划页，先生成计划预览，再人工确认。" : "复核建议对应的发布、博客或 GEO 证据，再决定是否进入下周计划。",
      entry: { type: "link", href: "/weekly-plan", label: index === 0 ? "进入周计划生成预览" : "看周计划" }
    };
  });
}

export default function WeeklyReportPage() {
  const {
    state: { blogArticles, botVisits, geoResults, publishRecords, weeklyPlan },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [generating, setGenerating] = useState(false);
  const [exportingMarkdown, setExportingMarkdown] = useState(false);
  const [report, setReport] = useState<WeeklyReport>();
  const [publishStatusFilter, setPublishStatusFilter] = useState<PublishRecord["publishStatus"][]>([]);
  const [blogGeoResultFilter, setBlogGeoResultFilter] = useState<BlogArticle["geoResult"][]>([]);
  const [geoExecutionStatusFilter, setGeoExecutionStatusFilter] = useState<NonNullable<GeoTestResult["executionStatus"]>[]>([]);
  const activeReport = report;
  const reportPublishRecords = activeReport?.publishRecords || publishRecords;
  const reportBlogDiagnostics = activeReport?.blogDiagnostics || blogArticles;
  const reportGeoResults = activeReport?.geoResults || geoResults;
  const reportDistilledTermMatrix = activeReport?.distilledTermMatrix || [];
  const reportPromptTemplates = activeReport?.promptTemplates || promptTemplates;
  const hasReportFilter = Boolean(publishStatusFilter.length || blogGeoResultFilter.length || geoExecutionStatusFilter.length);
  const filteredReportPublishRecords = reportPublishRecords.filter((item) => !publishStatusFilter.length || publishStatusFilter.includes(item.publishStatus));
  const filteredReportBlogDiagnostics = reportBlogDiagnostics.filter((item) => !blogGeoResultFilter.length || blogGeoResultFilter.includes(item.geoResult));
  const filteredReportGeoResults = reportGeoResults.filter((item) => {
    const status = item.executionStatus || "success";

    return !geoExecutionStatusFilter.length || geoExecutionStatusFilter.includes(status);
  });
  const geoJotoHits = reportGeoResults.filter((item) => item.mentionedJoto).length;
  const geoWeikeHits = reportGeoResults.filter((item) => item.mentionedWeike).length;
  const generatedCount = weeklyPlan.targetTotalCount ? Math.min(weeklyPlan.targetTotalCount, reportPublishRecords.length) : reportPublishRecords.length;
  const publishedCount = reportPublishRecords.filter((item) => item.publishStatus !== "queued").length;
  const dataReturnedCount = reportPublishRecords.filter((item) => item.channelMetrics).length;
  const publishCompletionRate = weeklyPlan.targetTotalCount ? Math.round((publishedCount / weeklyPlan.targetTotalCount) * 100) : 0;
  const dataReturnRate = publishedCount ? Math.round((dataReturnedCount / publishedCount) * 100) : 0;
  const geoHitRate = reportGeoResults.length ? Math.round((geoJotoHits / reportGeoResults.length) * 100) : 0;
  const officialDirectRate = reportGeoResults.length
    ? Math.round((reportGeoResults.filter((item) => item.citationLevel === "official_site_direct" || (item.citedOfficialUrl && !item.citationLevel)).length / reportGeoResults.length) * 100)
    : 0;
  const funnelRows = [
    { stage: "计划", count: weeklyPlan.targetTotalCount },
    { stage: "生成", count: generatedCount },
    { stage: "发布", count: publishedCount },
    { stage: "回传", count: dataReturnedCount }
  ];
  const channelRows = Object.entries(channelLabels).map(([channel, label]) => {
    const records = reportPublishRecords.filter((item) => item.channel === channel);
    const views = records.reduce((sum, item) => sum + (item.channelMetrics?.views || 0), 0);

    return {
      channel: label,
      records: records.length,
      views,
      dataReturned: records.filter((item) => item.channelMetrics).length
    };
  });
  const citationRows = ["official_site_direct", "official_content", "official_channel", "non_official", "none"].map((level) => ({
    level,
    count: reportGeoResults.filter((item) => (item.citationLevel || (item.citedOfficialUrl ? "official_site_direct" : "none")) === level).length
  }));
  const reportActionItems = createReportActionItems(reportPublishRecords, reportBlogDiagnostics, reportGeoResults, Boolean(activeReport));
  const reportActionTotal = reportActionItems.reduce((sum, item) => sum + item.count, 0);
  const highestPriorityReportAction = reportActionItems[0];
  const weeklySuggestionActions = createWeeklySuggestionActions(activeReport?.nextWeekSuggestions, Boolean(activeReport));

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
      const result = await callJsonApi<WeeklyReport>(`/api/weekly-reports/${weeklyPlan.weekStart}`, { method: "GET" });
      setReport(result);
      messageApi.success("周报已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成周报失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportMarkdown() {
    setExportingMarkdown(true);

    try {
      const result = await callJsonApi<{ message?: string; data?: { markdown?: string } }>(`/api/weekly-reports/${weeklyPlan.weekStart}/export`, { method: "GET" });
      await navigator.clipboard.writeText(result.data?.markdown || "");
      messageApi.success(result.message || "周报 Markdown 已复制");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导出周报 Markdown 失败");
    } finally {
      setExportingMarkdown(false);
    }
  }

  function clearReportFilters() {
    setPublishStatusFilter([]);
    setBlogGeoResultFilter([]);
    setGeoExecutionStatusFilter([]);
  }

  function renderWeeklySuggestionEntry(record: WeeklySuggestionAction) {
    if (record.entry.type === "button") {
      return (
        <Button size="small" type="primary" loading={generating} onClick={handleGenerateReport}>
          {record.entry.label}
        </Button>
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
        title="周度复盘"
        subtitle="用本周数据解释问题，把信号带到周计划预览，不在周报页直接覆盖计划。"
        actions={
          <>
            <Link href="/weekly-plan">
              <Button>进入周计划生成预览</Button>
            </Link>
            <Button loading={exportingMarkdown} onClick={handleExportMarkdown}>
              导出 Markdown
            </Button>
            <Button type="primary" loading={generating} onClick={handleGenerateReport}>
              生成周报
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
              <Tag color="blue">week: {activeReport.week}</Tag>
              <Tag>data: {activeReport.dataSource}</Tag>
            </Space>
          }
        />
      ) : null}
      <div className="metric-grid">
        <MetricCard title="发布完成率" value={publishCompletionRate} suffix="%" />
        <MetricCard title="数据回传率" value={dataReturnRate} suffix="%" />
        <MetricCard title="GEO 命中率" value={geoHitRate} suffix="%" />
        <MetricCard title="官网直引率" value={officialDirectRate} suffix="%" />
      </div>
      <div className="two-column">
        <Card title="管理层摘要">
          <p>
            {activeReport?.executiveSummary ||
              `本周计划 ${weeklyPlan.targetTotalCount} 篇，当前已发布 ${publishRecords.filter((item) => item.publishStatus !== "queued").length} 篇；官网博客候选主题从博客监控页沉淀。`}
          </p>
          <p className="muted">AI Bot 指标当前为 Demo 数据，只用于演示流程，不作为真实策略判断。</p>
        </Card>
        <Card title="GEO 概览">
          <p>提及 JOTO：{geoJotoHits}/{reportGeoResults.length}</p>
          <p>提及唯客：{geoWeikeHits}/{reportGeoResults.length}</p>
          <p>Demo AI Bot PV：{botVisits.reduce((sum, item) => sum + item.pv, 0)} <Tag>Demo</Tag></p>
        </Card>
      </div>
      <div className="two-column" style={{ marginTop: 16 }}>
        <Card title="本周发布漏斗">
          <Table
            rowKey="stage"
            size="small"
            pagination={false}
            dataSource={funnelRows}
            columns={[
              { title: "阶段", dataIndex: "stage" },
              { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
              {
                title: "进度",
                render: (_, record) => {
                  const denominator = Math.max(weeklyPlan.targetTotalCount, 1);
                  const width = Math.min(100, Math.round((record.count / denominator) * 100));

                  return (
                    <div style={{ background: "#eef2ff", borderRadius: 6, height: 8, overflow: "hidden" }}>
                      <div style={{ width: `${width}%`, height: 8, background: "#2255ff" }} />
                    </div>
                  );
                }
              }
            ]}
          />
        </Card>
        <Card title="渠道表现对比">
          <Table
            rowKey="channel"
            size="small"
            pagination={false}
            dataSource={channelRows}
            columns={[
              { title: "渠道", dataIndex: "channel" },
              { title: "发布", dataIndex: "records", render: (value) => <Tag>{value}</Tag> },
              { title: "阅读", dataIndex: "views" },
              { title: "已回传", dataIndex: "dataReturned" }
            ]}
          />
        </Card>
      </div>
      <div className="two-column" style={{ marginTop: 16 }}>
        <Card title="GEO 命中与引用层级">
          <Table
            rowKey="level"
            size="small"
            pagination={false}
            dataSource={citationRows}
            columns={[
              { title: "引用层级", dataIndex: "level" },
              { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> }
            ]}
          />
        </Card>
        <Card title="固定 Prompt 模板">
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={reportPromptTemplates}
            columns={[
              { title: "模板", dataIndex: "name" },
              { title: "版本", dataIndex: "version", render: (value) => <Tag color="blue">{value}</Tag> },
              { title: "使用位置", dataIndex: "usedAt" }
            ]}
          />
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
                description={publishStatusFilter.length ? "清空筛选或调整发布状态后再查看。" : "先完成终稿确认、发布标记和 URL 回填，再生成更有用的周报。"}
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
      <Card title="GEO 测试明细" style={{ marginTop: 16 }}>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按 GEO 执行状态筛选"
            value={geoExecutionStatusFilter}
            onChange={(value) => setGeoExecutionStatusFilter(value)}
            options={Object.entries(geoExecutionStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearReportFilters} disabled={!hasReportFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={filteredReportGeoResults}
          locale={{
            emptyText: (
              <ActionEmpty
                title={geoExecutionStatusFilter.length ? "当前筛选没有 GEO 测试明细" : "还没有 GEO 测试结果"}
                description={geoExecutionStatusFilter.length ? "清空筛选或调整 GEO 执行状态后再查看。" : "先运行 GEO 测试，确认三平台是否提及品牌、产品和官网链接。"}
                action={
                  geoExecutionStatusFilter.length ? (
                    <Button type="primary" onClick={clearReportFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/geo-test">
                      <Button type="primary">去 GEO 测试</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "平台", dataIndex: "platform" },
            { title: "Prompt 组", dataIndex: "promptGroup" },
            { title: "Prompt", dataIndex: "prompt" },
            { title: "提及 JOTO", dataIndex: "mentionedJoto", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "是" : "否"}</Tag> },
            { title: "提及唯客", dataIndex: "mentionedWeike", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "是" : "否"}</Tag> },
            { title: "引用官网", dataIndex: "citedOfficialUrl", render: (value) => <Tag color={value ? "green" : "gold"}>{value ? "是" : "否"}</Tag> },
            { title: "执行状态", dataIndex: "executionStatus", render: (value) => <Tag>{geoExecutionStatusLabels[(value || "success") as NonNullable<GeoTestResult["executionStatus"]>]}</Tag> },
            { title: "数据来源", dataIndex: "dataConfidence", render: (value) => <DataConfidenceTag value={value || "demo"} /> }
          ]}
        />
      </Card>
      <Card title="蒸馏词矩阵复盘" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={reportDistilledTermMatrix}
          locale={{
            emptyText: (
              <ActionEmpty
                title="还没有蒸馏词矩阵"
                description="生成周报后，系统会按蒸馏词解释本周覆盖、类型完整度、GEO 提升和竞品占位。"
                action={
                  <Button type="primary" loading={generating} onClick={handleGenerateReport}>
                    生成周报
                  </Button>
                }
              />
            )
          }}
          columns={[
            { title: "蒸馏词", dataIndex: "term" },
            { title: "内容覆盖", dataIndex: "contentCoverage", render: (value) => <Tag>{value} 篇</Tag> },
            { title: "类型完整度", dataIndex: "typeCompleteness" },
            { title: "GEO 提升", dataIndex: "geoLift", render: (value) => <Tag color={value > 10 ? "green" : "gold"}>{value}</Tag> },
            { title: "竞品占位", dataIndex: "competitorOccupied", render: (value) => <Tag color={value ? "red" : "green"}>{value ? "是" : "否"}</Tag> },
            { title: "下周建议", dataIndex: "nextSuggestion" }
          ]}
        />
      </Card>
      <Card title="下周建议" style={{ marginTop: 16 }}>
        <Table
          rowKey="key"
          pagination={false}
          dataSource={weeklySuggestionActions}
          columns={[
            { title: "建议", dataIndex: "suggestion" },
            {
              title: "下一步",
              dataIndex: "nextStep",
              render: (value) => <Tag color={weeklySuggestionStepColors[value as WeeklySuggestionStep]}>{weeklySuggestionStepLabels[value as WeeklySuggestionStep]}</Tag>
            },
            { title: "处理动作", dataIndex: "actionText" },
            {
              title: "可执行入口",
              render: (_, record) => renderWeeklySuggestionEntry(record)
            }
          ]}
        />
      </Card>
    </>
  );
}
