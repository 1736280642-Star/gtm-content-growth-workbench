"use client";

import { Alert, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Upload, message } from "antd";
import type { UploadFile } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { SiteAuditPanel } from "@/components/SiteAuditPanel";
import { DEFAULT_BLOG_SOURCE_URLS } from "@/lib/blog-source";
import { confidenceLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { BlogArticle, DataConfidence } from "@/lib/types";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

const indexedStatusLabels: Record<BlogArticle["indexedStatus"], string> = {
  indexed: "已收录",
  unknown: "未知",
  not_indexed: "未收录"
};

const indexedStatusColors: Record<BlogArticle["indexedStatus"], string> = {
  indexed: "green",
  unknown: "gold",
  not_indexed: "red"
};

const geoResultLabels: Record<BlogArticle["geoResult"], string> = {
  hit: "命中",
  miss: "未命中",
  partial: "部分命中"
};

const geoResultColors: Record<BlogArticle["geoResult"], string> = {
  hit: "green",
  miss: "red",
  partial: "gold"
};

type BlogCandidateStatusView = NonNullable<BlogArticle["candidateStatus"]>;
type BlogPriority = "high" | "medium" | "low";
type BlogNextStep = "diagnose" | "add_candidate" | "candidate_pool" | "planned" | "observe" | "dismissed";
type BlogAuditIndicator = {
  key: string;
  label: string;
  passed: boolean;
  severity: BlogPriority;
  action: string;
};

const candidateStatusLabels: Record<BlogCandidateStatusView, string> = {
  none: "未入池",
  candidate: "已入池",
  planned: "已规划",
  dismissed: "暂不处理"
};

const candidateStatusColors: Record<BlogCandidateStatusView, string> = {
  none: "default",
  candidate: "blue",
  planned: "green",
  dismissed: "default"
};

const blogPriorityLabels: Record<BlogPriority, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

const blogPriorityColors: Record<BlogPriority, string> = {
  high: "red",
  medium: "gold",
  low: "green"
};

const blogNextStepLabels: Record<BlogNextStep, string> = {
  diagnose: "先诊断",
  add_candidate: "建议入候选池",
  candidate_pool: "候选池处理",
  planned: "已规划",
  observe: "继续观察",
  dismissed: "暂不处理"
};

const blogNextStepColors: Record<BlogNextStep, string> = {
  diagnose: "gold",
  add_candidate: "purple",
  candidate_pool: "blue",
  planned: "green",
  observe: "default",
  dismissed: "default"
};

function getCandidateStatusView(article: BlogArticle): BlogCandidateStatusView {
  return article.candidateStatus || "none";
}

function getBlogPriority(article: BlogArticle): BlogPriority {
  if (article.geoResult === "miss" || article.seoIssueCount >= 2) {
    return "high";
  }

  if (article.indexedStatus === "not_indexed" || article.geoResult === "partial" || article.seoIssueCount === 1) {
    return "medium";
  }

  return "low";
}

function getBlogGeoHealthScore(article: BlogArticle) {
  let score = 100;

  if (article.indexedStatus === "not_indexed") score -= 24;
  if (article.indexedStatus === "unknown") score -= 12;
  score -= Math.min(article.seoIssueCount * 9, 36);
  if (article.geoResult === "miss") score -= 26;
  if (article.geoResult === "partial") score -= 12;
  if (!article.title.trim() || article.title.startsWith("http")) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function getBlogAuditIndicators(article: BlogArticle): BlogAuditIndicator[] {
  const titleReady = Boolean(article.title.trim()) && !/^https?:\/\//i.test(article.title);
  const crawlerReady = article.indexedStatus !== "not_indexed";
  const structuredReady = article.seoIssueCount <= 1;
  const faqSchemaReady = article.seoIssueCount === 0 || article.geoResult === "hit";
  const clearConclusionReady = article.geoResult !== "miss";
  const officialFactReady = article.url.includes("jotoai.com") && article.geoResult !== "miss";
  const chunkReady = titleReady && structuredReady && article.geoResult !== "miss";

  return [
    {
      key: "crawler",
      label: "AI 可读取性",
      passed: crawlerReady,
      severity: crawlerReady ? "low" : "high",
      action: "检查 robots、CDN 或页面访问状态。"
    },
    {
      key: "extractable",
      label: "标题与正文可提取性",
      passed: titleReady,
      severity: titleReady ? "low" : "medium",
      action: "保证标题可解析，URL 放详情里。"
    },
    {
      key: "structure",
      label: "结构化内容完整度",
      passed: structuredReady,
      severity: structuredReady ? "low" : "medium",
      action: "补清晰小节、FAQ 或 How-to 段落。"
    },
    {
      key: "schema",
      label: "问答结构完整度",
      passed: faqSchemaReady,
      severity: faqSchemaReady ? "low" : "medium",
      action: "补 FAQ、How-to 或结构化问答。"
    },
    {
      key: "conclusion",
      label: "结论明确度",
      passed: clearConclusionReady,
      severity: clearConclusionReady ? "low" : "high",
      action: "开头和结尾补明确判断，不只解释概念。"
    },
    {
      key: "official_fact",
      label: "官方事实与产品指向",
      passed: officialFactReady,
      severity: officialFactReady ? "low" : "high",
      action: "补 JOTO / 唯客 / jotoai.com 的事实链路。"
    },
    {
      key: "chunk",
      label: "引用片段准备度",
      passed: chunkReady,
      severity: chunkReady ? "low" : "medium",
      action: "补可独立引用的小段结论和上下文。"
    }
  ];
}

function getArticleTitle(article: BlogArticle) {
  if (!article.title.trim() || /^https?:\/\//i.test(article.title)) {
    return "";
  }

  return article.title;
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

function getBlogSuggestionReason(article: BlogArticle): string {
  if (article.candidateReason) {
    return article.candidateReason;
  }

  if (article.geoResult === "miss") {
    return "GEO 未命中，建议补强官网内容或转入渠道选题。";
  }

  if (article.indexedStatus === "not_indexed") {
    return "官网未收录，建议先检查索引和页面基础 SEO。";
  }

  if (article.seoIssueCount > 0) {
    return `存在 ${article.seoIssueCount} 个 SEO 问题，建议进入优化候选池。`;
  }

  if (article.geoResult === "partial") {
    return "GEO 部分命中，可继续观察并补强关键事实。";
  }

  if (article.indexedStatus === "unknown") {
    return "收录状态未知，建议先完成诊断后再判断是否入池。";
  }

  return "暂无明显问题，继续观察 AI Bot 访问和后续 GEO 表现。";
}

function getBlogActionText(article: BlogArticle): string {
  const nextStep = getBlogNextStep(article);

  if (nextStep === "diagnose") {
    return "先补一次诊断，确认收录、SEO 和 GEO 状态，再决定是否进入候选池。";
  }

  if (nextStep === "add_candidate") {
    return "当前问题已经足够明确，优先加入候选池，交给后续规划或生成任务处理。";
  }

  if (nextStep === "candidate_pool") {
    return "主题已经入池，下一步去候选池判断是生成任务、标记规划还是继续观察。";
  }

  if (nextStep === "planned") {
    return "主题已进入规划，去月度计划或候选池查看承接结果。";
  }

  if (nextStep === "dismissed") {
    return "当前已标记暂不处理，后续只需要在月度复盘或新诊断里复看。";
  }

  return "当前没有明显处置动作，先继续观察后续 GEO 命中和 AI Bot 访问变化。";
}

function BlogMonitorTabs({ activeKey }: { activeKey: "articles" | "diagnosis" | "site-audit" }) {
  return (
    <Tabs
      className="blog-monitor-section-tabs"
      activeKey={activeKey}
      items={[
        { key: "articles", label: <Link href="/blog-monitor">文章监控</Link> },
        { key: "diagnosis", label: <Link href="/blog-monitor#content-diagnosis">内容诊断</Link> },
        { key: "site-audit", label: <Link href="/blog-monitor?tab=site-audit">官网审计 P1</Link> }
      ]}
    />
  );
}

export default function BlogMonitorPage() {
  const searchParams = useSearchParams();
  const {
    state: { blogArticles, botVisits, workspaceSetting },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [syncing, setSyncing] = useState(false);
  const [importingLog, setImportingLog] = useState(false);
  const [blogImportOpen, setBlogImportOpen] = useState(false);
  const [logImportOpen, setLogImportOpen] = useState(false);
  const [diagnosingId, setDiagnosingId] = useState<string>();
  const [addingCandidateId, setAddingCandidateId] = useState<string>();
  const [blogSourceUrls, setBlogSourceUrls] = useState(DEFAULT_BLOG_SOURCE_URLS.join("\n"));
  const [blogSourcePath, setBlogSourcePath] = useState("");
  const [blogText, setBlogText] = useState("");
  const [logSourceType, setLogSourceType] = useState("csv_import");
  const [logFilePath, setLogFilePath] = useState("");
  const [logText, setLogText] = useState("");
  const [logFiles, setLogFiles] = useState<UploadFile[]>([]);
  const [indexedStatusFilter, setIndexedStatusFilter] = useState<BlogArticle["indexedStatus"][]>([]);
  const [geoResultFilter, setGeoResultFilter] = useState<BlogArticle["geoResult"][]>([]);
  const [dataConfidenceFilter, setDataConfidenceFilter] = useState<DataConfidence[]>([]);
  const siteAuditActive = searchParams.get("tab") === "site-audit";

  if (siteAuditActive) {
    return (
      <>
        <PageHeader title="官网博客监控" subtitle="在同一工作区查看文章表现与 P1 官网审计；两套对象、状态和指标保持独立。" />
        <BlogMonitorTabs activeKey="site-audit" />
        <SiteAuditPanel role={workspaceSetting.currentRole} />
      </>
    );
  }
  const botConfidence = botVisits.some((item) => item.dataConfidence === "real")
    ? "real"
    : botVisits.some((item) => item.dataConfidence === "imported")
      ? "imported"
      : "demo";
  const hasActiveFilter = Boolean(indexedStatusFilter.length || geoResultFilter.length || dataConfidenceFilter.length);
  const filteredBlogArticles = blogArticles.filter((article) => {
    const indexedMatched = !indexedStatusFilter.length || indexedStatusFilter.includes(article.indexedStatus);
    const geoMatched = !geoResultFilter.length || geoResultFilter.includes(article.geoResult);
    const confidenceMatched = !dataConfidenceFilter.length || dataConfidenceFilter.includes(article.dataConfidence);

    return indexedMatched && geoMatched && confidenceMatched;
  });
  const visibleActionNeededCount = filteredBlogArticles.filter((article) => {
    const nextStep = getBlogNextStep(article);

    return nextStep === "diagnose" || nextStep === "add_candidate";
  }).length;
  const visibleCandidateCount = filteredBlogArticles.filter((article) => getBlogNextStep(article) === "candidate_pool").length;
  const visiblePlannedCount = filteredBlogArticles.filter((article) => getBlogNextStep(article) === "planned").length;
  const visibleObserveCount = filteredBlogArticles.filter((article) => getBlogNextStep(article) === "observe").length;
  const visibleDismissedCount = filteredBlogArticles.filter((article) => getBlogNextStep(article) === "dismissed").length;
  const auditRows = blogArticles.map((article) => ({
    article,
    indicators: getBlogAuditIndicators(article),
    healthScore: getBlogGeoHealthScore(article)
  }));
  const auditFailures = auditRows.flatMap((row) => row.indicators.filter((indicator) => !indicator.passed).map((indicator) => ({ ...indicator, article: row.article })));
  const issueDistribution = Object.values(
    auditFailures.reduce<Record<string, { key: string; label: string; count: number; high: number; action: string }>>((groups, issue) => {
      const current = groups[issue.key] || {
        key: issue.key,
        label: issue.label,
        count: 0,
        high: 0,
        action: issue.action
      };
      groups[issue.key] = {
        ...current,
        count: current.count + 1,
        high: current.high + (issue.severity === "high" ? 1 : 0)
      };
      return groups;
    }, {})
  ).sort((left, right) => right.high - left.high || right.count - left.count);
  const citationWeakCount = auditRows.filter((row) => row.indicators.some((item) => !item.passed && (item.key === "conclusion" || item.key === "official_fact" || item.key === "schema"))).length;
  const chunkWeakCount = auditRows.filter((row) => row.indicators.some((item) => !item.passed && item.key === "chunk")).length;
  const healthScore = blogArticles.length ? Math.round(auditRows.reduce((sum, row) => sum + row.healthScore, 0) / blogArticles.length) : 0;
  const priorityActions = [...blogArticles]
    .map((article) => {
      const indicators = getBlogAuditIndicators(article).filter((indicator) => !indicator.passed);
      const highCount = indicators.filter((indicator) => indicator.severity === "high").length;

      return {
        article,
        healthScore: getBlogGeoHealthScore(article),
        indicators,
        highCount,
        nextStep: getBlogNextStep(article)
      };
    })
    .filter((item) => item.indicators.length || item.nextStep === "add_candidate" || item.nextStep === "diagnose")
    .sort((left, right) => right.highCount - left.highCount || left.healthScore - right.healthScore)
    .slice(0, 5);

  function clearFilters() {
    setIndexedStatusFilter([]);
    setGeoResultFilter([]);
    setDataConfidenceFilter([]);
  }

  async function handleSync() {
    setSyncing(true);

    try {
      const payload: Record<string, unknown> = {};

      payload.sourceUrls = blogSourceUrls
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (blogSourcePath.trim()) {
        payload.sourcePath = blogSourcePath.trim();
      }

      if (blogText.trim()) {
        payload.text = blogText.trim();
      }

      const result = await callJsonApi("/api/blog-articles/sync", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "博客同步完成"));
      setBlogImportOpen(false);
    } catch (error) {
      messageApi.warning(error instanceof Error ? error.message : "博客同步缺少配置");
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportLog() {
    setImportingLog(true);

    try {
      let result: unknown;

      if (logFiles.length) {
        const formData = new FormData();
        formData.append("sourceType", logSourceType);

        for (const file of logFiles) {
          if (file.originFileObj) {
            formData.append("files", file.originFileObj);
          }
        }

        if (logText.trim()) {
          formData.append("text", logText.trim());
        }

        const response = await fetch("/api/log-imports", {
          method: "POST",
          body: formData
        });
        result = await response.json();

        if (!response.ok) {
          throw new Error((result as { message?: string }).message || `Request failed: ${response.status}`);
        }
      } else {
        const payload: Record<string, unknown> = {
          sourceType: logSourceType
        };

        if (logFilePath.trim()) {
          payload.filePath = logFilePath.trim();
        }

        if (logText.trim()) {
          payload.csv = logText.trim();
        }

        result = await callJsonApi("/api/log-imports", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      await refresh();
      messageApi.success(formatApiMessage(result, "日志导入完成"));
      setLogFiles([]);
      setLogImportOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "日志导入失败");
    } finally {
      setImportingLog(false);
    }
  }

  async function handleDiagnose(id: string) {
    setDiagnosingId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/diagnose`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "博客诊断完成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "博客诊断失败");
    } finally {
      setDiagnosingId(undefined);
    }
  }

  async function handleAddCandidate(id: string) {
    setAddingCandidateId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/candidate`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "已加入博客候选池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加入候选池失败");
    } finally {
      setAddingCandidateId(undefined);
    }
  }

  function renderBlogEntry(article: BlogArticle) {
    const nextStep = getBlogNextStep(article);
    const candidateStatus = getCandidateStatusView(article);
    const candidateLocked = candidateStatus === "candidate" || candidateStatus === "planned" || candidateStatus === "dismissed";

    if (nextStep === "diagnose") {
      return (
        <Button size="small" loading={diagnosingId === article.id} onClick={() => handleDiagnose(article.id)}>
          诊断
        </Button>
      );
    }

    if (nextStep === "add_candidate") {
      return (
        <Button
          size="small"
          type="primary"
          loading={addingCandidateId === article.id}
          disabled={candidateLocked}
          onClick={() => handleAddCandidate(article.id)}
        >
          入候选池
        </Button>
      );
    }

    if (nextStep === "candidate_pool") {
      return (
        <Link href="/blog-candidates">
          <Button size="small">去候选池</Button>
        </Link>
      );
    }

    if (nextStep === "planned") {
      return (
        <Link href="/monthly-plan">
          <Button size="small">看月度计划</Button>
        </Link>
      );
    }

    return (
      <Link href="/monthly-review">
        <Button size="small">{nextStep === "dismissed" ? "去月度复盘" : "继续观察"}</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="官网博客监控"
        subtitle="集中查看内容收录、SEO 问题、AI 访问趋势和优先优化建议。"
        actions={
          <Space wrap>
            <Popconfirm
              title="确认同步博客内容？"
              description="会根据当前输入或配置源写入博客监控数据，并刷新候选池判断。"
              okText="同步"
              cancelText="取消"
              onConfirm={handleSync}
            >
              <Button type="primary" loading={syncing}>
                同步博客内容
              </Button>
            </Popconfirm>
            <Button onClick={() => setBlogImportOpen(true)}>博客数据导入</Button>
            <Button onClick={() => setLogImportOpen(true)}>AI 访问日志导入</Button>
          </Space>
        }
      />
      <BlogMonitorTabs activeKey="articles" />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="监控文章" value={blogArticles.length} suffix="篇" />
        <MetricCard title="待处理问题" value={auditFailures.length} suffix="个" />
        <MetricCard title="GEO 健康分" value={healthScore} />
        <MetricCard title="引用准备不足" value={citationWeakCount} suffix="篇" />
        <MetricCard title="引用片段不足" value={chunkWeakCount} suffix="篇" />
      </div>
      <div className="two-column" style={{ marginBottom: 16 }}>
        <Card title="问题分布">
          <Alert
            showIcon
            type={auditFailures.length ? "warning" : "success"}
            message={`当前发现 ${auditFailures.length} 个 AI 可见度问题，AI 访问量 ${botVisits.reduce((sum, item) => sum + item.pv, 0)}`}
            description={<DataConfidenceTag value={botConfidence} />}
            style={{ marginBottom: 16 }}
          />
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={issueDistribution}
            locale={{ emptyText: "当前没有明显页面审计问题。" }}
            columns={[
              { title: "问题类型", dataIndex: "label" },
              { title: "数量", dataIndex: "count", render: (value) => <Tag>{value}</Tag> },
              { title: "高优先级", dataIndex: "high", render: (value) => <Tag color={value ? "red" : "green"}>{value}</Tag> },
              { title: "建议动作", dataIndex: "action" }
            ]}
          />
        </Card>
        <Card title="官网信源状态">
          <Table
            rowKey="label"
            size="small"
            pagination={false}
            dataSource={[
              { label: "可作为信源", value: auditRows.filter((row) => row.healthScore >= 80).length, color: "green" },
              { label: "部分可用", value: auditRows.filter((row) => row.healthScore >= 60 && row.healthScore < 80).length, color: "gold" },
              { label: "不建议引用", value: auditRows.filter((row) => row.healthScore < 60).length, color: "red" },
              { label: "AI 访问量", value: botVisits.reduce((sum, item) => sum + item.pv, 0), color: "blue" }
            ]}
            columns={[
              { title: "状态", dataIndex: "label" },
              { title: "数量", render: (_, record) => <Tag color={record.color}>{record.value}</Tag> }
            ]}
          />
          <p className="muted" style={{ marginTop: 12 }}>
            这里是基于现有收录、SEO、GEO 和日志导入状态的页面可引用性判断，不替代真实服务器日志。
          </p>
        </Card>
      </div>
      <Card title="优先处理问题" style={{ marginBottom: 16 }}>
        <Table
          rowKey={(record) => record.article.id}
          size="small"
          pagination={false}
          dataSource={priorityActions}
          locale={{ emptyText: "当前没有需要优先处理的博客问题。" }}
          columns={[
            { title: "标题", render: (_, record) => getArticleTitle(record.article) || <span className="muted">空标题</span> },
            { title: "GEO 健康分", dataIndex: "healthScore", render: (value) => <Tag color={value >= 80 ? "green" : value >= 60 ? "gold" : "red"}>{value}</Tag> },
            {
              title: "主要问题",
              render: (_, record) => (
                <Space wrap size={[4, 4]}>
                  {record.indicators.slice(0, 3).map((indicator) => (
                    <Tag key={indicator.key} color={blogPriorityColors[indicator.severity]}>
                      {indicator.label}
                    </Tag>
                  ))}
                </Space>
              )
            },
            { title: "建议动作", render: (_, record) => record.indicators[0]?.action || getBlogActionText(record.article) },
            {
              title: "入口",
              render: (_, record) => renderBlogEntry(record.article)
            }
          ]}
        />
      </Card>
      <Card title="博客明细">
        <Alert
          showIcon
          type={visibleActionNeededCount ? "info" : "success"}
          message={`博客监控共 ${filteredBlogArticles.length} 篇，待诊断/待优化 ${visibleActionNeededCount} 篇，已入候选池 ${visibleCandidateCount} 篇，已规划 ${visiblePlannedCount} 篇`}
          description={`可继续观察 ${visibleObserveCount} 篇，暂不处理 ${visibleDismissedCount} 篇。`}
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按收录状态筛选"
            value={indexedStatusFilter}
            onChange={(value) => setIndexedStatusFilter(value)}
            options={Object.entries(indexedStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按 GEO 结果筛选"
            value={geoResultFilter}
            onChange={(value) => setGeoResultFilter(value)}
            options={Object.entries(geoResultLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按数据来源筛选"
            value={dataConfidenceFilter}
            onChange={(value) => setDataConfidenceFilter(value)}
            options={Object.entries(confidenceLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredBlogArticles}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有博客记录" : "还没有博客监控数据"}
                description={hasActiveFilter ? "清空筛选或调整收录、GEO、数据来源条件后再查看。" : "导入 sitemap、JSON、CSV 或配置 XCrawl 源后，再做 SEO/GEO 诊断。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Popconfirm
                      title="确认同步博客内容？"
                      description="会根据当前输入或配置源写入博客监控数据，并刷新候选池判断。"
                      okText="同步"
                      cancelText="取消"
                      onConfirm={handleSync}
                    >
                      <Button type="primary" loading={syncing}>
                        同步博客内容
                      </Button>
                    </Popconfirm>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "标题", render: (_, record) => getArticleTitle(record) || <span className="muted">空标题</span> },
            {
              title: "GEO 健康分",
              render: (_, record) => {
                const score = getBlogGeoHealthScore(record);

                return <Tag color={score >= 80 ? "green" : score >= 60 ? "gold" : "red"}>{score}</Tag>;
              }
            },
            {
              title: "引用准备度",
              render: (_, record) => {
                const ready = getBlogAuditIndicators(record).every((item) => item.passed || !["schema", "conclusion", "official_fact"].includes(item.key));

                return <Tag color={ready ? "green" : "gold"}>{ready ? "可用" : "不足"}</Tag>;
              }
            },
            {
              title: "引用片段准备度",
              render: (_, record) => {
                const ready = getBlogAuditIndicators(record).find((item) => item.key === "chunk")?.passed;

                return <Tag color={ready ? "green" : "gold"}>{ready ? "可引用" : "不足"}</Tag>;
              }
            },
            { title: "URL 详情", dataIndex: "url", render: (value) => <span className="mono">{value}</span> },
            { title: "收录", dataIndex: "indexedStatus", render: (value) => <Tag color={indexedStatusColors[value as BlogArticle["indexedStatus"]]}>{indexedStatusLabels[value as BlogArticle["indexedStatus"]]}</Tag> },
            { title: "SEO 问题", dataIndex: "seoIssueCount" },
            { title: "GEO 结果", dataIndex: "geoResult", render: (value) => <Tag color={geoResultColors[value as BlogArticle["geoResult"]]}>{geoResultLabels[value as BlogArticle["geoResult"]]}</Tag> },
            {
              title: "候选状态",
              render: (_, record) => {
                const candidateStatus = getCandidateStatusView(record);

                return <Tag color={candidateStatusColors[candidateStatus]}>{candidateStatusLabels[candidateStatus]}</Tag>;
              }
            },
            {
              title: "优先级",
              render: (_, record) => {
                const priority = getBlogPriority(record);

                return <Tag color={blogPriorityColors[priority]}>{blogPriorityLabels[priority]}</Tag>;
              }
            },
            { title: "建议原因", render: (_, record) => getBlogSuggestionReason(record) },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getBlogNextStep(record);

                return <Tag color={blogNextStepColors[nextStep]}>{blogNextStepLabels[nextStep]}</Tag>;
              }
            },
            { title: "处理动作", render: (_, record) => getBlogActionText(record) },
            { title: "日志可信度", dataIndex: "dataConfidence", render: (value) => <DataConfidenceTag value={value} /> },
            {
              title: "可执行入口",
              render: (_, record) => renderBlogEntry(record)
            }
          ]}
        />
      </Card>
      <Modal
        title="博客数据导入"
        open={blogImportOpen}
        okText="导入博客数据"
        cancelText="关闭"
        confirmLoading={syncing}
        onOk={handleSync}
        onCancel={() => setBlogImportOpen(false)}
        width={760}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            rows={3}
            placeholder="sourceUrls，一行一个 sitemap / JSON 源"
            value={blogSourceUrls}
            onChange={(event) => setBlogSourceUrls(event.target.value)}
          />
          <Input placeholder="sourcePath，仅允许 data/、imports/ 或配置目录" value={blogSourcePath} onChange={(event) => setBlogSourcePath(event.target.value)} />
          <Input.TextArea
            rows={6}
            placeholder="JSON / CSV / sitemap XML 文本"
            value={blogText}
            onChange={(event) => setBlogText(event.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        title="AI 访问日志导入"
        open={logImportOpen}
        okText="导入日志"
        cancelText="关闭"
        confirmLoading={importingLog}
        onOk={handleImportLog}
        onCancel={() => setLogImportOpen(false)}
        width={760}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            value={logSourceType}
            onChange={setLogSourceType}
            options={[
              { value: "csv_import", label: "CSV 导入" },
              { value: "demo_csv", label: "样例数据" },
              { value: "nginx_log", label: "Nginx 日志" },
              { value: "cdn_log", label: "CDN 日志" }
            ]}
          />
          <Upload
            multiple
            accept=".csv,.txt,.log,.gz"
            beforeUpload={() => false}
            fileList={logFiles}
            onChange={({ fileList }) => setLogFiles(fileList)}
          >
            <Button>选择日志文件</Button>
          </Upload>
          <Input placeholder="filePath，仅允许 data/、imports/ 或配置目录；人工导入优先用上方选择文件" value={logFilePath} onChange={(event) => setLogFilePath(event.target.value)} />
          <Input.TextArea rows={6} placeholder="CSV 或 Nginx-like 原始日志文本" value={logText} onChange={(event) => setLogText(event.target.value)} />
        </Space>
      </Modal>
    </>
  );
}
