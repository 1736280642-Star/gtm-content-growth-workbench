"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tabs, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FreeProductionTaskTable } from "@/components/free-production/FreeProductionTaskTable";
import { PageHeader } from "@/components/PageHeader";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<FreeProductionBatch[]>("/api/v5/free-production/batches");
      setBatches(data);
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

  const failedCount = batches.filter((batch) => ["generation_failed", "publish_failed"].includes(batch.status)).length;
  return (
    <>
      {contextHolder}
      <PageHeader title="公众号生产任务与发布" subtitle="查看公众号单篇正文的生成与发布状态；失败恢复不会改动已经成功的结果。" actions={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Link href="/free-production"><Button type="primary" icon={<PlusOutlined />}>选择表达</Button></Link></Space>} />
      {failedCount ? <Alert className="free-task-alert" showIcon type="warning" message={`${failedCount} 个批次需要处理`} description="打开批次查看失败原因和下一步，重试只作用于失败任务。" /> : null}
      <Tabs className="free-production-tabs" activeKey="tasks" items={[
        { key: "expressions", label: <Link href="/free-production">表达预设</Link>, children: null },
        { key: "tasks", label: <Link href="/free-production/tasks">任务与发布</Link>, children: <FreeProductionTaskTable data={batches} loading={loading} onPreview={(batch) => router.push(`/free-production?batch=${encodeURIComponent(batch.id)}`)} onRetry={(batch) => void retry(batch)} /> }
      ]} />
    </>
  );
}
