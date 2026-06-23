"use client";

import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import type { ArticleDraft, ChannelKey, ContentTask, ProductKey, PublishRecord, TaskStatus } from "@/lib/types";
import { useEffect, useMemo, useState, type Key } from "react";

type PlanNextStep = "confirm" | "generate" | "fix_generation" | "fix_qa" | "review_draft" | "publish" | "fill_url" | "record_metrics" | "retrospect" | "failed";

const draftHandoffLabels = {
  none: "未生成",
  pending_config: "待配置",
  failed: "生成失败",
  blocked: "质检阻断",
  draft: "待终稿确认",
  final: "终稿"
} as const;

const draftHandoffColors = {
  none: "default",
  pending_config: "gold",
  failed: "red",
  blocked: "red",
  draft: "blue",
  final: "green"
} as const;

const publishHandoffLabels = {
  none: "未入队",
  queued: "待发布",
  published: "待回填 URL",
  url_filled: "待录指标",
  measured: "可复盘",
  failed: "失败"
} as const;

const publishHandoffColors = {
  none: "default",
  queued: "gold",
  published: "blue",
  url_filled: "purple",
  measured: "green",
  failed: "red"
} as const;

const planNextStepLabels: Record<PlanNextStep, string> = {
  confirm: "待确认",
  generate: "待生成",
  fix_generation: "排查生成",
  fix_qa: "处理质检",
  review_draft: "终稿确认",
  publish: "人工发布",
  fill_url: "回填 URL",
  record_metrics: "录入指标",
  retrospect: "可复盘",
  failed: "排查失败"
};

const planNextStepColors: Record<PlanNextStep, string> = {
  confirm: "gold",
  generate: "blue",
  fix_generation: "red",
  fix_qa: "red",
  review_draft: "purple",
  publish: "gold",
  fill_url: "blue",
  record_metrics: "purple",
  retrospect: "green",
  failed: "red"
};

function getDraftHandoffStatus(draft?: ArticleDraft): keyof typeof draftHandoffLabels {
  if (!draft) {
    return "none";
  }

  const generationStatus = draft.generationSource?.status;

  if (generationStatus === "pending_config") {
    return "pending_config";
  }

  if (generationStatus === "failed") {
    return "failed";
  }

  if (!draft.qaResult.passed) {
    return "blocked";
  }

  if (draft.status === "final") {
    return "final";
  }

  return "draft";
}

function getPublishHandoffStatus(record?: PublishRecord): keyof typeof publishHandoffLabels {
  if (!record) {
    return "none";
  }

  if (record.publishStatus === "failed") {
    return "failed";
  }

  if (record.channelMetrics) {
    return "measured";
  }

  if (record.publishStatus === "url_filled") {
    return "url_filled";
  }

  if (record.publishStatus === "published") {
    return "published";
  }

  return "queued";
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

function getPlanActionText(task: ContentTask, draft?: ArticleDraft, record?: PublishRecord) {
  const nextStep = getPlanNextStep(task, draft, record);

  if (nextStep === "confirm") {
    return "任务还停留在计划状态，先确认进入今日任务队列，再安排稿件生成。";
  }

  if (nextStep === "generate") {
    return "当前还没有稿件承接，先去今日任务生成稿件，再回到这里跟进终稿与发布。";
  }

  if (nextStep === "fix_generation") {
    return draft?.generationSource?.status === "pending_config"
      ? "生成能力待配置，先检查 AI 配置；如保留本地兜底，也要确认生成链路是否可用。"
      : "上次生成失败，先回到今日任务重试生成，并检查失败提示。";
  }

  if (nextStep === "fix_qa") {
    return "稿件质检存在阻塞项，先进入终稿页处理问题，再推进发布承接。";
  }

  if (nextStep === "review_draft") {
    return draft?.status === "final"
      ? "终稿已经确认，可以继续检查发布承接是否已建立。"
      : "稿件已生成，先完成终稿确认并加入发布队列。";
  }

  if (nextStep === "publish") {
    return "发布队列已建立，下一步按渠道完成人工发布并标记状态。";
  }

  if (nextStep === "fill_url") {
    return "内容已发布但缺少正式 URL，先回填链接，后续才能录入指标。";
  }

  if (nextStep === "record_metrics") {
    return "发布链接已闭环，继续录入渠道指标，为周报复盘准备真实反馈。";
  }

  if (nextStep === "failed") {
    return "发布承接出现失败记录，先去发布队列排查，再回到周计划继续闭环。";
  }

  return "发布与指标都已完成，可以进入周报复盘判断是否反哺下周计划。";
}

export default function WeeklyPlanPage() {
  const {
    state: { tasks, weeklyPlan, workspaceSetting, drafts, publishRecords },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [generating, setGenerating] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [regeneratingTaskId, setRegeneratingTaskId] = useState<string>();
  const [confirmingTaskId, setConfirmingTaskId] = useState<string>();
  const [deletingTaskId, setDeletingTaskId] = useState<string>();
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Key[]>([]);
  const [editingTask, setEditingTask] = useState<ContentTask>();
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [productFilter, setProductFilter] = useState<ProductKey[]>([]);
  const draftByTaskId = new Map(drafts.map((draft) => [draft.taskId, draft]));
  const publishRecordByTaskId = new Map(
    publishRecords
      .map((record) => {
        const draft = drafts.find((item) => item.id === record.draftId);

        return draft ? ([draft.taskId, record] as const) : undefined;
      })
      .filter((item): item is readonly [string, PublishRecord] => Boolean(item))
  );
  const selectedPlannedTaskIds = selectedTaskIds
    .map(String)
    .filter((taskId) => tasks.some((task) => task.id === taskId && task.status === "planned"));
  const plannedTaskCount = tasks.filter((task) => task.status === "planned").length;
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length);
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
      const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
      const productMatched = !productFilter.length || productFilter.includes(task.product);

      return statusMatched && channelMatched && productMatched;
    });
  }, [channelFilter, productFilter, statusFilter, tasks]);
  const visibleConfirmCount = filteredTasks.filter((task) => getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "confirm").length;
  const visibleGenerateCount = filteredTasks.filter((task) => {
    const nextStep = getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "generate" || nextStep === "fix_generation";
  }).length;
  const visibleReviewCount = filteredTasks.filter((task) => {
    const nextStep = getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "review_draft" || nextStep === "fix_qa";
  }).length;
  const visiblePublishCount = filteredTasks.filter((task) => {
    const nextStep = getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id));

    return nextStep === "publish" || nextStep === "fill_url" || nextStep === "record_metrics";
  }).length;
  const visibleRetrospectCount = filteredTasks.filter((task) => getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "retrospect").length;
  const highestPriorityPlanTask =
    filteredTasks.find((task) => getPlanNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) !== "retrospect") || filteredTasks[0];

  useEffect(() => {
    form.setFieldsValue({
      days: workspaceSetting.defaultWeeklyDays,
      dailyCount: workspaceSetting.defaultDailyCount,
      channels: workspaceSetting.enabledChannels,
      products: workspaceSetting.enabledProducts
    });
  }, [form, workspaceSetting]);

  async function handleGeneratePlan() {
    const values = form.getFieldsValue() as { days?: number; dailyCount?: number; channels?: ChannelKey[] };
    setGenerating(true);

    try {
      const result = await callJsonApi("/api/weekly-plans/generate", {
        method: "POST",
        body: JSON.stringify(values)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "周计划已生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成周计划失败");
    } finally {
      setGenerating(false);
    }
  }

  function openTaskEditor(task: ContentTask) {
    setEditingTask(task);
    taskForm.setFieldsValue({
      ...task,
      targetKeywords: task.targetKeywords.join("，")
    });
  }

  async function handleSaveTask() {
    if (!editingTask) {
      return;
    }

    const values = taskForm.getFieldsValue();
    setSavingTask(true);

    try {
      const result = await callJsonApi(`/api/content-tasks/${editingTask.id}`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "任务已保存"));
      setEditingTask(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存任务失败");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleRegenerateTitle(taskId: string) {
    setRegeneratingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}/regenerate-title`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "标题已重生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重生成失败");
    } finally {
      setRegeneratingTaskId(undefined);
    }
  }

  async function handleConfirmTasks(taskIds?: string[]) {
    const ids = taskIds?.length ? taskIds : selectedPlannedTaskIds;
    const isSingle = ids.length === 1;

    if (!ids.length) {
      messageApi.warning("请先选择计划中任务。");
      return;
    }

    if (isSingle) {
      setConfirmingTaskId(ids[0]);
    } else {
      setBatchConfirming(true);
    }

    try {
      const result = await callJsonApi<{ message?: string; data?: { confirmed?: number } }>("/api/content-tasks/confirm", {
        method: "POST",
        body: JSON.stringify({ taskIds: ids })
      });
      await refresh();
      setSelectedTaskIds((current) => current.filter((taskId) => !ids.includes(String(taskId))));
      messageApi.success(formatApiMessage(result, `已确认 ${result.data?.confirmed || ids.length} 个任务`));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认任务失败");
    } finally {
      if (isSingle) {
        setConfirmingTaskId(undefined);
      } else {
        setBatchConfirming(false);
      }
    }
  }

  async function handleDeleteTask(taskId: string) {
    setDeletingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}`, { method: "DELETE" });
      await refresh();
      setSelectedTaskIds((current) => current.filter((id) => String(id) !== taskId));
      messageApi.success(formatApiMessage(result, "任务已删除"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除任务失败");
    } finally {
      setDeletingTaskId(undefined);
    }
  }

  function clearTaskFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
  }

  function renderPlanEntry(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);
    const publishRecord = publishRecordByTaskId.get(task.id);
    const nextStep = getPlanNextStep(task, draft, publishRecord);

    if (nextStep === "confirm") {
      return (
        <Popconfirm
          title="确认这个任务？"
          description="任务会进入今日任务生成队列。"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleConfirmTasks([task.id])}
        >
          <Button size="small" type="primary" loading={confirmingTaskId === task.id}>
            确认任务
          </Button>
        </Popconfirm>
      );
    }

    if (nextStep === "generate" || (nextStep === "fix_generation" && draft?.generationSource?.status !== "pending_config")) {
      return (
        <Link href="/today">
          <Button size="small" type="primary">
            去生成
          </Button>
        </Link>
      );
    }

    if (nextStep === "fix_generation") {
      return (
        <Link href="/ai-config">
          <Button size="small" type="primary">
            看 AI 配置
          </Button>
        </Link>
      );
    }

    if (nextStep === "fix_qa" || nextStep === "review_draft") {
      return (
        <Link href={`/drafts/${task.id}`}>
          <Button size="small" type="primary">
            {nextStep === "fix_qa" ? "处理阻塞" : "终稿确认"}
          </Button>
        </Link>
      );
    }

    if (nextStep === "publish" || nextStep === "fill_url" || nextStep === "record_metrics" || nextStep === "failed") {
      const label =
        nextStep === "fill_url" ? "回填 URL" : nextStep === "record_metrics" ? "录入指标" : nextStep === "failed" ? "排查发布" : "去发布";

      return (
        <Link href="/publish">
          <Button size="small" type="primary">
            {label}
          </Button>
        </Link>
      );
    }

    return (
      <Link href="/weekly-report">
        <Button size="small" type="primary">
          去复盘
        </Button>
      </Link>
    );
  }

  function renderPlanMaintenance(record: ContentTask) {
    return (
      <Space wrap>
        <Button size="small" onClick={() => openTaskEditor(record)}>
          编辑
        </Button>
        <Popconfirm
          title="确认这个任务？"
          description="任务会进入今日任务生成队列。"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleConfirmTasks([record.id])}
        >
          <Button size="small" loading={confirmingTaskId === record.id} disabled={record.status !== "planned"}>
            确认
          </Button>
        </Popconfirm>
        <Popconfirm
          title="确认重生成标题？"
          description="当前标题会被新的本地规则标题覆盖。"
          okText="重生成"
          cancelText="取消"
          onConfirm={() => handleRegenerateTitle(record.id)}
        >
          <Button size="small" loading={regeneratingTaskId === record.id}>
            重生成
          </Button>
        </Popconfirm>
        <Popconfirm
          title="确认删除这个任务？"
          description="只能删除尚未生成稿件的计划任务；删除后不会进入今日任务。"
          okText="删除"
          cancelText="取消"
          onConfirm={() => handleDeleteTask(record.id)}
        >
          <Button size="small" danger loading={deletingTaskId === record.id} disabled={!["planned", "confirmed"].includes(record.status)}>
            删除
          </Button>
        </Popconfirm>
      </Space>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="周计划"
        subtitle="一次生成一周渠道任务，支持调整每日发布量、渠道和标题。"
        actions={
          <>
            <Popconfirm
              title="确认批量确认任务？"
              description={`会把 ${selectedPlannedTaskIds.length || plannedTaskCount} 个计划中任务标记为已确认，进入今日任务生成。`}
              okText="确认"
              cancelText="取消"
              onConfirm={() => handleConfirmTasks(selectedPlannedTaskIds.length ? selectedPlannedTaskIds : tasks.filter((task) => task.status === "planned").map((task) => task.id))}
            >
              <Button loading={batchConfirming} disabled={!plannedTaskCount}>
                批量确认
              </Button>
            </Popconfirm>
            <Popconfirm
              title="确认生成新的周计划？"
              description="这会覆盖当前周计划任务、草稿和发布队列。"
              okText="生成"
              cancelText="取消"
              okButtonProps={{ "data-testid": "weekly-plan-generate-confirm" }}
              onConfirm={handleGeneratePlan}
            >
              <Button type="primary" loading={generating} data-testid="weekly-plan-generate-button">
                生成周计划
              </Button>
            </Popconfirm>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <Card title={`${weeklyPlan.weekStart} ~ ${weeklyPlan.weekEnd}`} style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="inline"
          initialValues={{
            days: workspaceSetting.defaultWeeklyDays,
            dailyCount: workspaceSetting.defaultDailyCount,
            channels: workspaceSetting.enabledChannels,
            products: workspaceSetting.enabledProducts
          }}
        >
          <Form.Item label="每周发布天数" name="days">
            <InputNumber min={1} max={7} />
          </Form.Item>
          <Form.Item label="默认每日篇数" name="dailyCount">
            <InputNumber min={1} max={10} />
          </Form.Item>
          <Form.Item label="启用渠道" name="channels">
            <Select
              mode="multiple"
              style={{ minWidth: 360 }}
              options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item label="启用产品" name="products">
            <Select
              mode="multiple"
              style={{ minWidth: 260 }}
              options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </Form>
      </Card>
      <Alert
        showIcon
        type={visibleConfirmCount || visibleGenerateCount || visibleReviewCount ? "warning" : visiblePublishCount ? "info" : "success"}
        message={`周计划共 ${filteredTasks.length} 条，待确认 ${visibleConfirmCount} 条，待生成/生成排查 ${visibleGenerateCount} 条，待终稿处理 ${visibleReviewCount} 条`}
        description={
          filteredTasks.length
            ? `发布侧待处理 ${visiblePublishCount} 条，已可进入复盘 ${visibleRetrospectCount} 条。${
                highestPriorityPlanTask
                  ? getPlanActionText(
                      highestPriorityPlanTask,
                      draftByTaskId.get(highestPriorityPlanTask.id),
                      publishRecordByTaskId.get(highestPriorityPlanTask.id)
                    )
                  : ""
              }`
            : "当前筛选没有周计划任务，清空筛选或重新生成本周排期。"
        }
        style={{ marginBottom: 16 }}
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={filteredTasks}
        rowSelection={{
          selectedRowKeys: selectedTaskIds,
          onChange: setSelectedTaskIds,
          getCheckboxProps: (record) => ({
            disabled: record.status !== "planned"
          })
        }}
        title={() => (
          <Space wrap style={{ width: "100%" }}>
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
              style={{ minWidth: 220 }}
            />
            <Button onClick={clearTaskFilters} disabled={!hasActiveFilter}>
              清空筛选
            </Button>
          </Space>
        )}
        locale={{
          emptyText: (
            <ActionEmpty
              title={hasActiveFilter ? "当前筛选没有周计划任务" : "还没有周计划任务"}
              description={hasActiveFilter ? "清空筛选或调整状态、渠道、产品条件后再查看。" : "先确认默认发布天数、渠道和产品，再生成本周任务。"}
              action={
                hasActiveFilter ? (
                  <Button type="primary" onClick={clearTaskFilters}>
                    清空筛选
                  </Button>
                ) : (
                  <Popconfirm
                    title="确认生成新的周计划？"
                    description="这会覆盖当前周计划任务、草稿和发布队列。"
                    okText="生成"
                    cancelText="取消"
                    onConfirm={handleGeneratePlan}
                  >
                    <Button type="primary" loading={generating}>
                      生成周计划
                    </Button>
                  </Popconfirm>
                )
              }
            />
          )
        }}
        columns={[
          { title: "日期", dataIndex: "publishDate" },
          { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as keyof typeof channelLabels] },
          { title: "产品", dataIndex: "product", render: (value) => productLabels[value as keyof typeof productLabels] },
          { title: "标题", dataIndex: "title" },
          { title: "类型", dataIndex: "contentType", render: (value) => contentTypeLabels[value as keyof typeof contentTypeLabels] },
          { title: "状态", dataIndex: "status", render: (value) => <Tag>{statusLabels[value as keyof typeof statusLabels]}</Tag> },
          {
            title: "稿件承接",
            render: (_, record) => {
              const draft = draftByTaskId.get(record.id);
              const draftHandoff = getDraftHandoffStatus(draft);

              return (
                <Space wrap>
                  <Tag color={draftHandoffColors[draftHandoff]}>{draftHandoffLabels[draftHandoff]}</Tag>
                  {draft ? <Tag>{`v${draft.version}`}</Tag> : null}
                  {draft?.qaResult.warnings.length ? <Tag color="gold">{`${draft.qaResult.warnings.length} 个警告`}</Tag> : null}
                </Space>
              );
            }
          },
          {
            title: "发布承接",
            render: (_, record) => {
              const publishHandoff = getPublishHandoffStatus(publishRecordByTaskId.get(record.id));

              return <Tag color={publishHandoffColors[publishHandoff]}>{publishHandoffLabels[publishHandoff]}</Tag>;
            }
          },
          {
            title: "下一步",
            render: (_, record) => {
              const nextStep = getPlanNextStep(record, draftByTaskId.get(record.id), publishRecordByTaskId.get(record.id));

              return <Tag color={planNextStepColors[nextStep]}>{planNextStepLabels[nextStep]}</Tag>;
            }
          },
          {
            title: "处理动作",
            render: (_, record) => getPlanActionText(record, draftByTaskId.get(record.id), publishRecordByTaskId.get(record.id))
          },
          {
            title: "可执行入口",
            render: (_, record) => renderPlanEntry(record)
          },
          {
            title: "维护",
            render: (_, record) => renderPlanMaintenance(record)
          }
        ]}
      />
      <Modal
        title="编辑内容任务"
        open={Boolean(editingTask)}
        confirmLoading={savingTask}
        onOk={handleSaveTask}
        onCancel={() => setEditingTask(undefined)}
      >
        <Form form={taskForm} layout="vertical">
          <Form.Item label="发布日期" name="publishDate">
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="渠道" name="channel">
            <Select options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="产品" name="product">
            <Select options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="内容类型" name="contentType">
            <Select options={Object.entries(contentTypeLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="标题" name="title">
            <Input />
          </Form.Item>
          <Form.Item label="目标关键词" name="targetKeywords">
            <Input placeholder="多个关键词用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
