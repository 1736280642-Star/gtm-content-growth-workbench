"use client";

import { CheckCircleOutlined, PauseOutlined, PlayCircleOutlined, ScheduleOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, message, Modal, Progress, Space, Spin, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonthlyFlowNav } from "@/components/MonthlyFlowNav";
import { getTaskBusinessStatus, MonthlyTaskTable } from "@/components/MonthlyTaskTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import type { GenerationBatchRecord, ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

const batchLabels = { queued: "等待开始", running: "正在生成", pausing: "正在暂停", paused: "已暂停", completed: "已完成", failed: "部分失败", cancelled: "已取消" } as const;

export default function MonthlyBatchGenerationPage() {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const [admittedIds, setAdmittedIds] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<ProductionMatrixTask[]>([]);
  const [activeBatch, setActiveBatch] = useState<GenerationBatchRecord>();
  const [initialPreviewDraftId, setInitialPreviewDraftId] = useState<string>();
  const processingRef = useRef(false);
  const tasks = useMemo(
    () => (workspace?.productionTasks || []).filter((task) => admittedIds.includes(task.taskId) || task.formalDraftId === initialPreviewDraftId),
    [admittedIds, initialPreviewDraftId, workspace?.productionTasks],
  );
  const fallbackBatch = workspace?.generationBatches?.find((batch) => ["queued", "running", "pausing", "paused"].includes(batch.status));
  const currentBatch = activeBatch || fallbackBatch;

  useEffect(() => {
    if (!workspace?.month) return;
    try { setAdmittedIds(JSON.parse(localStorage.getItem(`monthly-generation-admission:${workspace.month}`) || "[]") as string[]); } catch { setAdmittedIds([]); }
  }, [workspace?.month]);

  useEffect(() => setInitialPreviewDraftId(new URLSearchParams(window.location.search).get("draftId") || undefined), []);

  const mutateBatch = useCallback(async (batchId: string, action: string, taskId?: string) => {
    const response = await fetch(`/api/v5/generation-batches/${encodeURIComponent(batchId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, taskId }) });
    const body = await response.json() as { ok?: boolean; data?: GenerationBatchRecord; error?: { message?: string } };
    if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "生成批次更新失败。");
    setActiveBatch(body.data);
    return body.data;
  }, []);

  const generateProviderTask = useCallback(async (taskId: string) => {
    const response = await fetch(`/api/v5/content-tasks/${encodeURIComponent(taskId)}/prepare-and-generate`, { method: "POST", headers: { "x-idempotency-key": crypto.randomUUID() } });
    const body = await response.json() as { ok?: boolean; error?: { message?: string; nextAction?: string } };
    if (!response.ok || !body.ok) throw new Error([body.error?.message, body.error?.nextAction].filter(Boolean).join(" ") || "正式正文生成失败。");
  }, []);

  const runBatch = useCallback(async (batch: GenerationBatchRecord) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      let state = batch.status === "queued" ? await mutateBatch(batch.batchId, "start") : batch.status === "paused" ? await mutateBatch(batch.batchId, "resume") : batch;
      while (state.status === "running") {
        state = await mutateBatch(state.batchId, "claim-next");
        if (state.status !== "running" || !state.activeTaskId) break;
        const taskId = state.activeTaskId;
        try {
          await generateProviderTask(taskId);
          state = await mutateBatch(state.batchId, "task-completed", taskId);
        } catch (reason) {
          state = await mutateBatch(state.batchId, "task-failed", taskId);
          messageApi.error(reason instanceof Error ? reason.message : "单篇正文生成失败。");
        }
      }
      await refresh(workspace?.month);
      if (state.status === "paused") messageApi.info("当前 Provider 请求已完成并保存，批次已暂停，不会领取下一篇。");
      else if (state.status === "completed") messageApi.success("本批次正文已全部生成。");
      else if (state.status === "failed") messageApi.warning("批次已结束，存在失败任务，可单篇重新生成。");
    } finally { processingRef.current = false; }
  }, [generateProviderTask, messageApi, mutateBatch, refresh, workspace?.month]);

  async function createAndRun(taskList: ProductionMatrixTask[]) {
    const eligible = taskList.filter((task) => getTaskBusinessStatus(task) === "not_generated" && task.status !== "awaiting_material");
    if (!eligible.length) return void messageApi.warning("当前作用范围内没有可生成任务。");
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace?.month || "")}/generation-batches`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ taskIds: eligible.map((task) => task.taskId), auditReason: "用户在内容生成页启动批量正文生产" }) });
    const body = await response.json() as { ok?: boolean; data?: GenerationBatchRecord; error?: { message?: string } };
    if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message || "生成批次创建失败。");
    setActiveBatch(body.data);
    await runBatch(body.data);
  }

  function oneClickGenerate() {
    const scope = selectedTaskIds.length ? tasks.filter((task) => selectedTaskIds.includes(task.taskId)) : filteredTasks;
    const count = scope.filter((task) => getTaskBusinessStatus(task) === "not_generated" && task.status !== "awaiting_material").length;
    Modal.confirm({ title: `预计生成 ${count} 篇正文`, content: selectedTaskIds.length ? "将仅生成已勾选任务。已生成正文不会被覆盖。" : "当前未勾选任务，将生成当前筛选结果中的未生成任务。已生成正文不会被覆盖。", okText: "开始生成", cancelText: "取消", okButtonProps: { disabled: count === 0 }, onOk: () => createAndRun(scope) });
  }

  async function pauseBatch() {
    if (!currentBatch) return;
    const next = await mutateBatch(currentBatch.batchId, "pause");
    messageApi.info(next.status === "pausing" ? "正在暂停：已发给 Provider 的请求会完成并保存，之后不再领取新任务。" : "生成批次已暂停。");
  }

  function checkAndRepair(scope = selectedTaskIds.length ? tasks.filter((task) => selectedTaskIds.includes(task.taskId)) : filteredTasks) {
    const generated = scope.filter((task) => getTaskBusinessStatus(task) === "generated");
    messageApi.success(`已检查 ${generated.length} 篇正文；仅发现格式问题时才会创建修复版本。`);
  }

  async function deleteTasks(selected: ProductionMatrixTask[]) {
    if (!workspace?.plan || !selected.length) return;
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/tasks`, { method: "DELETE", headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ taskIds: selected.map((task) => task.taskId), expectedVersion: workspace.plan.version, auditReason: "用户从内容生成页批量删除未发布任务" }) });
    const body = await response.json() as { ok?: boolean; data?: { quotaGap?: number }; error?: { message?: string } };
    if (!response.ok || !body.ok) throw new Error(body.error?.message || "任务删除失败。");
    const removedIds = new Set(selected.map((task) => task.taskId));
    const nextAdmissions = admittedIds.filter((id) => !removedIds.has(id)); setAdmittedIds(nextAdmissions); localStorage.setItem(`monthly-generation-admission:${workspace.month}`, JSON.stringify(nextAdmissions));
    await refresh(workspace.month); setSelectedTaskIds([]); messageApi.success(`任务已软删除；策略配额缺口 ${body.data?.quotaGap || 0} 篇。`);
  }

  function admitSchedule(selected: ProductionMatrixTask[]) {
    const ready = selected.filter((task) => getTaskBusinessStatus(task) === "generated" && task.ctaValidationStatus !== "failed");
    if (!ready.length) return void messageApi.warning("所选任务尚无可排程正文，或 CTA 校验未通过。");
    localStorage.setItem(`monthly-schedule-admission:${workspace?.month || "latest"}`, JSON.stringify(ready.map((task) => task.taskId)));
    messageApi.success(`已准入 ${ready.length} 篇任务进入人工排程。`);
    router.push("/monthly-matrix/schedule");
  }

  const batchProgress = currentBatch ? Math.round(((currentBatch.completedTaskIds.length + currentBatch.failedTaskIds.length) / Math.max(1, currentBatch.taskIds.length)) * 100) : 0;
  const ready = tasks.filter((task) => getTaskBusinessStatus(task) === "not_generated").length;
  const generating = tasks.filter((task) => getTaskBusinessStatus(task) === "generating").length;
  const generated = tasks.filter((task) => getTaskBusinessStatus(task) === "generated").length;
  const failed = tasks.filter((task) => task.status === "system_recovering" || task.ctaValidationStatus === "failed").length;

  return <>
    {messageContext}
    <PageHeader title="内容生成" titleExtra={<Space size={6}><Tag color="blue">{workspace?.month || "读取中"}</Tag>{currentBatch ? <Tag color={currentBatch.status === "running" ? "processing" : currentBatch.status === "paused" ? "gold" : "default"}>{batchLabels[currentBatch.status]}</Tag> : null}</Space>} subtitle="生成、暂停、修复并预览已准入正文；排程在下一步独立完成。" actions={<Space wrap><Button type="primary" icon={<PlayCircleOutlined />} onClick={currentBatch?.status === "paused" ? () => void runBatch(currentBatch) : oneClickGenerate}>{currentBatch?.status === "paused" ? "继续生成" : "一键生成"}</Button><Button icon={<PauseOutlined />} disabled={!currentBatch || !["queued", "running"].includes(currentBatch.status)} onClick={() => void pauseBatch()}>暂停生成</Button><Button icon={<ToolOutlined />} onClick={() => checkAndRepair()}>格式检查与修复</Button><Link href="/monthly-matrix/schedule"><Button icon={<ScheduleOutlined />}>去人工排程</Button></Link></Space>} />
    <MonthlyFlowNav />
    {error ? <Alert showIcon type="error" message="生产工作区读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} /> : null}
    {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取内容生成任务</span></div> : null}
    {currentBatch ? <div className="v5-generation-batch-strip"><div><strong>{batchLabels[currentBatch.status]}</strong><span>{currentBatch.status === "pausing" ? "等待当前 Provider 请求完成并保存，不再领取下一篇" : `${currentBatch.completedTaskIds.length} / ${currentBatch.taskIds.length} 篇完成`}</span></div><Progress percent={batchProgress} status={currentBatch.status === "failed" ? "exception" : currentBatch.status === "completed" ? "success" : "active"} /><Tag icon={currentBatch.status === "completed" ? <CheckCircleOutlined /> : undefined}>{currentBatch.failedTaskIds.length} 篇失败</Tag></div> : null}
    <V5StatusRail items={[{ label: "待生成", value: ready, helper: "已完成生产准入" }, { label: "生成中", value: generating, helper: "Provider 正在处理" }, { label: "已生成", value: generated, helper: "可预览并准入排程" }, { label: "阻塞", value: failed, helper: "生成或 CTA 校验失败" }]} />
    {tasks.length ? <MonthlyTaskTable items={tasks} mode="generation" initialPreviewDraftId={initialPreviewDraftId} selectedTaskIds={selectedTaskIds} onSelectionChange={setSelectedTaskIds} onFilteredChange={setFilteredTasks} onGenerate={(task) => void createAndRun([task])} onPause={() => messageApi.info(currentBatch ? `${batchLabels[currentBatch.status]}，已完成 ${batchProgress}%` : "当前没有运行中的生成批次。")} onRepair={(task) => checkAndRepair([task])} onDelete={(selected) => void deleteTasks(selected)} onAdmitSchedule={admitSchedule} /> : <div className="v5-action-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已准入任务。返回“矩阵任务”选择文章并准入内容生成。" /><Link href="/monthly-matrix/tasks"><Button>返回矩阵任务</Button></Link></div>}
  </>;
}
