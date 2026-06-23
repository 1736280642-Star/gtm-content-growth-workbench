"use client";

import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState, type Key } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { channelLabels, contentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import type { ChannelKey, ContentTask, ProductKey, TaskStatus } from "@/lib/types";

export default function WeeklyPlanPage() {
  const {
    state: { tasks, weeklyPlan, workspaceSetting },
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

  useEffect(() => {
    form.setFieldsValue({
      days: workspaceSetting.defaultWeeklyDays,
      dailyCount: workspaceSetting.defaultDailyCount,
      channels: workspaceSetting.enabledChannels,
      products: workspaceSetting.enabledProducts
    });
  }, [form, workspaceSetting]);

  const selectedPlannedTaskIds = selectedTaskIds
    .map(String)
    .filter((taskId) => tasks.some((task) => task.id === taskId && task.status === "planned"));
  const plannedTaskCount = tasks.filter((task) => task.status === "planned").length;
  const confirmedTaskCount = tasks.filter((task) => task.status === "confirmed").length;
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length);
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
      const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
      const productMatched = !productFilter.length || productFilter.includes(task.product);

      return statusMatched && channelMatched && productMatched;
    });
  }, [channelFilter, productFilter, statusFilter, tasks]);
  const hardConstraintReady = filteredTasks.filter((task) => task.title && task.channel && task.product && task.officialLinkTarget).length;
  const semanticConstraintReady = filteredTasks.filter((task) => task.primaryDistilledTerm && task.sourceProblem && task.contentType).length;

  async function handleGeneratePlan() {
    const values = form.getFieldsValue() as { days?: number; dailyCount?: number; channels?: ChannelKey[]; products?: ProductKey[] };
    setGenerating(true);

    try {
      const result = await callJsonApi("/api/weekly-plans/generate", {
        method: "POST",
        body: JSON.stringify(values)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "周计划预览已生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成周计划预览失败");
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
      messageApi.success(formatApiMessage(result, "计划项已保存"));
      setEditingTask(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存计划项失败");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleRegenerateTitle(taskId: string) {
    setRegeneratingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}/regenerate-title`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "渠道标题已重生成"));
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
      messageApi.success(formatApiMessage(result, `已确认 ${result.data?.confirmed || ids.length} 个计划项`));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认计划项失败");
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
      messageApi.success(formatApiMessage(result, "计划项已删除"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除计划项失败");
    } finally {
      setDeletingTaskId(undefined);
    }
  }

  function clearTaskFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
  }

  function renderPlanActions(record: ContentTask) {
    return (
      <Space wrap>
        <Button size="small" onClick={() => openTaskEditor(record)}>
          编辑
        </Button>
        <Popconfirm
          title="确认这个计划项？"
          description="确认后只进入本周计划池，正文仍需到今日发布页批量生成。"
          okText="确认"
          cancelText="取消"
          onConfirm={() => handleConfirmTasks([record.id])}
        >
          <Button size="small" type={record.status === "planned" ? "primary" : "default"} loading={confirmingTaskId === record.id} disabled={record.status !== "planned"}>
            确认
          </Button>
        </Popconfirm>
        <Popconfirm
          title="重生成渠道标题？"
          description="只更新标题和计划约束，不生成正文。"
          okText="重生成"
          cancelText="取消"
          onConfirm={() => handleRegenerateTitle(record.id)}
        >
          <Button size="small" loading={regeneratingTaskId === record.id}>
            重生成标题
          </Button>
        </Popconfirm>
        <Popconfirm
          title="删除这个计划项？"
          description="只能删除尚未生成稿件的计划项。"
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
        title="周计划生成预览"
        subtitle="这里只判断本周要写什么：标题、渠道、产品、主蒸馏词和来源问题。正文统一到今日发布页批量生成。"
        actions={
          <>
            <Link href="/today">
              <Button disabled={!confirmedTaskCount}>进入今日发布</Button>
            </Link>
            <Popconfirm
              title="批量确认计划项？"
              description={`会把 ${selectedPlannedTaskIds.length || plannedTaskCount} 个计划项写入本周计划池，不生成正文。`}
              okText="确认"
              cancelText="取消"
              onConfirm={() => handleConfirmTasks(selectedPlannedTaskIds.length ? selectedPlannedTaskIds : tasks.filter((task) => task.status === "planned").map((task) => task.id))}
            >
              <Button loading={batchConfirming} disabled={!plannedTaskCount}>
                批量确认
              </Button>
            </Popconfirm>
            <Popconfirm
              title="生成新的周计划预览？"
              description="只生成标题级计划预览；正文、草稿和发布动作不会在这里执行。"
              okText="生成预览"
              cancelText="取消"
              okButtonProps={{ "data-testid": "weekly-plan-generate-confirm" }}
              onConfirm={handleGeneratePlan}
            >
              <Button type="primary" loading={generating} data-testid="weekly-plan-generate-button">
                生成计划预览
              </Button>
            </Popconfirm>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="计划项" value={tasks.length} suffix="条" />
        <MetricCard title="待确认" value={plannedTaskCount} suffix="条" />
        <MetricCard title="已确认" value={confirmedTaskCount} suffix="条" />
        <MetricCard title="硬约束完整" value={hardConstraintReady} suffix="条" />
        <MetricCard title="语义约束完整" value={semanticConstraintReady} suffix="条" />
      </div>
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
          <Form.Item label="发布天数" name="days">
            <InputNumber min={1} max={7} />
          </Form.Item>
          <Form.Item label="每日篇数" name="dailyCount">
            <InputNumber min={1} max={10} />
          </Form.Item>
          <Form.Item label="启用渠道" name="channels">
            <Select mode="multiple" style={{ minWidth: 320 }} options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="启用产品" name="products">
            <Select mode="multiple" style={{ minWidth: 240 }} options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </Form>
      </Card>
      <Alert
        showIcon
        type={plannedTaskCount ? "warning" : confirmedTaskCount ? "success" : "info"}
        message={`周计划只做预览和确认：待确认 ${plannedTaskCount} 条，已确认 ${confirmedTaskCount} 条。`}
        description="四层约束里，硬约束看品牌、产品、官网链接和发布数量；语义约束看主蒸馏词、来源问题和内容类型。确认后到今日发布页选择任务并批量生成正文。"
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
            <Button onClick={clearTaskFilters} disabled={!hasActiveFilter}>
              清空筛选
            </Button>
          </Space>
        )}
        locale={{
          emptyText: (
            <ActionEmpty
              title={hasActiveFilter ? "当前筛选没有计划项" : "还没有周计划预览"}
              description={hasActiveFilter ? "清空筛选或调整条件后再查看。" : "先设置发布节奏、渠道和产品，再生成标题级计划预览。"}
              action={
                hasActiveFilter ? (
                  <Button type="primary" onClick={clearTaskFilters}>
                    清空筛选
                  </Button>
                ) : (
                  <Popconfirm title="生成新的周计划预览？" description="只生成标题级计划，不生成正文。" okText="生成预览" cancelText="取消" onConfirm={handleGeneratePlan}>
                    <Button type="primary" loading={generating}>
                      生成计划预览
                    </Button>
                  </Popconfirm>
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
          { title: "来源问题", dataIndex: "sourceProblem", render: (value) => value || <span className="muted">待补</span> },
          { title: "官网链接目标", dataIndex: "officialLinkTarget", render: (value) => value || <span className="muted">待补</span> },
          { title: "状态", dataIndex: "status", render: (value) => <Tag>{statusLabels[value as TaskStatus]}</Tag>, width: 110 },
          { title: "维护", render: (_, record) => renderPlanActions(record), width: 300 }
        ]}
      />
      <Modal title="编辑计划项" open={Boolean(editingTask)} confirmLoading={savingTask} onOk={handleSaveTask} onCancel={() => setEditingTask(undefined)}>
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
          <Form.Item label="主蒸馏词" name="primaryDistilledTerm">
            <Input />
          </Form.Item>
          <Form.Item label="来源问题" name="sourceProblem">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="官网链接目标" name="officialLinkTarget">
            <Input placeholder="https://jotoai.com" />
          </Form.Item>
          <Form.Item label="目标关键词" name="targetKeywords">
            <Input placeholder="多个关键词用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
