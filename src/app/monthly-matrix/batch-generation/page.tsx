"use client";

import { ArrowLeftOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, message, Space, Spin, Tabs, Tag } from "antd";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BatchGenerationMatrixTable } from "@/components/BatchGenerationMatrixTable";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleCalendarLite } from "@/components/ScheduleCalendarLite";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";
import type { ProductionDraftSummary, ScheduleDraftItem } from "@/lib/v5/monthly-workspace-contracts";
import type { FormalDraftVersion } from "@/lib/v5/single-article-contracts";

export default function MonthlyBatchGenerationPage() {
  const [messageApi, messageContext] = message.useMessage();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("content");
  const [initialDraft, setInitialDraft] = useState<ProductionDraftSummary>();
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const tasks = workspace?.productionTasks || [];
  const ready = tasks.filter((item) => item.status === "ready_for_generation").length;
  const generating = tasks.filter((item) => item.status === "generating" || item.status === "system_recovering").length;
  const available = tasks.filter((item) => item.status === "available" || item.status === "scheduled").length;
  const awaitingMaterial = tasks.filter((item) => item.status === "awaiting_material").length;
  const canRunFormalGeneration = workspace?.source.productionQueue === "v5_mysql" && ready > 0;
  const calendarMonth = workspace?.month || new Date().toISOString().slice(0, 7);
  const schedules: ScheduleDraftItem[] = tasks
    .filter((item) => item.status === "available" || item.status === "scheduled")
    .map((item) => ({
      id: `schedule-${item.taskId}`,
      matrixItemId: item.taskId,
      title: item.title,
      product: item.question,
      channel: item.channel,
      date: item.scheduledAt?.slice(0, 10),
      time: item.scheduledAt?.slice(11, 16),
      platformAccount: item.platformAccount,
      status: item.status === "scheduled" ? "active" : "unscheduled",
      qualityReady: true
    }));

  useEffect(() => {
    const syncHashTab = () => setActiveTab(window.location.hash === "#schedule" ? "schedule" : "content");
    syncHashTab();
    window.addEventListener("hashchange", syncHashTab);
    const draftId = searchParams.get("draftId");
    if (!draftId) {
      return () => window.removeEventListener("hashchange", syncHashTab);
    }
    const controller = new AbortController();
    void fetch(`/api/v5/drafts/${encodeURIComponent(draftId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; data?: FormalDraftVersion & { platformKey?: "weixin" } };
        if (!response.ok || !body.ok || !body.data) return;
        setInitialDraft({
          draftId: body.data.draftVersionId,
          title: body.data.title,
          markdown: body.data.markdown,
          status: "available",
          basisSummary: ["正文仅使用已冻结的公开资料", "系统已完成事实、公开范围、禁止表达、结构与渠道适配检查"],
          updatedAt: body.data.createdAt,
          platformKey: body.data.platformKey
        });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      window.removeEventListener("hashchange", syncHashTab);
    };
  }, [searchParams]);

  async function saveDraft(_: unknown, markdown: string) {
    if (!initialDraft) throw new Error("当前正文尚未建立可编辑版本。");
    const response = await fetch(`/api/v5/drafts/${encodeURIComponent(initialDraft.draftId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown, auditReason: "用户在批量生成中心按需编辑正文" })
    });
    const body = await response.json() as { ok?: boolean; message?: string; error?: { message?: string } };
    if (!response.ok || !body.ok) throw new Error(body.error?.message || "正文保存失败。");
    messageApi.success(body.message || "正文已保存并进入自动复检。");
  }

  async function saveSchedule(item: ScheduleDraftItem, value: { date: string; time: string; platformAccount: string }) {
    if (!workspace?.plan) throw new Error("月度计划尚未加载。");
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/schedule/${encodeURIComponent(item.matrixItemId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: workspace.plan.version,
        scheduledAt: `${value.date}T${value.time}:00+08:00`,
        platformAccount: value.platformAccount,
        auditReason: "在批量生成中心安排可用正文发布时间"
      })
    });
    const body = await response.json() as { ok?: boolean; error?: { message?: string } };
    if (!response.ok || !body.ok) throw new Error(body.error?.message || "排程保存失败。");
    await refresh(workspace.month);
    messageApi.success("排程已保存。");
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title="批量生成中心"
        titleExtra={<Space size={6}><Tag color="blue">{workspace?.month || "读取中"}</Tag>{workspace?.strategyPackage ? <Tag>{`策略 v${workspace.strategyPackage.version}`}</Tag> : null}</Space>}
        subtitle="只执行已批准策略；系统自动检查、修复和恢复，可用正文直接进入待排程。"
        actions={<Space wrap><Link href="/monthly-matrix"><Button icon={<ArrowLeftOutlined />}>返回月度内容矩阵</Button></Link><Button type="primary" icon={<ThunderboltOutlined />} disabled={!canRunFormalGeneration}>生成可用内容 {ready || ""}</Button></Space>}
      />

      {error ? <Alert showIcon type="error" message="生产工作区读取失败" description={error} action={<Button size="small" onClick={() => void refresh().catch(() => undefined)}>重新读取</Button>} /> : null}
      {!error && workspace?.source.productionQueue !== "v5_mysql" ? <Alert showIcon type="warning" message="正式生产服务待接入" description="月度策略与矩阵任务已就绪；当前正式生产 repository 未配置，系统不会用演示正文冒充真实结果。" /> : null}
      {loading && !workspace ? <div className="v5-loading-row"><Spin /><span>正在读取内容生产任务</span></div> : null}

      <V5StatusRail items={[
        { label: "待生成", value: ready, helper: "已批准且资料充分" },
        { label: "生成中", value: generating, helper: "包含系统自动恢复" },
        { label: "可用", value: available, helper: "系统检查通过，自动待排程" },
        { label: "待补资料", value: awaitingMaterial, helper: "仅关键事实缺失" }
      ]} />

      <Tabs
        className="v5-production-tabs"
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          window.history.replaceState(null, "", key === "schedule" ? `${window.location.pathname}#schedule` : window.location.pathname);
        }}
        items={[
          {
            key: "content",
            label: `内容 ${tasks.length}`,
            children: <BatchGenerationMatrixTable items={tasks} initialDraft={initialDraft} onSaveDraft={saveDraft} />
          },
          {
            key: "schedule",
            label: `排程 ${schedules.length}`,
            children: <ScheduleCalendarLite items={schedules} month={calendarMonth} onSchedule={saveSchedule} />
          }
        ]}
      />
    </>
  );
}
