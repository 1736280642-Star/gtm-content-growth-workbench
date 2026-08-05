"use client";

import { Alert, Button, Empty, message, Spin, Tag } from "antd";
import { useRouter } from "next/navigation";
import { MonthlyFlowNav } from "@/components/MonthlyFlowNav";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleCalendarLite } from "@/components/ScheduleCalendarLite";
import type { ScheduleDraftItem } from "@/lib/v5/monthly-workspace-contracts";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

export default function MonthlyMatrixSchedulePage() {
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const tasks = workspace?.productionTasks || [];
  const schedulable = tasks.filter((item) => item.status === "available" || item.status === "scheduled");
  const schedules: ScheduleDraftItem[] = schedulable.map((item) => ({ id: `schedule-${item.taskId}`, matrixItemId: item.taskId, title: item.title, product: item.question, channel: item.channel, date: item.scheduledAt?.slice(0, 10), time: item.scheduledAt?.slice(11, 16), platformAccount: item.platformAccount, status: item.status === "scheduled" ? "active" : "unscheduled", qualityReady: true }));

  async function saveSchedule(item: ScheduleDraftItem, value: { date: string; time: string; platformAccount: string }) {
    if (!workspace?.plan) throw new Error("月度计划尚未加载。");
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/schedule/${encodeURIComponent(item.matrixItemId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: workspace.plan.version, scheduledAt: `${value.date}T${value.time}:00+08:00`, platformAccount: value.platformAccount, auditReason: "人工调整系统生成的发布排程" }) });
    const body = await response.json() as { ok?: boolean; error?: { message?: string } };
    if (!response.ok || !body.ok) throw new Error(body.error?.message || "排程保存失败。");
    await refresh(workspace.month); messageApi.success("排程已保存。");
  }

  return <>
    {messageContext}
    <PageHeader title="发布排程" titleExtra={<Tag color="blue">{workspace?.month || "读取中"}</Tag>} subtitle="系统为校验通过的正文自动安排日期、时间和发布账号；可在这里人工调整。" />
    <MonthlyFlowNav />
    {error ? <Alert showIcon type="error" message="排程工作区读取失败" description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} /> : null}
    {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取发布排程</span></div> : null}
    {schedules.length ? <ScheduleCalendarLite items={schedules} month={workspace?.month || new Date().toISOString().slice(0, 7)} onSchedule={saveSchedule} /> : <div className="v5-action-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可排程正文。系统会在正文生成与校验完成后自动安排发布日期。" /><Button onClick={() => router.push("/monthly-plan?step=production")}>查看文章任务编排</Button></div>}
  </>;
}
