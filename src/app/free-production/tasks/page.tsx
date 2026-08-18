"use client";

import { ArrowLeftOutlined, CheckSquareOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Space, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FreeProductionTaskTable } from "@/components/free-production/FreeProductionTaskTable";
import { PageHeader } from "@/components/PageHeader";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import { currentFreeProductionArtifact, hasRequiredFreeProductionAssets } from "@/lib/v5/free-production-presentation";

function key(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string; nextAction?: string; details?: string[] } };
  if (!response.ok || !body.ok) throw new Error(`${body.error?.message || "请求失败。"}${body.error?.details?.length ? ` ${body.error.details.join("；")}` : ""}${body.error?.nextAction ? ` ${body.error.nextAction}` : ""}`);
  return body.data as T;
}

export default function FreeProductionTasksPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const router = useRouter();
  const [batches, setBatches] = useState<FreeProductionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<"delete" | "publish">();
  const [workingAction, setWorkingAction] = useState<"delete" | "publish">();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<FreeProductionBatch[]>("/api/v5/free-production/batches");
      setBatches(data);
      const currentIds = new Set(data.map((batch) => batch.id));
      setSelectedIds((ids) => ids.filter((id) => currentIds.has(id)));
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "任务列表读取失败。"); }
    finally { setLoading(false); }
  }, [messageApi]);
  useEffect(() => { void load(); }, [load]);

  async function retry(batch: FreeProductionBatch) {
    try {
      await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/retry-failures`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("retry-free-production") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "人工重试公众号生产失败任务" }) });
      messageApi.success("失败任务已进入安全重试，已生成的成功结果保持不变。");
      await load();
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "失败任务重试失败。"); }
  }

  const selectedBatches = useMemo(() => {
    const selected = new Set(selectedIds);
    return batches.filter((batch) => selected.has(batch.id));
  }, [batches, selectedIds]);
  const publishableBatches = useMemo(() => selectedBatches.filter((batch) =>
    hasRequiredFreeProductionAssets(batch)
    && Boolean(currentFreeProductionArtifact(batch))
    && ["ready_for_confirmation", "publish_failed"].includes(batch.status)
  ), [selectedBatches]);
  const missingCoverCount = selectedBatches.filter((batch) => !hasRequiredFreeProductionAssets(batch)).length;

  function toggleSelectionMode() {
    if (selectionMode) setSelectedIds([]);
    setSelectionMode(!selectionMode);
  }

  async function deleteSelected() {
    if (!selectedBatches.length) return;
    setWorkingAction("delete");
    try {
      const result = await request<{ deletedIds: string[] }>("/api/v5/free-production/batches", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-idempotency-key": key("delete-free-production") },
        body: JSON.stringify({
          auditReason: "从公众号文章列表批量删除未发布文章",
          items: selectedBatches.map((batch) => ({ id: batch.id, expectedVersion: batch.version }))
        })
      });
      messageApi.success(`已删除 ${result.deletedIds.length} 篇文章。`);
      setSelectedIds([]);
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "批量删除失败。");
    } finally {
      setWorkingAction(undefined);
      setConfirmAction(undefined);
    }
  }

  async function publishSelected() {
    if (!publishableBatches.length) return;
    setWorkingAction("publish");
    const failures: string[] = [];
    let accepted = 0;
    let draftCreated = 0;
    for (const batch of publishableBatches) {
      const artifact = currentFreeProductionArtifact(batch);
      if (!artifact) continue;
      try {
        const result = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/confirm-and-publish`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-idempotency-key": key("confirm-publish-list") },
          body: JSON.stringify({ expectedVersion: batch.version, auditReason: "从公众号文章列表批量确认并发布", contentDigest: artifact.contentDigest })
        });
        accepted += 1;
        if (result.status === "draft_created") draftCreated += 1;
      } catch (error) {
        failures.push(`${artifact.selectedTitle}：${error instanceof Error ? error.message : "发布失败"}`);
      }
    }
    if (accepted) messageApi.success(draftCreated === accepted ? `${accepted} 篇文章已写入公众号草稿箱。` : `${accepted} 篇文章已进入渠道处理流程。`);
    if (failures.length) messageApi.warning({ content: `${failures.length} 篇未能发布：${failures.join("；")}`, duration: 8 });
    setSelectedIds([]);
    setWorkingAction(undefined);
    setConfirmAction(undefined);
    await load();
  }

  const failedCount = batches.filter((batch) => ["generation_failed", "publish_failed"].includes(batch.status)).length;
  return (
    <>
      {contextHolder}
      <PageHeader title="微信公众号内容生产 · 任务与发布" subtitle="查看公众号单篇正文的生成与发布状态；失败恢复不会改动已经成功的结果。" actions={<Space wrap><Link href="/free-production"><Button icon={<ArrowLeftOutlined />}>返回内容生产</Button></Link><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type={selectionMode ? "primary" : "default"} ghost={selectionMode} icon={<CheckSquareOutlined />} onClick={toggleSelectionMode}>{selectionMode ? "取消选择" : "选择"}</Button><Link href="/free-production"><Button type="primary" icon={<PlusOutlined />}>选择文章类型</Button></Link></Space>} />
      {failedCount ? <Alert className="free-task-alert" showIcon type="warning" message={`${failedCount} 个批次需要处理`} description="打开批次查看失败原因和下一步，重试只作用于失败任务。" /> : null}
      {selectionMode ? <section className="free-task-selection-bar" aria-live="polite">
        <div className="free-task-selection-summary">
          <strong>已选 {selectedBatches.length} 篇</strong>
          <span>{publishableBatches.length} 篇可发布{missingCoverCount ? `，${missingCoverCount} 篇待配封面` : ""}</span>
        </div>
        <Space wrap>
          <Button danger icon={<DeleteOutlined />} disabled={!selectedBatches.length} onClick={() => setConfirmAction("delete")}>删除</Button>
          <Button type="primary" icon={<SendOutlined />} disabled={!publishableBatches.length} onClick={() => setConfirmAction("publish")}>发送到草稿箱{publishableBatches.length ? `（${publishableBatches.length}）` : ""}</Button>
        </Space>
      </section> : null}
      <FreeProductionTaskTable data={batches} loading={loading} selectionMode={selectionMode} selectedRowKeys={selectedIds} onSelectionChange={setSelectedIds} onPreview={(batch) => router.push(`/free-production?batch=${encodeURIComponent(batch.id)}`)} onRetry={(batch) => void retry(batch)} />
      <Modal
        open={Boolean(confirmAction)}
        title={confirmAction === "delete" ? `删除 ${selectedBatches.length} 篇文章？` : `确认发送 ${publishableBatches.length} 篇文章到草稿箱？`}
        okText={confirmAction === "delete" ? "确认删除" : "确认发送"}
        cancelText="取消"
        okButtonProps={{ danger: confirmAction === "delete", loading: Boolean(workingAction) }}
        cancelButtonProps={{ disabled: Boolean(workingAction) }}
        closable={!workingAction}
        maskClosable={!workingAction}
        onCancel={() => setConfirmAction(undefined)}
        onOk={() => void (confirmAction === "delete" ? deleteSelected() : publishSelected())}
      >
        {confirmAction === "delete"
          ? <p>删除后将从当前列表移除，且无法在工作台恢复。正在发布或已发布的文章不会进入可选范围。</p>
          : <p>系统只会把已配封面且正文通过检查的公众号文章写入草稿箱，不会调用正式发布接口。{selectedBatches.length > publishableBatches.length ? `另外 ${selectedBatches.length - publishableBatches.length} 篇不满足条件，不会发送。` : ""}</p>}
      </Modal>
    </>
  );
}
