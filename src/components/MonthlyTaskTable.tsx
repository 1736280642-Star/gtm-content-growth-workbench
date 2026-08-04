"use client";

import { DeleteOutlined, EyeOutlined, PauseOutlined, PlayCircleOutlined, ToolOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { MarkdownArticle } from "@/components/MarkdownArticle";

export type TaskBusinessStatus = "not_generated" | "generating" | "generated" | "scheduled" | "published";

const statusMeta: Record<TaskBusinessStatus, { label: string; color: string }> = {
  not_generated: { label: "未生成", color: "default" },
  generating: { label: "正在生成", color: "processing" },
  generated: { label: "已生成", color: "green" },
  scheduled: { label: "已排程", color: "purple" },
  published: { label: "已发布", color: "blue" }
};

export function getTaskBusinessStatus(task: ProductionMatrixTask): TaskBusinessStatus {
  const publicationStatus = (task as ProductionMatrixTask & { publication?: { status?: string } }).publication?.status;
  if (publicationStatus === "published" || (task.status as string) === "published") return "published";
  if (task.status === "scheduled") return "scheduled";
  if (task.status === "available" || task.currentDraft || task.lastUsableDraft || task.formalDraftId) return "generated";
  if (task.status === "generating") return "generating";
  return "not_generated";
}

function getBlockingReason(task: ProductionMatrixTask) {
  if (task.status === "awaiting_material") return "待补资料";
  if (task.status === "system_recovering") return task.failureReason || "生成失败";
  if (task.ctaValidationStatus === "failed") return "CTA 校验失败";
  return undefined;
}

interface MonthlyTaskTableProps {
  items: ProductionMatrixTask[];
  mode: "tasks" | "generation";
  selectedTaskIds: string[];
  onSelectionChange: (taskIds: string[]) => void;
  onGenerate?: (task: ProductionMatrixTask) => void;
  onPause?: (task: ProductionMatrixTask) => void;
  onRepair?: (task: ProductionMatrixTask) => void;
  onDelete?: (tasks: ProductionMatrixTask[]) => void;
  onFilteredChange?: (tasks: ProductionMatrixTask[]) => void;
  initialPreviewDraftId?: string;
  onAdmitSchedule?: (tasks: ProductionMatrixTask[]) => void;
}

export function MonthlyTaskTable({ items, mode, selectedTaskIds, onSelectionChange, onGenerate, onPause, onRepair, onDelete, onFilteredChange, initialPreviewDraftId, onAdmitSchedule }: MonthlyTaskTableProps) {
  const [channel, setChannel] = useState<string>();
  const [status, setStatus] = useState<TaskBusinessStatus>();
  const [contentType, setContentType] = useState<string>();
  const [ctaType, setCtaType] = useState<string>();
  const [ctaStatus, setCtaStatus] = useState<string>();
  const [query, setQuery] = useState("");
  const [previewTask, setPreviewTask] = useState<ProductionMatrixTask>();
  const [previewMarkdown, setPreviewMarkdown] = useState("");

  const channels = useMemo(() => Array.from(new Set(items.map((item) => item.channel))).sort(), [items]);
  const contentTypes = useMemo(() => Array.from(new Set(items.map((item) => item.articleTypeNameSnapshot || item.contentType))).sort(), [items]);
  const ctaTypes = useMemo(() => Array.from(new Set(items.map((item) => item.ctaType).filter(Boolean) as string[])).sort(), [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    if (channel && item.channel !== channel) return false;
    if (status && getTaskBusinessStatus(item) !== status) return false;
    if (contentType && (item.articleTypeNameSnapshot || item.contentType) !== contentType) return false;
    if (ctaType && item.ctaType !== ctaType) return false;
    if (ctaStatus && (item.ctaValidationStatus || "pending") !== ctaStatus) return false;
    const keyword = query.trim().toLowerCase();
    return !keyword || item.title.toLowerCase().includes(keyword) || item.question.toLowerCase().includes(keyword);
  }), [channel, contentType, ctaStatus, ctaType, items, query, status]);

  const clearFilters = () => {
    setChannel(undefined);
    setStatus(undefined);
    setContentType(undefined);
    setCtaType(undefined);
    setCtaStatus(undefined);
    setQuery("");
  };

  useEffect(() => onFilteredChange?.(filteredItems), [filteredItems, onFilteredChange]);

  useEffect(() => {
    if (!initialPreviewDraftId) return;
    const task = items.find((item) => item.formalDraftId === initialPreviewDraftId || item.currentDraft?.draftId === initialPreviewDraftId || item.lastUsableDraft?.draftId === initialPreviewDraftId);
    if (task) void openPreview(task);
  }, [initialPreviewDraftId, items]);

  async function openPreview(task: ProductionMatrixTask) {
    setPreviewTask(task);
    setPreviewMarkdown((task.currentDraft || task.lastUsableDraft)?.markdown || "");
    if (!task.formalDraftId) return;
    try {
      const response = await fetch(`/api/v5/drafts/${encodeURIComponent(task.formalDraftId)}`, { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; data?: { markdown?: string } };
      if (response.ok && body.ok) setPreviewMarkdown(body.data?.markdown || "");
    } catch { /* The drawer keeps a precise empty state when the formal draft cannot be read. */ }
  }

  function quickAction(task: ProductionMatrixTask) {
    const businessStatus = getTaskBusinessStatus(task);
    const blocker = getBlockingReason(task);
    if (blocker === "待补资料") return <Link href={`/knowledge?todo=${encodeURIComponent(task.knowledgeTodoId || task.taskId)}`}><Button size="small">补充资料</Button></Link>;
    if (mode === "generation") {
      if (businessStatus === "not_generated") return <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => onGenerate?.(task)}>生成</Button>;
      if (businessStatus === "generating") return <Button size="small" icon={<PauseOutlined />} onClick={() => onPause?.(task)}>查看进度</Button>;
      if (businessStatus === "generated") return <Button size="small" icon={<EyeOutlined />} onClick={() => void openPreview(task)}>预览正文</Button>;
      if (businessStatus === "scheduled") return <Link href="/monthly-plan?step=execution&view=schedule"><Button size="small">查看排程</Button></Link>;
      return <Link href="/monthly-plan?step=execution&view=today"><Button size="small">查看发布结果</Button></Link>;
    }
    if (businessStatus === "not_generated") return <Link href="/monthly-plan?step=generation"><Button size="small">去内容生成</Button></Link>;
    if (businessStatus === "generating") return <Link href="/monthly-plan?step=generation"><Button size="small">查看进度</Button></Link>;
    if (businessStatus === "generated") return <Link href="/monthly-plan?step=execution&view=schedule"><Button size="small">查看自动排程</Button></Link>;
    if (businessStatus === "scheduled") return <Link href="/monthly-plan?step=execution&view=schedule"><Button size="small">查看排程</Button></Link>;
    return <Link href="/monthly-plan?step=execution&view=today"><Button size="small">查看发布结果</Button></Link>;
  }

  const selectedTasks = items.filter((item) => selectedTaskIds.includes(item.taskId));
  const previewDraft = previewTask?.currentDraft || previewTask?.lastUsableDraft;

  return (
    <>
      <div className="v5-task-table-shell">
        <div className="v5-task-filter-bar">
          <Input.Search allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章标题" />
          <Select allowClear value={channel} onChange={setChannel} placeholder="全部渠道" options={channels.map((value) => ({ value, label: value }))} />
          <Select allowClear value={status} onChange={setStatus} placeholder={mode === "generation" ? "全部生成状态" : "全部状态"} options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
          <Select allowClear value={contentType} onChange={setContentType} placeholder="全部文章类型" options={contentTypes.map((value) => ({ value, label: value }))} />
          {mode === "generation" ? <Select allowClear value={ctaType} onChange={setCtaType} placeholder="全部 CTA 类型" options={ctaTypes.map((value) => ({ value, label: value }))} /> : null}
          {mode === "generation" ? <Select allowClear value={ctaStatus} onChange={setCtaStatus} placeholder="全部 CTA 校验" options={[{ value: "pending", label: "待校验" }, { value: "passed", label: "已通过" }, { value: "failed", label: "未通过" }]} /> : null}
          <Button onClick={clearFilters}>清除筛选</Button>
          <span className="v5-batch-result-count">{filteredItems.length} 篇</span>
        </div>

        {selectedTaskIds.length ? (
          <div className="v5-selection-bar">
            <span>已选择 {selectedTaskIds.length} 篇</span>
            <Space wrap>
              {mode === "generation" ? <Button icon={<ToolOutlined />} onClick={() => selectedTasks.forEach((task) => onRepair?.(task))}>格式检查与修复</Button> : null}
              {mode === "generation" ? <Button onClick={() => onAdmitSchedule?.(selectedTasks)}>批量准入排程</Button> : null}
              <Button danger icon={<DeleteOutlined />} onClick={() => onDelete?.(selectedTasks)}>批量删除</Button>
            </Space>
          </div>
        ) : null}

        <Table<ProductionMatrixTask>
          className="v5-unified-task-table"
          rowKey="taskId"
          size="small"
          tableLayout="fixed"
          pagination={{ pageSize: 12, showSizeChanger: false }}
          dataSource={filteredItems}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有文章任务" /> }}
          rowSelection={{ selectedRowKeys: selectedTaskIds, preserveSelectedRowKeys: true, onChange: (keys) => onSelectionChange(keys.map(String)), getCheckboxProps: (task) => ({ disabled: getTaskBusinessStatus(task) === "published" }) }}
          columns={[
            { title: "文章标题", dataIndex: "title", render: (value: string, task) => <div className="v5-task-title-wrap"><strong>{value}</strong>{getBlockingReason(task) ? <Tag color="error">{getBlockingReason(task)}</Tag> : null}</div> },
            { title: "文章类型", key: "contentType", width: 160, render: (_, task) => task.articleTypeNameSnapshot || task.contentType },
            { title: "渠道", dataIndex: "channel", width: 110, render: (value: string) => <Tag>{value}</Tag> },
            { title: mode === "generation" ? "生成状态" : "状态", key: "businessStatus", width: 140, render: (_, task) => { const meta = statusMeta[getTaskBusinessStatus(task)]; return <div className="v5-status-with-reason"><Tag color={meta.color}>{meta.label}</Tag>{task.generationProgress !== undefined ? <span>{task.generationProgress}%</span> : null}</div>; } },
            { title: "快捷操作", key: "action", width: mode === "generation" ? 220 : 150, render: (_, task) => <Space size={6} wrap>{quickAction(task)}{mode === "generation" && getTaskBusinessStatus(task) === "generated" ? <Button size="small" onClick={() => onRepair?.(task)}>检查格式</Button> : null}</Space> }
          ]}
        />
      </div>

      <Drawer width={760} open={Boolean(previewTask)} title={previewTask ? `正文预览：${previewTask.title}` : "正文预览"} onClose={() => setPreviewTask(undefined)}>
        {previewTask ? <div className="v5-draft-preview">
          <div className="v5-preview-meta-grid">
            <div><span>CTA 冻结内容</span><strong>{previewTask.frozenCtaPreview || "当前策略未配置 CTA 冻结文案"}</strong></div>
            <div><span>CTA 校验结果</span><strong>{previewTask.ctaValidationStatus === "passed" ? "已通过" : previewTask.ctaValidationStatus === "failed" ? "未通过" : "待校验"}</strong></div>
          </div>
          <MarkdownArticle markdown={previewMarkdown || previewDraft?.markdown} />
          {previewTask.failureReason ? <Typography.Text type="danger">失败原因：{previewTask.failureReason}</Typography.Text> : null}
        </div> : null}
      </Drawer>
    </>
  );
}
