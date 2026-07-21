"use client";

import { Alert, Button, Card, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { ArticleDraft, ChannelKey, ContentTask, ProductKey, PublishRecord, TaskStatus } from "@/lib/types";
import { useState } from "react";

type TodayNextStep = "confirm_task" | "generate_draft" | "fix_generation" | "fix_qa" | "review_draft" | "publish" | "fill_url" | "record_metrics" | "fix_publish" | "retrospect";

const draftStatusLabels = {
  draft: "草稿",
  final: "终稿",
  discarded: "已废弃"
} as const;

const draftStatusColors = {
  draft: "gold",
  final: "green",
  discarded: "default"
} as const;

const generationStatusLabels = {
  success: "生成成功",
  pending_config: "待配置",
  failed: "生成失败"
} as const;

const generationStatusColors = {
  success: "green",
  pending_config: "gold",
  failed: "red"
} as const;

const todayNextStepLabels: Record<TodayNextStep, string> = {
  confirm_task: "回月度计划确认",
  generate_draft: "生成稿件",
  fix_generation: "排查生成",
  fix_qa: "处理质检",
  review_draft: "终稿确认",
  publish: "人工发布",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  fix_publish: "排查发布",
  retrospect: "可复盘"
};

const todayNextStepColors: Record<TodayNextStep, string> = {
  confirm_task: "gold",
  generate_draft: "blue",
  fix_generation: "red",
  fix_qa: "red",
  review_draft: "purple",
  publish: "gold",
  fill_url: "blue",
  record_metrics: "purple",
  fix_publish: "red",
  retrospect: "green"
};

function getTodayNextStep(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord): TodayNextStep {
  if (publishRecord?.publishStatus === "failed") {
    return "fix_publish";
  }

  if (publishRecord?.publishStatus === "queued") {
    return "publish";
  }

  if (publishRecord?.publishStatus === "published" && !publishRecord.publishedUrl) {
    return "fill_url";
  }

  if (publishRecord && !publishRecord.channelMetrics) {
    return "record_metrics";
  }

  if (publishRecord?.channelMetrics) {
    return "retrospect";
  }

  if (task.status === "planned") {
    return "confirm_task";
  }

  if (!draft) {
    return "generate_draft";
  }

  if (draft.generationSource?.status === "pending_config" || draft.generationSource?.status === "failed") {
    return "fix_generation";
  }

  if (!draft.qaResult.passed) {
    return "fix_qa";
  }

  return "review_draft";
}

function getTodayActionText(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord) {
  const nextStep = getTodayNextStep(task, draft, publishRecord);

  if (nextStep === "confirm_task") {
    return "任务还停在计划状态，先回月度计划确认后再进入今日生成。";
  }

  if (nextStep === "generate_draft") {
    return "当前还没有稿件，先生成初稿，再检查质检结果。";
  }

  if (nextStep === "fix_generation") {
    return draft?.generationSource?.status === "pending_config"
      ? "生成能力待配置，先检查 AI 配置；也可继续使用本地规则生成。"
      : "上次生成失败，建议重新生成并查看错误提示。";
  }

  if (nextStep === "fix_qa") {
    return "质检存在阻断项，进入终稿页处理后再确认入发布队列。";
  }

  if (nextStep === "review_draft") {
    return "稿件已具备确认条件，进入终稿页复核并加入发布队列。";
  }

  if (nextStep === "publish") {
    return "终稿已进入发布队列，下一步人工发布并标记状态。";
  }

  if (nextStep === "fill_url") {
    return "内容已发布但缺少链接，先回填 URL，后续才能复盘。";
  }

  if (nextStep === "record_metrics") {
    return "发布链路已完成，补齐渠道指标用于月度复盘。";
  }

  if (nextStep === "fix_publish") {
    return "发布记录失败，先到发布队列排查失败原因。";
  }

  return "发布和指标已闭环，可进入月度复盘。";
}

export default function TodayPage() {
  const {
    state: { tasks, monthlyPlan, drafts, publishRecords },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [generatingTaskId, setGeneratingTaskId] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [productFilter, setProductFilter] = useState<ProductKey[]>([]);
  const todayTasks = tasks.filter((task) => task.publishDate === monthlyPlan.monthStart || task.status !== "planned").slice(0, 20);
  const draftByTaskId = new Map(drafts.map((draft) => [draft.taskId, draft]));
  const publishRecordByTaskId = new Map(
    publishRecords
      .map((record) => {
        const draft = drafts.find((item) => item.id === record.draftId);

        return draft ? ([draft.taskId, record] as const) : undefined;
      })
      .filter((item): item is readonly [string, PublishRecord] => Boolean(item))
  );
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length);
  const filteredTodayTasks = todayTasks.filter((task) => {
    const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
    const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
    const productMatched = !productFilter.length || productFilter.includes(task.product);

    return statusMatched && channelMatched && productMatched;
  });
  const visibleDraftCount = filteredTodayTasks.filter((task) => draftByTaskId.has(task.id)).length;
  const visiblePassedCount = filteredTodayTasks.filter((task) => draftByTaskId.get(task.id)?.qaResult.passed).length;
  const visibleBlockedCount = filteredTodayTasks.filter((task) => {
    const draft = draftByTaskId.get(task.id);
    return Boolean(draft && !draft.qaResult.passed);
  }).length;
  const visiblePendingDraftCount = filteredTodayTasks.length - visibleDraftCount;
  const visibleGenerateActionCount = filteredTodayTasks.filter((task) => {
    const nextStep = getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "confirm_task" || nextStep === "generate_draft" || nextStep === "fix_generation";
  }).length;
  const visibleReviewActionCount = filteredTodayTasks.filter((task) => {
    const nextStep = getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "fix_qa" || nextStep === "review_draft";
  }).length;
  const visiblePublishActionCount = filteredTodayTasks.filter((task) => {
    const nextStep = getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "publish" || nextStep === "fill_url" || nextStep === "record_metrics" || nextStep === "fix_publish";
  }).length;
  const visibleRetrospectCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "retrospect").length;
  const highestPriorityTodayTask =
    filteredTodayTasks.find((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) !== "retrospect") ||
    filteredTodayTasks[0];
  const highestPriorityTodayStep = highestPriorityTodayTask
    ? getTodayNextStep(highestPriorityTodayTask, draftByTaskId.get(highestPriorityTodayTask.id), publishRecordByTaskId.get(highestPriorityTodayTask.id))
    : undefined;

  function clearFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
  }

  async function handleBatchGenerate() {
    setBatchGenerating(true);

    try {
      const result = await callJsonApi("/api/content-tasks/batch-generate", { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "批量生成完成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "批量生成失败");
    } finally {
      setBatchGenerating(false);
    }
  }

  async function handleGenerateTask(taskId: string) {
    setGeneratingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}/generate`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "单篇生成完成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "单篇生成失败");
    } finally {
      setGeneratingTaskId(undefined);
    }
  }

  function renderTodayEntry(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);
    const publishRecord = publishRecordByTaskId.get(task.id);
    const nextStep = getTodayNextStep(task, draft, publishRecord);

    if (nextStep === "confirm_task") {
      return (
        <Link href="/monthly-plan">
          <Button size="small">去确认</Button>
        </Link>
      );
    }

    if (nextStep === "generate_draft" || (nextStep === "fix_generation" && draft?.generationSource?.status !== "pending_config")) {
      return (
        <Popconfirm
          title="确认生成这篇稿件？"
          description="如果已有草稿，会更新为新的生成结果。"
          okText="生成"
          cancelText="取消"
          onConfirm={() => handleGenerateTask(task.id)}
        >
          <Button size="small" loading={generatingTaskId === task.id}>
            {draft ? "重新生成" : "生成稿件"}
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "fix_generation") {
      return (
        <Link href="/ai-config">
          <Button size="small">看配置</Button>
        </Link>
      );
    }

    if (nextStep === "fix_qa" || nextStep === "review_draft") {
      return (
        <Link href={`/drafts/${task.id}`}>
          <Button size="small" type="primary">
            {nextStep === "fix_qa" ? "处理阻断" : "终稿确认"}
          </Button>
        </Link>
      );
    }

    if (nextStep === "publish" || nextStep === "fill_url" || nextStep === "record_metrics" || nextStep === "fix_publish") {
      return (
        <Link href="/publish">
          <Button size="small">{todayNextStepLabels[nextStep]}</Button>
        </Link>
      );
    }

    return (
      <Link href="/monthly-review">
        <Button size="small">去复盘</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="今日任务"
        subtitle="执行当天已经确认的渠道文章任务，支持批量生成、查看质检和进入终稿确认。"
        actions={
          <Popconfirm
            title="确认批量生成今日文章？"
            description="已有草稿可能会被重新生成结果覆盖。"
            okText="生成"
            cancelText="取消"
            onConfirm={handleBatchGenerate}
          >
            <Button type="primary" loading={batchGenerating}>
              批量生成
            </Button>
          </Popconfirm>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Card>
        <Alert
          showIcon
          type={visibleBlockedCount ? "warning" : visiblePendingDraftCount ? "info" : "success"}
          message={`今日任务共 ${filteredTodayTasks.length} 条，已生成 ${visibleDraftCount} 条，质检通过 ${visiblePassedCount} 条${highestPriorityTodayStep ? `，当前优先：${todayNextStepLabels[highestPriorityTodayStep]}` : ""}`}
          description={
            filteredTodayTasks.length
              ? `生成/排查 ${visibleGenerateActionCount} 条，终稿处理 ${visibleReviewActionCount} 条，发布承接 ${visiblePublishActionCount} 条，可复盘 ${visibleRetrospectCount} 条。${highestPriorityTodayTask ? getTodayActionText(highestPriorityTodayTask, draftByTaskId.get(highestPriorityTodayTask.id), publishRecordByTaskId.get(highestPriorityTodayTask.id)) : ""}`
              : "当前筛选没有任务，清空筛选或回月度计划确认今天要执行的任务。"
          }
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按渠道筛选"
            value={channelFilter}
            onChange={(value) => setChannelFilter(value)}
            options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按产品筛选"
            value={productFilter}
            onChange={(value) => setProductFilter(value)}
            options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 240 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredTodayTasks}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有任务" : "今天还没有可处理任务"}
                description={hasActiveFilter ? "清空筛选或调整状态、渠道、产品条件后再查看。" : "先去月度计划生成或确认任务，再回到这里批量生成文章。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/monthly-plan">
                      <Button type="primary">去月度计划</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "状态", dataIndex: "status", render: (value) => <Tag>{statusLabels[value as keyof typeof statusLabels]}</Tag> },
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as keyof typeof channelLabels] },
            { title: "产品", dataIndex: "product", render: (value) => productLabels[value as keyof typeof productLabels] },
            { title: "标题", dataIndex: "title" },
            { title: "类型", dataIndex: "contentType", render: (value) => contentTypeLabels[value as keyof typeof contentTypeLabels] },
            {
              title: "稿件状态",
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);

                if (!draft) {
                  return <Tag>未生成</Tag>;
                }

                return (
                  <Space wrap>
                    <Tag color={draftStatusColors[draft.status]}>{draftStatusLabels[draft.status]}</Tag>
                    <Tag>{`v${draft.version}`}</Tag>
                    <Tag color={generationStatusColors[draft.generationSource?.status || "success"]}>
                      {generationStatusLabels[draft.generationSource?.status || "success"]}
                    </Tag>
                  </Space>
                );
              }
            },
            {
              title: "质检",
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);

                if (!draft) {
                  return <span className="muted">待生成</span>;
                }

                if (draft.qaResult.passed) {
                  return (
                    <Space wrap>
                      <Tag color="green">已通过</Tag>
                      {draft.qaResult.warnings.length ? <Tag color="gold">{`${draft.qaResult.warnings.length} 个警告`}</Tag> : null}
                    </Space>
                  );
                }

                return (
                  <Space wrap>
                    <Tag color="red">{`${draft.qaResult.blockers.length} 个阻断项`}</Tag>
                    {draft.qaResult.warnings.length ? <Tag color="gold">{`${draft.qaResult.warnings.length} 个警告`}</Tag> : null}
                  </Space>
                );
              }
            },
            {
              title: "下一步",
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);
                const publishRecord = publishRecordByTaskId.get(record.id);
                const nextStep = getTodayNextStep(record, draft, publishRecord);

                return <Tag color={todayNextStepColors[nextStep]}>{todayNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getTodayActionText(record, draftByTaskId.get(record.id), publishRecordByTaskId.get(record.id))
            },
            {
              title: "可执行入口",
              render: (_, record) => renderTodayEntry(record)
            }
          ]}
        />
      </Card>
    </>
  );
}
