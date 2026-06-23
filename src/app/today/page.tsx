"use client";

import { Alert, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { useMemo, useState, type Key } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import type { ArticleDraft, ChannelKey, ContentTask, ProductKey, PublishRecord, TaskStatus } from "@/lib/types";

type TodayNextStep =
  | "generate_draft"
  | "fix_generation"
  | "fix_qa"
  | "preview_copy"
  | "confirm_published"
  | "fill_url"
  | "record_metrics"
  | "retrospect";

const todayNextStepLabels: Record<TodayNextStep, string> = {
  generate_draft: "待批量生成",
  fix_generation: "排查生成",
  fix_qa: "处理质检",
  preview_copy: "预览复制",
  confirm_published: "确认已发布",
  fill_url: "回填 URL",
  record_metrics: "数据回传",
  retrospect: "可复盘"
};

const todayNextStepColors: Record<TodayNextStep, string> = {
  generate_draft: "blue",
  fix_generation: "red",
  fix_qa: "red",
  preview_copy: "purple",
  confirm_published: "gold",
  fill_url: "orange",
  record_metrics: "cyan",
  retrospect: "green"
};

function canBatchGenerate(task: ContentTask, publishRecord?: PublishRecord) {
  return !publishRecord && ["confirmed", "generated", "qa_failed", "pending_review"].includes(task.status);
}

function getTodayNextStep(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord): TodayNextStep {
  if (publishRecord?.channelMetrics) {
    return "retrospect";
  }

  if (publishRecord?.publishStatus === "url_filled" || publishRecord?.publishedUrl) {
    return "record_metrics";
  }

  if (publishRecord?.publishStatus === "published") {
    return "fill_url";
  }

  if (publishRecord?.publishStatus === "queued") {
    return "confirm_published";
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

  return draft.status === "final" ? "confirm_published" : "preview_copy";
}

function getTodayActionText(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord) {
  const nextStep = getTodayNextStep(task, draft, publishRecord);

  if (nextStep === "generate_draft") {
    return "勾选任务后统一批量生成正文，不在单行里单篇生成。";
  }

  if (nextStep === "fix_generation") {
    return "生成配置或上次生成结果异常，勾选后重新批量生成，必要时先看 AI 配置。";
  }

  if (nextStep === "fix_qa") {
    return "进入草稿预览页处理阻断项，二次质检通过后才能复制发布。";
  }

  if (nextStep === "preview_copy") {
    return "进入草稿预览，人工修改并通过 AI 二次质检后复制全文发布。";
  }

  if (nextStep === "confirm_published") {
    return "外部渠道已经人工发布后，在这里确认已发布，系统会提醒继续回填 URL。";
  }

  if (nextStep === "fill_url") {
    return "正式链接还没回填，先补 URL，后续数据回传才能准确匹配。";
  }

  if (nextStep === "record_metrics") {
    return "发布和 URL 已闭环，去数据回传页导入渠道指标。";
  }

  return "发布、URL 和渠道数据都已闭环，可以进入周度复盘。";
}

export default function TodayPage() {
  const {
    state: { tasks, drafts, publishRecords },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Key[]>([]);
  const [markingPublishedTaskId, setMarkingPublishedTaskId] = useState<string>();
  const [fillingUrlTaskId, setFillingUrlTaskId] = useState<string>();
  const [urlTask, setUrlTask] = useState<ContentTask>();
  const [publishedUrl, setPublishedUrl] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [productFilter, setProductFilter] = useState<ProductKey[]>([]);
  const activeTasks = tasks.filter((task) => task.status !== "planned");
  const draftByTaskId = useMemo(() => new Map(drafts.map((draft) => [draft.taskId, draft])), [drafts]);
  const publishRecordByTaskId = useMemo(
    () =>
      new Map(
        publishRecords
          .map((record) => {
            const draft = drafts.find((item) => item.id === record.draftId);

            return draft ? ([draft.taskId, record] as const) : undefined;
          })
          .filter((item): item is readonly [string, PublishRecord] => Boolean(item))
      ),
    [drafts, publishRecords]
  );
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length);
  const filteredTodayTasks = activeTasks.filter((task) => {
    const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
    const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
    const productMatched = !productFilter.length || productFilter.includes(task.product);

    return statusMatched && channelMatched && productMatched;
  });
  const selectedGeneratableIds = selectedTaskIds
    .map(String)
    .filter((taskId) => {
      const task = activeTasks.find((item) => item.id === taskId);
      return Boolean(task && canBatchGenerate(task, publishRecordByTaskId.get(task.id)));
    });
  const pendingGenerateCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "generate_draft").length;
  const draftReadyCount = filteredTodayTasks.filter((task) => {
    const step = getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));
    return step === "preview_copy" || step === "confirm_published";
  }).length;
  const pendingUrlCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "fill_url").length;
  const pendingMetricsCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "record_metrics").length;

  function clearFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
  }

  async function handleBatchGenerate() {
    if (!selectedGeneratableIds.length) {
      messageApi.warning("请先勾选已确认且尚未发布的任务。");
      return;
    }

    setBatchGenerating(true);

    try {
      const result = await callJsonApi("/api/content-tasks/batch-generate", {
        method: "POST",
        body: JSON.stringify({ taskIds: selectedGeneratableIds })
      });
      await refresh();
      setSelectedTaskIds([]);
      messageApi.success(formatApiMessage(result, "批量生成完成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "批量生成失败");
    } finally {
      setBatchGenerating(false);
    }
  }

  async function handleMarkPublished(task: ContentTask) {
    setMarkingPublishedTaskId(task.id);

    try {
      const result = await callJsonApi(`/api/content-tasks/${task.id}/published`, { method: "PATCH" });
      await refresh();
      setUrlTask(task);
      setPublishedUrl("");
      messageApi.success(formatApiMessage(result, "已确认发布"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认发布失败");
    } finally {
      setMarkingPublishedTaskId(undefined);
    }
  }

  async function handleFillUrl() {
    if (!urlTask) {
      return;
    }

    setFillingUrlTaskId(urlTask.id);

    try {
      const result = await callJsonApi(`/api/content-tasks/${urlTask.id}/url`, {
        method: "PATCH",
        body: JSON.stringify({ publishedUrl })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "URL 已回填"));
      setUrlTask(undefined);
      setPublishedUrl("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "URL 回填失败");
    } finally {
      setFillingUrlTaskId(undefined);
    }
  }

  function renderTodayEntry(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);
    const publishRecord = publishRecordByTaskId.get(task.id);
    const nextStep = getTodayNextStep(task, draft, publishRecord);

    if (nextStep === "generate_draft" || nextStep === "fix_generation") {
      return (
        <Button size="small" onClick={() => setSelectedTaskIds([task.id])} disabled={!canBatchGenerate(task, publishRecord)}>
          勾选生成
        </Button>
      );
    }

    if (nextStep === "fix_qa" || nextStep === "preview_copy") {
      return (
        <Link href={`/drafts/${task.id}`}>
          <Button size="small" type="primary">
            草稿预览
          </Button>
        </Link>
      );
    }

    if (nextStep === "confirm_published") {
      return (
        <Space wrap>
          {draft ? (
            <Link href={`/drafts/${task.id}`}>
              <Button size="small">预览</Button>
            </Link>
          ) : null}
          <Popconfirm
            title="确认已在外部渠道发布？"
            description="确认后会进入 URL 回填，数据回传仍在数据回传页完成。"
            okText="确认已发布"
            cancelText="取消"
            okButtonProps={{ "data-testid": `today-confirm-published-confirm-${task.id}` }}
            onConfirm={() => handleMarkPublished(task)}
          >
            <Button size="small" type="primary" loading={markingPublishedTaskId === task.id} data-testid={`today-confirm-published-${task.id}`}>
              确认已发布
            </Button>
          </Popconfirm>
        </Space>
      );
    }

    if (nextStep === "fill_url") {
      return (
        <Button
          size="small"
          type="primary"
          data-testid={`today-fill-url-${task.id}`}
          onClick={() => {
            setUrlTask(task);
            setPublishedUrl(publishRecord?.publishedUrl || "");
          }}
        >
          回填 URL
        </Button>
      );
    }

    if (nextStep === "record_metrics") {
      return (
        <Link href="/publish">
          <Button size="small" type="primary">
            去数据回传
          </Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small">去复盘</Button>
      </Link>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="今日发布"
        subtitle="从已确认周计划中选择任务，批量生成正文；人工发布后在这里确认发布并回填 URL。"
        actions={
          <Popconfirm title="批量生成选中正文？" description="只处理已勾选的已确认任务，不会自动发布到外部平台。" okText="生成" cancelText="取消" onConfirm={handleBatchGenerate}>
            <Button type="primary" loading={batchGenerating} disabled={!selectedGeneratableIds.length}>
              批量生成正文
            </Button>
          </Popconfirm>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="今日任务池" value={filteredTodayTasks.length} suffix="条" />
        <MetricCard title="待生成" value={pendingGenerateCount} suffix="条" />
        <MetricCard title="待复制/发布" value={draftReadyCount} suffix="条" />
        <MetricCard title="待回填 URL" value={pendingUrlCount} suffix="条" />
        <MetricCard title="待数据回传" value={pendingMetricsCount} suffix="条" />
      </div>
      <Card>
        <Alert
          showIcon
          type={pendingUrlCount ? "warning" : pendingGenerateCount ? "info" : "success"}
          message={`已选 ${selectedGeneratableIds.length} 条可生成任务；待生成 ${pendingGenerateCount} 条，待回填 URL ${pendingUrlCount} 条。`}
          description="今日发布页是执行入口：选择任务、批量生成、进入草稿预览复制、确认已发布、回填 URL。渠道阅读点赞等指标统一到数据回传页处理。"
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
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按渠道筛选"
            value={channelFilter}
            onChange={(value) => setChannelFilter(value)}
            options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 200 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按产品筛选"
            value={productFilter}
            onChange={(value) => setProductFilter(value)}
            options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredTodayTasks}
          rowSelection={{
            selectedRowKeys: selectedTaskIds,
            onChange: setSelectedTaskIds,
            getCheckboxProps: (record) => ({
              disabled: !canBatchGenerate(record, publishRecordByTaskId.get(record.id))
            })
          }}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有任务" : "今日发布还没有任务"}
                description={hasActiveFilter ? "清空筛选或调整条件后再查看。" : "先在周计划页确认计划项，再回到这里批量生成正文。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/weekly-plan">
                      <Button type="primary">去周计划</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "日期", dataIndex: "publishDate", width: 110 },
            { title: "标题", dataIndex: "title" },
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as ChannelKey], width: 120 },
            { title: "产品", dataIndex: "product", render: (value) => productLabels[value as ProductKey], width: 140 },
            { title: "类型", dataIndex: "contentType", render: (value) => contentTypeLabels[value as keyof typeof contentTypeLabels], width: 110 },
            { title: "主蒸馏词", dataIndex: "primaryDistilledTerm", render: (value) => value || <span className="muted">待补</span> },
            {
              title: "草稿/质检",
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);

                if (!draft) {
                  return <Tag>未生成</Tag>;
                }

                return (
                  <Space wrap>
                    <Tag color={draft.qaResult.passed ? "green" : "red"}>{draft.qaResult.passed ? "质检通过" : "质检阻断"}</Tag>
                    <Tag>{`v${draft.version}`}</Tag>
                    {draft.qaResult.warnings.length ? <Tag color="gold">{`${draft.qaResult.warnings.length} 个提醒`}</Tag> : null}
                  </Space>
                );
              }
            },
            {
              title: "URL 状态",
              render: (_, record) => {
                const publishRecord = publishRecordByTaskId.get(record.id);

                if (!publishRecord) {
                  return <span className="muted">未确认发布</span>;
                }

                if (publishRecord.publishedUrl) {
                  return <Tag color="green">已回填</Tag>;
                }

                return <Tag color={publishRecord.publishStatus === "published" ? "orange" : "gold"}>{publishRecord.publishStatus === "published" ? "待回填" : "待确认发布"}</Tag>;
              }
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getTodayNextStep(record, draftByTaskId.get(record.id), publishRecordByTaskId.get(record.id));

                return <Tag color={todayNextStepColors[nextStep]}>{todayNextStepLabels[nextStep]}</Tag>;
              }
            },
            { title: "处理动作", render: (_, record) => getTodayActionText(record, draftByTaskId.get(record.id), publishRecordByTaskId.get(record.id)) },
            { title: "可执行入口", render: (_, record) => renderTodayEntry(record), width: 180 }
          ]}
        />
      </Card>
      <Modal
        title="回填正式发布 URL"
        open={Boolean(urlTask)}
        onOk={handleFillUrl}
        confirmLoading={Boolean(urlTask && fillingUrlTaskId === urlTask.id)}
        okButtonProps={{ disabled: !publishedUrl.trim(), "data-testid": "today-url-save-button" }}
        onCancel={() => {
          setUrlTask(undefined);
          setPublishedUrl("");
        }}
      >
        <Alert showIcon type="info" message="确认发布后必须回填 URL，后续渠道数据才能准确匹配到这篇文章。" style={{ marginBottom: 12 }} />
        <Input placeholder="https://..." value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} data-testid="today-url-input" />
      </Modal>
    </>
  );
}
