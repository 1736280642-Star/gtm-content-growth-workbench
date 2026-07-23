"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, Modal, Segmented, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceRole } from "@/lib/types";
import type { SiteAuditFinding, SiteAuditWorkspace } from "@/lib/v5/site-audit-contracts";
import type { V5ObservationApiEnvelope } from "@/lib/v5/observation-contracts";
import { SiteAuditFindingDrawer } from "./SiteAuditFindingDrawer";

function mutationContext(role: WorkspaceRole, expectedVersion: number, reason: string) {
  const actorRole = role === "content_growth" || role === "workbench_operator" || role === "knowledge_manager" || role === "developer_admin" ? role : "workbench_operator";
  return { actor: { actorId: `local-${actorRole}`, actorRole, actorType: "human" }, reason, expectedVersion, idempotencyKey: `site-audit-${Date.now()}-${Math.random().toString(36).slice(2)}` };
}

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = (await response.json()) as V5ObservationApiEnvelope<T>;
  if (!response.ok || !body.ok) throw new Error(body.ok ? `请求失败（HTTP ${response.status}）` : body.error.message);
  return body.data;
}

export function SiteAuditPanel({ role }: { role: WorkspaceRole }) {
  const [workspace, setWorkspace] = useState<SiteAuditWorkspace>();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<SiteAuditFinding>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ scopeUrl: string; sitemapUrl?: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setWorkspace(await request<SiteAuditWorkspace>("/api/v5/site-audits")); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "官网审计读取失败"); }
    finally { setLoading(false); }
  }, [messageApi]);
  useEffect(() => { refresh(); }, [refresh]);
  const findings = useMemo(() => (workspace?.findings || []).filter((item) => filter === "all" || item.category === filter || (filter === "remediation" && item.status !== "open")), [filter, workspace?.findings]);
  const latest = workspace?.runs[0];

  async function createRun() {
    const value = await form.validateFields();
    setBusy(true);
    try {
      await request("/api/v5/site-audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, ...mutationContext(role, 0, "人工创建官网审计批次") }) });
      setCreateOpen(false); form.resetFields(); await refresh(); messageApi.success("审计范围已保存；Runner 未配置时不会生成假问题");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "审计批次创建失败"); }
    finally { setBusy(false); }
  }

  async function mutateFinding(finding: SiteAuditFinding, action: "remediation" | "resolved" | "ignored", note: string) {
    if (!note.trim()) { messageApi.warning("请先填写处理说明"); return; }
    setBusy(true);
    try {
      const path = action === "remediation" ? `/api/v5/site-audit-findings/${finding.id}/remediation` : `/api/v5/site-audit-findings/${finding.id}/review`;
      const payload = action === "remediation" ? { note, ...mutationContext(role, finding.version, "人工创建官网整改任务") } : { decision: action, note, ...mutationContext(role, finding.version, "人工复审官网审计问题") };
      await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setSelected(undefined); await refresh(); messageApi.success(action === "remediation" ? "整改任务已创建" : "复审结果已保存");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="site-audit-panel">
      {contextHolder}
      <div className="site-audit-toolbar"><div><h2>官网审计 <Tag>P1</Tag></h2><p>独立检查技术、Schema、内容和可引用性；不与 AI 前台测试合并状态或总分。</p></div><Space><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>开始复审</Button></Space></div>
      {latest?.status === "pending_config" ? <Alert showIcon type="warning" message="官网审计 Runner 待配置" description={latest.failureReason} /> : null}
      <div className="site-audit-status-strip"><span>最近审计 <strong>{latest ? new Date(latest.createdAt).toLocaleDateString("zh-CN") : "暂无"}</strong></span><span>已审计 <strong>{latest?.auditedUrlCount || 0}</strong></span><span>失败 <strong>{latest?.failedUrlCount || 0}</strong></span><span>严重 <strong>{workspace?.findings.filter((item) => item.severity === "critical").length || 0}</strong></span><span>待复审 <strong>{workspace?.findings.filter((item) => item.status === "pending_review").length || 0}</strong></span></div>
      <Card size="small">
        <Segmented className="site-audit-filter" value={filter} onChange={(value) => setFilter(String(value))} options={[{ value: "all", label: "全部" }, { value: "technical", label: "技术" }, { value: "schema", label: "Schema" }, { value: "content", label: "内容" }, { value: "citability", label: "可引用性" }, { value: "remediation", label: "整改任务" }]} />
        {findings.length ? <Table rowKey="id" size="small" scroll={{ x: 860 }} style={{ marginTop: 16 }} pagination={{ pageSize: 10 }} dataSource={findings} columns={[
          { title: "严重度", dataIndex: "severity", width: 90, render: (value) => <Tag color={value === "critical" ? "red" : value === "high" ? "orange" : "blue"}>{value}</Tag> },
          { title: "页面 / 问题", render: (_, row) => <div className="v5-table-stack"><strong>{row.title}</strong><span>{row.url}</span></div> },
          { title: "类型", dataIndex: "category", width: 110 },
          { title: "状态", dataIndex: "status", width: 140 },
          { title: "操作", width: 90, render: (_, row) => <Button type="link" size="small" onClick={() => setSelected(row)}>查看</Button> }
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实官网审计结果；未配置 Runner 时不会填充模拟问题。" />}
      </Card>
      <Modal title="创建官网审计批次" open={createOpen} okText="保存并等待审计" cancelText="取消" confirmLoading={busy} onOk={createRun} onCancel={() => setCreateOpen(false)}><Form form={form} layout="vertical"><Form.Item label="官网范围" name="scopeUrl" rules={[{ required: true }, { type: "url" }]}><Input placeholder="https://www.example.com" /></Form.Item><Form.Item label="Sitemap" name="sitemapUrl" rules={[{ type: "url" }]}><Input placeholder="https://www.example.com/sitemap.xml" /></Form.Item></Form><Alert showIcon type="info" message="只保存官网审计对象" description="不会建立独立导航、独立规划周期或 AI/SEO 综合总分。" /></Modal>
      <SiteAuditFindingDrawer finding={selected} open={Boolean(selected)} busy={busy} onClose={() => setSelected(undefined)} onCreateRemediation={(finding, note) => mutateFinding(finding, "remediation", note)} onReview={(finding, decision, note) => mutateFinding(finding, decision, note)} />
    </div>
  );
}
