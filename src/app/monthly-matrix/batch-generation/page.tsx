"use client";

import { CheckCircleOutlined, PauseOutlined, PlayCircleOutlined, ScheduleOutlined, ToolOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, message, Modal, Progress, Space, Spin, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonthlyFlowNav } from "@/components/MonthlyFlowNav";
import { getTaskBusinessStatus, MonthlyTaskTable } from "@/components/MonthlyTaskTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import type { GenerationBatchRecord, ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

const batchLabels = { queued: "等待开始", running: "正在生成", pausing: "正在暂停", paused: "已暂停", completed: "已完成", failed: "部分失败", cancelled: "已取消" } as const;

function MonthlyBatchGenerationWorkspace() {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<ProductionMatrixTask[]>([]);
  const [activeBatch, setActiveBatch] = useState<GenerationBatchRecord>();
  const [initialPreviewDraftId, setInitialPreviewDraftId] = useState<string>();
  const processingRef = useRef(false);
  const allTasks = useMemo(() => workspace?.productionTasks || [], [workspace?.productionTasks]);
  const packageByVersion = useMemo(() => new Map((workspace?.rulePackages || []).map((item) => [item.id, item])), [workspace?.rulePackages]);
  const questionProduct = useMemo(() => new Map((workspace?.targetQuestions || []).map((item) => [item.questionVersionId, item.productId])), [workspace?.targetQuestions]);
  const productGroups = useMemo(() => {
    const groups = new Map<string, { productId: string; productName: string; tasks: ProductionMatrixTask[] }>();
    for (const task of allTasks) {
      const snapshot = task as ProductionMatrixTask & { productId?: string; productNameSnapshot?: string };
      const rulePackage = packageByVersion.get(task.rulePackageVersionId);
      const productId = snapshot.productId || rulePackage?.productId || questionProduct.get(task.questionVersionId) || "unassigned";
      const productName = snapshot.productNameSnapshot || rulePackage?.productName || (productId === "unassigned" ? "待确认产品" : productId);
      const group = groups.get(productId) || { productId, productName, tasks: [] };
      group.tasks.push(task);
      groups.set(productId, group);
    }
    return Array.from(groups.values()).sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN"));
  }, [allTasks, packageByVersion, questionProduct]);
  const productContextByTaskId = useMemo(() => Object.fromEntries(productGroups.flatMap((group) => group.tasks.map((task) => [task.taskId, { productId: group.productId, productName: group.productName }]))), [productGroups]);
  const tasks = allTasks;
  const fallbackBatch = workspace?.generationBatches?.find((batch) => ["queued", "running", "pausing", "paused"].includes(batch.status));
  const currentBatch = activeBatch || fallbackBatch;

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
    await refresh(workspace.month); setSelectedTaskIds([]); messageApi.success(`任务已软删除；策略配额缺口 ${body.data?.quotaGap || 0} 篇。`);
  }

  function admitSchedule(selected: ProductionMatrixTask[]) {
    const ready = selected.filter((task) => getTaskBusinessStatus(task) === "generated" && task.ctaValidationStatus !== "failed");
    if (!ready.length) return void messageApi.warning("所选任务尚无可排程正文，或 CTA 校验未通过。");
    localStorage.setItem(`monthly-schedule-admission:${workspace?.month || "latest"}`, JSON.stringify(ready.map((task) => task.taskId)));
    messageApi.success(`已准入 ${ready.length} 篇任务，系统将自动生成发布排程。`);
    router.push("/monthly-plan?step=execution&view=schedule");
  }

  const batchProgress = currentBatch ? Math.round(((currentBatch.completedTaskIds.length + currentBatch.failedTaskIds.length) / Math.max(1, currentBatch.taskIds.length)) * 100) : 0;
  const ready = tasks.filter((task) => getTaskBusinessStatus(task) === "not_generated").length;
  const generating = tasks.filter((task) => getTaskBusinessStatus(task) === "generating").length;
  const generated = tasks.filter((task) => getTaskBusinessStatus(task) === "generated").length;
  const anomalies = allTasks.filter((task) => task.status === "awaiting_material" || task.status === "system_recovering" || task.ctaValidationStatus === "failed");

  function productForTask(task: ProductionMatrixTask) {
    return productGroups.find((group) => group.tasks.some((item) => item.taskId === task.taskId));
  }

  const scheduled = tasks.filter((task) => getTaskBusinessStatus(task) === "scheduled").length;
  const published = tasks.filter((task) => getTaskBusinessStatus(task) === "published").length;
  const visibleAnomalies = anomalies;

  return <>
    {messageContext}
    <PageHeader
      title="文章任务编排"
      titleExtra={<Tag color="blue">{workspace?.month || "读取中"}</Tag>}
      subtitle="所有产品的文章任务集中展示；系统自动推进，你可按产品和状态快速筛选。"
      actions={<Space wrap>
        {visibleAnomalies.length ? <Button icon={<WarningOutlined />} danger onClick={() => document.getElementById("production-exceptions")?.scrollIntoView({ behavior: "smooth" })}>异常处理 {visibleAnomalies.length}</Button> : null}
        <Link href="/monthly-plan?step=execution&view=schedule"><Button icon={<ScheduleOutlined />}>查看生成与发布</Button></Link>
      </Space>}
    />
    <MonthlyFlowNav />
    {error ? <Alert showIcon type="error" message="生产工作区读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} /> : null}
    {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取文章任务编排</span></div> : null}

    <V5StatusRail items={[{ label: "全部任务", value: tasks.length, helper: `${productGroups.length} 个产品` }, { label: "待生成", value: ready, helper: "系统自动领取" }, { label: "生成中", value: generating, helper: "正在形成正文" }, { label: "已生成", value: generated, helper: "等待自动排程" }, { label: "已排程", value: scheduled, helper: "等待发布" }, { label: "已发布", value: published, helper: "进入复盘" }]} />

    {currentBatch ? <div className="v5-generation-batch-strip"><div><strong>{batchLabels[currentBatch.status]}</strong><span>{currentBatch.status === "pausing" ? "当前任务完成后自动暂停" : `${currentBatch.completedTaskIds.length} / ${currentBatch.taskIds.length} 篇完成`}</span></div><Progress percent={batchProgress} status={currentBatch.status === "failed" ? "exception" : currentBatch.status === "completed" ? "success" : "active"} /><Tag icon={currentBatch.status === "completed" ? <CheckCircleOutlined /> : undefined}>{currentBatch.failedTaskIds.length} 篇失败</Tag></div> : null}

    {tasks.length ? <MonthlyTaskTable items={tasks} mode="generation" productContextByTaskId={productContextByTaskId} initialPreviewDraftId={initialPreviewDraftId} selectedTaskIds={selectedTaskIds} onSelectionChange={setSelectedTaskIds} onFilteredChange={setFilteredTasks} onGenerate={(task) => void createAndRun([task])} onPause={() => messageApi.info(currentBatch ? `${batchLabels[currentBatch.status]}，已完成 ${batchProgress}%` : "当前没有运行中的生成批次。")} onRepair={(task) => checkAndRepair([task])} onDelete={(selected) => void deleteTasks(selected)} onAdmitSchedule={admitSchedule} /> : (!loading ? <div className="v5-action-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前月份还没有文章任务，系统会在产品策略确认后自动创建。" /></div> : null)}

    {visibleAnomalies.length ? <section id="production-exceptions" className="production-exception-panel" aria-labelledby="production-exception-title">
      <div className="production-exception-heading"><div><span>异常处理</span><h2 id="production-exception-title">{visibleAnomalies.length} 项需要关注</h2></div><Tag color="error">系统已暂停受影响任务</Tag></div>
      <div className="production-exception-list">{visibleAnomalies.slice(0, 8).map((task) => {
        const product = productForTask(task);
        const awaitingMaterial = task.status === "awaiting_material";
        const reason = awaitingMaterial ? "缺少正文成立所需的产品资料" : task.failureReason || (task.ctaValidationStatus === "failed" ? "CTA 校验未通过" : "正文生成失败");
        return <div key={task.taskId}><div><Tag>{product?.productName || "待确认产品"}</Tag><strong>{task.title}</strong><span>{reason}</span></div>{awaitingMaterial && product?.productId && product.productId !== "unassigned" ? <Link href={`/products/${encodeURIComponent(product.productId)}?tab=materials`}><Button size="small" type="primary">补充产品资料</Button></Link> : <Button size="small" onClick={() => void createAndRun([task])}>重新运行</Button>}</div>;
      })}</div>
    </section> : null}

    <details className="production-manual-details">
      <summary>人工操作</summary>
      <div className="production-manual-controls"><span>仅用于补跑、暂停或修复异常批次。</span><Space wrap><Button icon={<PlayCircleOutlined />} onClick={currentBatch?.status === "paused" ? () => void runBatch(currentBatch) : oneClickGenerate}>{currentBatch?.status === "paused" ? "继续生成" : "手动补跑"}</Button><Button icon={<PauseOutlined />} disabled={!currentBatch || !["queued", "running"].includes(currentBatch.status)} onClick={() => void pauseBatch()}>暂停批次</Button><Button icon={<ToolOutlined />} onClick={() => checkAndRepair()}>检查与修复</Button></Space></div>
    </details>
  </>;
}

export default function MonthlyBatchGenerationPage() {
  return <Suspense fallback={<div className="v5-loading-row"><Spin /><span>正在读取文章任务编排</span></div>}><MonthlyBatchGenerationWorkspace /></Suspense>;
}
