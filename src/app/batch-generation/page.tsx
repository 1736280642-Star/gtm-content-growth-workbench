"use client";

import { PauseOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, message, Space, Spin, Tabs, Tag } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { BatchGenerationMatrixTable } from "@/components/BatchGenerationMatrixTable";
import { ExceptionQueuePreview } from "@/components/ExceptionQueuePreview";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleCalendarLite } from "@/components/ScheduleCalendarLite";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";
import type { BatchQueueItem } from "@/lib/v5/monthly-workspace-contracts";

export default function BatchGenerationPage() {
  const [messageApi, messageContext] = message.useMessage();
  const [activeTab, setActiveTab] = useState("tasks");
  const [generatingTaskId, setGeneratingTaskId] = useState<string>();
  const [generationError, setGenerationError] = useState<{ taskId: string; message: string; nextAction: string }>();
  const idempotencyKeys = useRef(new Map<string, string>());
  const { workspace, loading, error, refresh } = useMonthlyWorkspace();
  const batchQueueItems = workspace?.batchQueueItems || [];
  const exceptionItems = workspace?.exceptionItems || [];
  const scheduleDraftItems = workspace?.scheduleDraftItems || [];
  const generatableCount = batchQueueItems.filter(
    (item) => item.formal && item.titleConfirmed && !["blocked", "needs_review"].includes(item.finalEvidenceGate) && item.evidencePreview !== "blocked"
  ).length;
  const evidenceBlockedCount = batchQueueItems.filter((item) => ["needs_material", "needs_review", "blocked"].includes(item.evidencePreview)).length;
  const titlePendingCount = batchQueueItems.filter((item) => !item.titleConfirmed).length;
  const platformPendingCount = batchQueueItems.filter((item) => item.scheduleStatus === "pending_config" || item.finalEvidenceGate === "pending_config").length;
  const openExceptionCount = exceptionItems.filter((item) => item.status === "open").length;

  useEffect(() => {
    function syncTabFromHash() {
      const hash = window.location.hash.replace("#", "");
      if (hash === "schedule" || hash === "exceptions") setActiveTab(hash);
    }

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  function handleTabChange(key: string) {
    setActiveTab(key);
    const hash = key === "tasks" ? "" : `#${key}`;
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  }

  const handleGenerate = useCallback(async (item: BatchQueueItem) => {
    if (generatingTaskId) return;
    setGeneratingTaskId(item.matrixItemId);
    setGenerationError(undefined);
    let idempotencyKey = idempotencyKeys.current.get(item.matrixItemId);
    if (!idempotencyKey) {
      idempotencyKey = `single-${item.matrixItemId}-${window.crypto.randomUUID()}`;
      idempotencyKeys.current.set(item.matrixItemId, idempotencyKey);
    }
    try {
      const response = await fetch(`/api/v5/content-tasks/${encodeURIComponent(item.matrixItemId)}/prepare-and-generate`, {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey }
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string; nextAction?: string } };
      if (!response.ok || !body.ok) {
        throw { message: body.error?.message || "正式正文生成失败。", nextAction: body.error?.nextAction || "处理失败原因后重新尝试。" };
      }
      await refresh();
      messageApi.success("正式正文已生成并写入 MySQL");
    } catch (error) {
      const detail = error && typeof error === "object" ? error as { message?: string; nextAction?: string } : {};
      setGenerationError({ taskId: item.matrixItemId, message: detail.message || "正式正文生成失败。", nextAction: detail.nextAction || "检查正式配置和证据状态后重试。" });
    } finally {
      setGeneratingTaskId(undefined);
    }
  }, [generatingTaskId, messageApi, refresh]);

  return (
    <>
      {messageContext}
      <PageHeader
        title="批量生成中心"
        titleExtra={<Tag color="blue">{workspace?.month || "读取中"}</Tag>}
        subtitle="当月正文生产操作台：标题确认、Final Evidence Gate、生成质检、异常分流和文章级人工排程。"
        actions={
          <Space wrap>
            <Button icon={<PauseOutlined />} disabled>暂停批次</Button>
            <Button icon={<SafetyCertificateOutlined />} disabled>批量确认标题与矩阵</Button>
            <Button type="primary" icon={<ThunderboltOutlined />} disabled>批量生成当月可生成内容</Button>
          </Space>
        }
      />

      {error ? (
        <Alert
          showIcon
          type="error"
          message="批量生成数据读取失败"
          description={error}
          action={<Button size="small" onClick={() => void refresh().catch(() => undefined)}>重新读取</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Alert
          showIcon
          type={workspace?.source.governanceData === "failed" ? "error" : workspace?.source.governanceData === "pending_config" ? "warning" : workspace?.source.monthlyData === "persisted" ? "warning" : "info"}
          message="只生成通过正式准入的矩阵项"
          description={
            workspace?.formal.message
              ? `${workspace.formal.message} 当前不会把 V4 派生状态或页面 mock 当作可生成许可。`
              : workspace?.source.monthlyData === "persisted"
              ? "当前队列来自 V5 持久化数据；批次只执行 ready 或自动安全降级后复检通过的项目，异常项保留原状态和原因并独立分流。"
              : "V5 接口已接通，但当前月份还没有真实矩阵与生成队列，不再回退展示页面 mock。"
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {loading && !workspace ? <div style={{ marginBottom: 16, textAlign: "center" }}><Spin /><span style={{ marginLeft: 8 }}>正在读取批量生成队列</span></div> : null}

      {generationError ? (
        <Alert
          showIcon
          type="error"
          message={generationError.message}
          description={`下一步：${generationError.nextAction}`}
          action={
            <Button
              size="small"
              onClick={() => {
                const item = batchQueueItems.find((candidate) => candidate.matrixItemId === generationError.taskId);
                idempotencyKeys.current.delete(generationError.taskId);
                if (item) void handleGenerate(item);
              }}
            >
              问题已处理，重新尝试
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <V5StatusRail
        items={[
          { label: "本次可生成", value: generatableCount, helper: "正式标题冻结且前置治理可检查", status: workspace?.source.productionQueue === "v5_mysql" ? "real" : "pending_config" },
          { label: "证据闸门拦截", value: evidenceBlockedCount, helper: "只拦截受影响矩阵项" },
          { label: "标题未确认", value: titlePendingCount, helper: "不可创建 Final Evidence Pack" },
          { label: "平台配置缺失", value: platformPendingCount, helper: "仅可草稿或人工接管" },
          { label: "预计进入异常", value: openExceptionCount, helper: "保留原因和治理入口" }
        ]}
      />

      <Tabs
        className="v5-production-tabs"
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: "tasks",
            label: `内容任务 ${batchQueueItems.length}`,
            children: <BatchGenerationMatrixTable items={batchQueueItems} generatingTaskId={generatingTaskId} onGenerate={(item) => void handleGenerate(item)} />
          },
          {
            key: "schedule",
            label: `人工排程 ${scheduleDraftItems.filter((item) => item.date).length}`,
            children: <div id="schedule"><ScheduleCalendarLite items={scheduleDraftItems} month={workspace?.month || ""} /></div>
          },
          {
            key: "exceptions",
            label: `异常处理 ${openExceptionCount}`,
            children: <div id="exceptions"><ExceptionQueuePreview items={exceptionItems} /></div>
          }
        ]}
      />
    </>
  );
}
