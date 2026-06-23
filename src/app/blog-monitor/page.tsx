"use client";

import { Alert, Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Upload, message } from "antd";
import type { UploadFile } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { DEFAULT_BLOG_SOURCE_URLS } from "@/lib/blog-source";
import { confidenceLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { BlogArticle, DataConfidence } from "@/lib/types";
import { useState } from "react";

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
    return "主题已进入规划，去周计划或候选池查看承接结果。";
  }

  if (nextStep === "dismissed") {
    return "当前已标记暂不处理，后续只需要在周报或新诊断里复看。";
  }

  return "当前没有明显处置动作，先继续观察后续 GEO 命中和 AI Bot 访问变化。";
}

export default function BlogMonitorPage() {
  const {
    state: { blogArticles, botVisits },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [syncing, setSyncing] = useState(false);
  const [importingLog, setImportingLog] = useState(false);
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
        <Link href="/weekly-plan">
          <Button size="small">看周计划</Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small">{nextStep === "dismissed" ? "去周报复盘" : "继续观察"}</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="官网博客监控"
        subtitle="XCrawl 负责内容抓取和 SEO 诊断；AI Bot 指标当前为 Demo CSV，占位未来真实日志接入。"
        actions={
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
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid">
        <Card size="small">总文章：{blogArticles.length}</Card>
        <Card size="small">SEO 问题：{blogArticles.reduce((sum, item) => sum + item.seoIssueCount, 0)}</Card>
        <Card size="small">GEO 未命中：{blogArticles.filter((item) => item.geoResult === "miss").length}</Card>
        <Card size="small">
          AI Bot PV：{botVisits.reduce((sum, item) => sum + item.pv, 0)} <DataConfidenceTag value={botConfidence} />
        </Card>
      </div>
      <div className="two-column">
        <Card title="博客数据导入">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input.TextArea
              rows={3}
              placeholder="sourceUrls，一行一个 sitemap / JSON 源"
              value={blogSourceUrls}
              onChange={(event) => setBlogSourceUrls(event.target.value)}
            />
            <Input placeholder="sourcePath，仅允许 data/、imports/ 或配置目录" value={blogSourcePath} onChange={(event) => setBlogSourcePath(event.target.value)} />
            <Input.TextArea
              rows={5}
              placeholder="JSON / CSV / sitemap XML 文本"
              value={blogText}
              onChange={(event) => setBlogText(event.target.value)}
            />
            <Popconfirm
              title="确认导入博客数据？"
              description="会写入或更新本地博客监控数据，用于后续 SEO/GEO 诊断。"
              okText="导入"
              cancelText="取消"
              onConfirm={handleSync}
            >
              <Button type="primary" loading={syncing}>
                导入博客数据
              </Button>
            </Popconfirm>
          </Space>
        </Card>
        <Card title="AI Bot 日志导入">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Select
              value={logSourceType}
              onChange={setLogSourceType}
              options={[
                { value: "csv_import", label: "CSV 导入" },
                { value: "demo_csv", label: "Demo CSV" },
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
            <Input.TextArea rows={5} placeholder="CSV 或 Nginx-like 原始日志文本" value={logText} onChange={(event) => setLogText(event.target.value)} />
            <Popconfirm
              title="确认导入 AI Bot 日志？"
              description="会更新 AI Bot PV、来源可信度和博客访问汇总。"
              okText="导入"
              cancelText="取消"
              onConfirm={handleImportLog}
            >
              <Button loading={importingLog}>
                导入日志
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      </div>
      <Card title="博客列表">
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
            { title: "标题", dataIndex: "title" },
            { title: "URL", dataIndex: "url", render: (value) => <span className="mono">{value}</span> },
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
    </>
  );
}
