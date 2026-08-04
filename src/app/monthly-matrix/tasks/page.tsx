"use client";

import { DeleteOutlined, RocketOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, message, Modal, Space, Spin, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MonthlyFlowNav } from "@/components/MonthlyFlowNav";
import { getTaskBusinessStatus, MonthlyTaskTable } from "@/components/MonthlyTaskTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

export default function MonthlyMatrixTasksPage() {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const tasks = useMemo(() => workspace?.productionTasks || [], [workspace?.productionTasks]);
  const counts = useMemo(() => ({
    notGenerated: tasks.filter((task) => getTaskBusinessStatus(task) === "not_generated").length,
    generating: tasks.filter((task) => getTaskBusinessStatus(task) === "generating").length,
    generated: tasks.filter((task) => getTaskBusinessStatus(task) === "generated").length,
    scheduled: tasks.filter((task) => getTaskBusinessStatus(task) === "scheduled").length,
    published: tasks.filter((task) => getTaskBusinessStatus(task) === "published").length
  }), [tasks]);

  function admitTasks() {
    const eligible = tasks.filter((task) => getTaskBusinessStatus(task) === "not_generated" && task.status !== "awaiting_material");
    const admitted = selectedTaskIds.length ? eligible.filter((task) => selectedTaskIds.includes(task.taskId)) : eligible;
    if (!admitted.length) return void messageApi.warning("没有可准入的未生成任务；待补资料任务需先解除阻塞。");
    localStorage.setItem(`monthly-generation-admission:${workspace?.month || "latest"}`, JSON.stringify(admitted.map((task) => task.taskId)));
    messageApi.success(`已准入 ${admitted.length} 篇任务，尚未调用 Provider。`);
    router.push("/monthly-matrix/batch-generation");
  }

  function deleteTasks(selected: ProductionMatrixTask[]) {
    if (!workspace?.plan || !selected.length) return;
    Modal.confirm({
      title: `删除 ${selected.length} 篇文章任务？`,
      content: "未发布任务采用软删除并可撤销；已生成正文会解除可用状态，已排程任务先取消排程。已发布任务只会归档。删除后将提示策略配额缺口。",
      okText: "确认删除", okButtonProps: { danger: true }, cancelText: "取消",
      onOk: async () => {
        setDeleting(true);
        try {
          const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/tasks`, { method: "DELETE", headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ taskIds: selected.map((task) => task.taskId), expectedVersion: workspace.plan?.version, auditReason: "用户从矩阵任务页批量删除文章任务" }) });
          const body = await response.json() as { ok?: boolean; data?: { archived?: number; deleted?: number; quotaGap?: number }; error?: { message?: string } };
          if (!response.ok || !body.ok) throw new Error(body.error?.message || "任务删除失败。");
          await refresh(workspace.month); setSelectedTaskIds([]);
          messageApi.success(`已处理 ${Number(body.data?.deleted || 0) + Number(body.data?.archived || 0)} 篇任务；策略配额缺口 ${body.data?.quotaGap || 0} 篇。`);
        } catch (reason) { messageApi.error(reason instanceof Error ? reason.message : "任务删除失败。"); } finally { setDeleting(false); }
      }
    });
  }

  return <>
    {messageContext}
    <PageHeader title="矩阵任务" titleExtra={<Tag color="blue">{workspace?.month || "读取中"}</Tag>} subtitle="查看本月具体文章任务、业务状态与下一步；生产阻塞原因独立显示。" actions={<Space wrap><Button danger icon={<DeleteOutlined />} disabled={!selectedTaskIds.length} loading={deleting} onClick={() => deleteTasks(tasks.filter((task) => selectedTaskIds.includes(task.taskId)))}>批量删除</Button><Button type="primary" icon={<RocketOutlined />} onClick={admitTasks}>一键准入内容生成</Button></Space>} />
    <MonthlyFlowNav />
    {error ? <Alert showIcon type="error" message="矩阵任务读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} /> : null}
    {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取矩阵任务</span></div> : null}
    <V5StatusRail items={[{ label: "未生成", value: counts.notGenerated, helper: "可选择后准入生产" }, { label: "正在生成", value: counts.generating, helper: "查看生产进度" }, { label: "已生成", value: counts.generated, helper: "等待人工排程" }, { label: "已排程", value: counts.scheduled, helper: "已确认发布日期" }, { label: "已发布", value: counts.published, helper: "保留历史，不可删除" }]} />
    {tasks.length ? <MonthlyTaskTable items={tasks} mode="tasks" selectedTaskIds={selectedTaskIds} onSelectionChange={setSelectedTaskIds} onDelete={deleteTasks} /> : <div className="v5-action-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无矩阵任务。返回“内容策略包”完成预检并批准策略，系统会按渠道配额展开文章任务。" /><Button onClick={() => router.push("/monthly-matrix")}>返回内容策略包</Button></div>}
  </>;
}
