"use client";

import { Alert, Button, Card, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageHeader } from "@/components/PageHeader";
import { DataConfidenceTag } from "@/components/DataConfidenceTag";
import { PageErrorState } from "@/components/PageErrorState";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { confidenceLabels } from "@/lib/labels";
import type { BlogArticle, DataConfidence } from "@/lib/types";
import { useState } from "react";

type CandidateSource = "geo" | "seo" | "manual";
type CandidatePriority = "high" | "medium";
type CandidateStatusView = "auto_suggested" | "candidate" | "planned";
type CandidateNextStep = "confirm_candidate" | "create_task" | "mark_planned" | "review_source" | "planned";

type CandidateRow = BlogArticle & {
  source: CandidateSource;
  reason: string;
  priority: CandidatePriority;
  candidateStatusView: CandidateStatusView;
};

const candidateSourceLabels: Record<CandidateSource, string> = {
  geo: "GEO 测试",
  seo: "SEO 诊断",
  manual: "人工加入"
};

const candidatePriorityLabels: Record<CandidatePriority, string> = {
  high: "高",
  medium: "中"
};

const candidateStatusLabels: Record<CandidateStatusView, string> = {
  auto_suggested: "自动建议",
  candidate: "已入池",
  planned: "已规划"
};

const candidateStatusColors: Record<CandidateStatusView, string> = {
  auto_suggested: "default",
  candidate: "blue",
  planned: "green"
};

const candidateNextStepLabels: Record<CandidateNextStep, string> = {
  confirm_candidate: "确认入池",
  create_task: "生成任务",
  mark_planned: "标记规划",
  review_source: "复查来源",
  planned: "已规划"
};

const candidateNextStepColors: Record<CandidateNextStep, string> = {
  confirm_candidate: "purple",
  create_task: "red",
  mark_planned: "blue",
  review_source: "gold",
  planned: "green"
};

function getCandidateNextStep(candidate: CandidateRow): CandidateNextStep {
  if (candidate.candidateStatusView === "planned") {
    return "planned";
  }

  if (candidate.dataConfidence === "pending") {
    return "review_source";
  }

  if (candidate.candidateStatusView === "auto_suggested") {
    return "confirm_candidate";
  }

  if (candidate.priority === "high") {
    return "create_task";
  }

  return "mark_planned";
}

function getCandidateActionText(candidate: CandidateRow) {
  const nextStep = getCandidateNextStep(candidate);

  if (nextStep === "confirm_candidate") {
    return "先确认是否真的要纳入候选池，再决定生成补强任务或移出。";
  }

  if (nextStep === "create_task") {
    return "优先生成渠道补强任务，让 GEO/SEO 缺口进入当前周计划。";
  }

  if (nextStep === "mark_planned") {
    return "暂不生成任务时，先标记已规划，避免候选池重复提醒。";
  }

  if (nextStep === "review_source") {
    return "先回博客监控页补同步来源或诊断记录，再进入候选处理。";
  }

  return "已进入规划，可去周计划页查看后续排期和任务承接。";
}

export default function BlogCandidatesPage() {
  const {
    state: { blogArticles },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [addingCandidateId, setAddingCandidateId] = useState<string>();
  const [planningCandidateId, setPlanningCandidateId] = useState<string>();
  const [dismissingCandidateId, setDismissingCandidateId] = useState<string>();
  const [creatingTaskId, setCreatingTaskId] = useState<string>();
  const [sourceFilter, setSourceFilter] = useState<CandidateSource[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<CandidatePriority[]>([]);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<CandidateStatusView[]>([]);
  const [dataConfidenceFilter, setDataConfidenceFilter] = useState<DataConfidence[]>([]);
  const candidates: CandidateRow[] = blogArticles
    .filter((item) => item.candidateStatus !== "dismissed")
    .filter((item) => item.candidateStatus === "candidate" || item.candidateStatus === "planned" || item.seoIssueCount > 0 || item.geoResult === "miss")
    .map((item) => ({
      ...item,
      source: item.geoResult === "miss" ? "geo" : item.seoIssueCount > 0 ? "seo" : "manual",
      reason:
        item.candidateReason ||
        (item.geoResult === "miss"
          ? "GEO 测试未命中，建议补强官网内容。"
          : item.seoIssueCount > 0
            ? `存在 ${item.seoIssueCount} 个 SEO 问题。`
            : "建议继续观察。"),
      priority: item.geoResult === "miss" || item.seoIssueCount >= 2 ? "high" : "medium",
      candidateStatusView: item.candidateStatus === "candidate" || item.candidateStatus === "planned" ? item.candidateStatus : "auto_suggested"
    }));
  const hasActiveFilter = Boolean(sourceFilter.length || priorityFilter.length || candidateStatusFilter.length || dataConfidenceFilter.length);
  const filteredCandidates = candidates.filter((item) => {
    const sourceMatched = !sourceFilter.length || sourceFilter.includes(item.source);
    const priorityMatched = !priorityFilter.length || priorityFilter.includes(item.priority);
    const statusMatched = !candidateStatusFilter.length || candidateStatusFilter.includes(item.candidateStatusView);
    const confidenceMatched = !dataConfidenceFilter.length || dataConfidenceFilter.includes(item.dataConfidence);

    return sourceMatched && priorityMatched && statusMatched && confidenceMatched;
  });
  const visibleConfirmCount = filteredCandidates.filter((item) => getCandidateNextStep(item) === "confirm_candidate").length;
  const visibleCreateTaskCount = filteredCandidates.filter((item) => getCandidateNextStep(item) === "create_task").length;
  const visibleMarkPlannedCount = filteredCandidates.filter((item) => getCandidateNextStep(item) === "mark_planned").length;
  const visibleReviewSourceCount = filteredCandidates.filter((item) => getCandidateNextStep(item) === "review_source").length;
  const visiblePlannedCount = filteredCandidates.filter((item) => getCandidateNextStep(item) === "planned").length;
  const highestPriorityCandidate = filteredCandidates.find((item) => getCandidateNextStep(item) !== "planned");

  function clearFilters() {
    setSourceFilter([]);
    setPriorityFilter([]);
    setCandidateStatusFilter([]);
    setDataConfidenceFilter([]);
  }

  function handleExport() {
    const exportCandidates = hasActiveFilter ? filteredCandidates : candidates;
    const csv = [
      "id,title,url,source,reason,priority,status",
      ...exportCandidates.map((item) =>
        [
          item.id,
          `"${item.title.replace(/"/g, '""')}"`,
          item.url,
          candidateSourceLabels[item.source],
          `"${item.reason.replace(/"/g, '""')}"`,
          candidatePriorityLabels[item.priority],
          candidateStatusLabels[item.candidateStatusView]
        ].join(",")
      )
    ].join("\n");

    void navigator.clipboard.writeText(csv);
    messageApi.success("候选清单 CSV 已复制到剪贴板");
  }

  async function handleAddCandidate(id: string) {
    setAddingCandidateId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/candidate`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "候选主题已确认入池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认入池失败");
    } finally {
      setAddingCandidateId(undefined);
    }
  }

  async function handleMarkPlanned(id: string) {
    setPlanningCandidateId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/candidate`, {
        method: "PATCH",
        body: JSON.stringify({ status: "planned" })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "候选主题已标记为已规划"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "标记已规划失败");
    } finally {
      setPlanningCandidateId(undefined);
    }
  }

  async function handleDismissCandidate(id: string) {
    setDismissingCandidateId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/candidate`, { method: "DELETE" });
      await refresh();
      messageApi.success(formatApiMessage(result, "候选主题已移出候选池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "移出候选池失败");
    } finally {
      setDismissingCandidateId(undefined);
    }
  }

  async function handleCreateContentTask(id: string) {
    setCreatingTaskId(id);

    try {
      const result = await callJsonApi(`/api/blog-articles/${id}/candidate/task`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "渠道补强任务已生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成渠道补强任务失败");
    } finally {
      setCreatingTaskId(undefined);
    }
  }

  function renderCandidateEntry(record: CandidateRow) {
    const nextStep = getCandidateNextStep(record);

    if (nextStep === "confirm_candidate") {
      return (
        <Popconfirm
          title="确认加入候选池？"
          description="会把自动建议沉淀为候选主题，后续可生成渠道补强任务或标记规划。"
          okText="入池"
          cancelText="取消"
          onConfirm={() => handleAddCandidate(record.id)}
        >
          <Button size="small" type="primary" loading={addingCandidateId === record.id}>
            确认入池
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "create_task") {
      return (
        <Popconfirm
          title="确认生成渠道补强任务？"
          description="会在当前周计划下新增一条计划任务，并把该候选主题标记为已规划。"
          okText="生成任务"
          cancelText="取消"
          onConfirm={() => handleCreateContentTask(record.id)}
        >
          <Button size="small" type="primary" loading={creatingTaskId === record.id}>
            生成任务
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "mark_planned") {
      return (
        <Popconfirm
          title="确认标记为已规划？"
          description="会保留候选记录，并表示这个主题已经进入后续博客规划。"
          okText="标记"
          cancelText="取消"
          onConfirm={() => handleMarkPlanned(record.id)}
        >
          <Button size="small" type="primary" loading={planningCandidateId === record.id}>
            标记已规划
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "review_source") {
      return (
        <Link href="/blog-monitor">
          <Button size="small" type="primary">
            复查来源
          </Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-plan">
        <Button size="small">看周计划</Button>
      </Link>
    );
  }

  function renderCandidateMaintenance(record: CandidateRow) {
    return (
      <Space>
        <Popconfirm
          title="确认标记为已规划？"
          description="会保留候选记录，并表示这个主题已经进入后续博客规划。"
          okText="标记"
          cancelText="取消"
          onConfirm={() => handleMarkPlanned(record.id)}
        >
          <Button size="small" loading={planningCandidateId === record.id} disabled={record.candidateStatus === "planned"}>
            标记已规划
          </Button>
        </Popconfirm>
        <Popconfirm
          title="确认移出候选池？"
          description="会把该主题标记为暂不处理，后续 SEO/GEO 自动建议也不会再显示在候选池。"
          okText="移出"
          cancelText="取消"
          onConfirm={() => handleDismissCandidate(record.id)}
        >
          <Button size="small" danger loading={dismissingCandidateId === record.id}>
            移出
          </Button>
        </Popconfirm>
      </Space>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="博客候选池"
        subtitle="沉淀建议新增或优化的博客主题；MVP 阶段不触发博客创作。"
        actions={<Button type="primary" onClick={handleExport}>导出候选清单</Button>}
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Card>
        <Alert
          showIcon
          type={visibleCreateTaskCount ? "warning" : visibleConfirmCount || visibleReviewSourceCount ? "info" : "success"}
          message={`候选主题共 ${filteredCandidates.length} 个，待确认入池 ${visibleConfirmCount} 个，建议生成任务 ${visibleCreateTaskCount} 个`}
          description={
            highestPriorityCandidate
              ? `当前优先处理：${highestPriorityCandidate.title}。${getCandidateActionText(highestPriorityCandidate)}`
              : `可标记规划 ${visibleMarkPlannedCount} 个，已规划 ${visiblePlannedCount} 个，待复查来源 ${visibleReviewSourceCount} 个。`
          }
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按来源筛选"
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value)}
            options={Object.entries(candidateSourceLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按优先级筛选"
            value={priorityFilter}
            onChange={(value) => setPriorityFilter(value)}
            options={Object.entries(candidatePriorityLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按候选状态筛选"
            value={candidateStatusFilter}
            onChange={(value) => setCandidateStatusFilter(value)}
            options={Object.entries(candidateStatusLabels).map(([value, label]) => ({ value, label }))}
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
          dataSource={filteredCandidates}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有博客候选主题" : "暂时没有博客候选主题"}
                description={hasActiveFilter ? "清空筛选或调整来源、优先级、状态、数据来源条件后再查看。" : "先在博客监控页同步博客并执行诊断，系统会把 SEO/GEO 缺口沉淀到这里。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/blog-monitor">
                      <Button type="primary">去博客监控</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "标题建议", dataIndex: "title" },
            { title: "来源", dataIndex: "source", render: (value) => <Tag>{candidateSourceLabels[value as CandidateSource]}</Tag> },
            { title: "原因", dataIndex: "reason" },
            { title: "优先级", dataIndex: "priority", render: (value) => <Tag color={value === "high" ? "red" : "gold"}>{candidatePriorityLabels[value as CandidatePriority]}</Tag> },
            { title: "数据来源", dataIndex: "dataConfidence", render: (value) => <DataConfidenceTag value={value} /> },
            {
              title: "状态",
              dataIndex: "candidateStatusView",
              render: (value) => <Tag color={candidateStatusColors[value as CandidateStatusView]}>{candidateStatusLabels[value as CandidateStatusView]}</Tag>
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getCandidateNextStep(record);

                return <Tag color={candidateNextStepColors[nextStep]}>{candidateNextStepLabels[nextStep]}</Tag>;
              }
            },
            { title: "处理动作", render: (_, record) => getCandidateActionText(record) },
            { title: "URL", dataIndex: "url", render: (value) => <span className="mono">{value}</span> },
            {
              title: "可执行入口",
              render: (_, record) => renderCandidateEntry(record)
            },
            {
              title: "维护",
              render: (_, record) => renderCandidateMaintenance(record)
            }
          ]}
        />
      </Card>
    </>
  );
}
