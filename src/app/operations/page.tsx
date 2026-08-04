"use client";

import { Alert, Button, Card, Descriptions, Space, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";

interface WorkerRecord { role: string; status: string; ageMs?: number; jobs?: Array<{ name: string; state: string; lastFinishedAt?: string; consecutiveFailures?: number }> }
interface HealthPayload {
  ok: boolean;
  status: string;
  profile: string;
  checkedAt: string;
  latencyMs: number;
  services: Record<string, { status: string; message?: string; provider?: string; model?: string; activeAliases?: Array<{ alias: string; index: string }>; workers?: WorkerRecord[] }>;
}

export default function OperationsPage() {
  const [health, setHealth] = useState<HealthPayload>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body = await response.json() as HealthPayload;
      setHealth(body);
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "健康状态读取失败。");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const workers = health?.services.workers.workers || [];
  return <>
    <PageHeader title="运行状态" subtitle="检查持久化依赖、检索链路和常驻 Worker；页面每 15 秒自动刷新。" actions={<Button onClick={() => void load()}>立即刷新</Button>} />
    {error ? <Alert type="error" showIcon message="健康状态读取失败" description={error} /> : null}
    {!health && !error ? <Spin /> : null}
    {health ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert type={health.ok ? "success" : "warning"} showIcon message={health.ok ? "生产链路正常" : "生产链路需要处理"} description={`${health.profile} profile · ${health.checkedAt} · ${health.latencyMs}ms`} />
      <Card title="基础设施" size="small">
        <Descriptions bordered size="small" column={1} items={Object.entries(health.services).filter(([name]) => name !== "workers").map(([name, service]) => ({
          key: name,
          label: name,
          children: <Space wrap><Tag color={service.status === "ready" ? "green" : "red"}>{service.status}</Tag>{service.provider ? <span>{service.provider} / {service.model}</span> : null}{service.message ? <Typography.Text type="danger">{service.message}</Typography.Text> : null}</Space>
        }))} />
      </Card>
      <Card title="常驻 Worker" size="small">
        <Table<WorkerRecord> rowKey="role" size="small" pagination={false} dataSource={workers} columns={[
          { title: "服务", dataIndex: "role" },
          { title: "心跳", dataIndex: "status", width: 120, render: (value) => <Tag color={value === "ready" ? "green" : "red"}>{value}</Tag> },
          { title: "心跳延迟", dataIndex: "ageMs", width: 120, render: (value?: number) => value === undefined ? "—" : `${Math.round(value / 1000)}s` },
          { title: "子任务", dataIndex: "jobs", render: (jobs: WorkerRecord["jobs"]) => <Space wrap>{(jobs || []).map((job) => <Tag key={job.name} color={job.state === "failed" ? "red" : job.state === "pending_config" ? "gold" : "blue"}>{job.name}: {job.state}</Tag>)}</Space> }
        ]} />
      </Card>
      <Card title="当前激活索引" size="small">
        <Table rowKey={(record) => `${record.alias}:${record.index}`} size="small" pagination={false} dataSource={health.services.opensearch.activeAliases || []} columns={[{ title: "Alias", dataIndex: "alias" }, { title: "Index", dataIndex: "index" }]} />
      </Card>
    </Space> : null}
  </>;
}
