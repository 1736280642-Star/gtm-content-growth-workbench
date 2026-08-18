"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, Modal, Segmented, Select, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type { SiteAuditFinding, SiteAuditWorkspace } from "@/lib/v5/site-audit-contracts";
import type { V5ObservationApiEnvelope } from "@/lib/v5/observation-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import { SiteAuditFindingDrawer } from "./SiteAuditFindingDrawer";

function mutationContext(expectedVersion: number, reason: string) {
  return { actor: WORKSPACE_ACTOR, reason, expectedVersion, idempotencyKey: `site-audit-${Date.now()}-${Math.random().toString(36).slice(2)}` };
}

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = (await response.json()) as V5ObservationApiEnvelope<T>;
  if (!response.ok || !body.ok) throw new Error(body.ok ? `请求失败（HTTP ${response.status}）` : body.error.message);
  return body.data;
}

export function SiteAuditPanel({ products = [] }: { products?: ProductRegistryItem[] }) {
  const [workspace, setWorkspace] = useState<SiteAuditWorkspace>();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<SiteAuditFinding>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ productId?: string; scopeUrl: string; sitemapUrl?: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setWorkspace(await request<SiteAuditWorkspace>("/api/v5/site-audits")); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "官网审计读取失败"); }
    finally { setLoading(false); }
  }, [messageApi]);
  useEffect(() => { refresh(); }, [refresh]);
  const latest = workspace?.runs[0];
  const latestCompleted = workspace?.runs.find((item) => item.status === "completed");
  const findings = useMemo(() => (workspace?.findings || [])
    .filter((item) => !latestCompleted || item.runId === latestCompleted.id)
    .filter((item) => filter === "all" || item.category === filter || (filter === "remediation" && item.status !== "open")), [filter, latestCompleted, workspace?.findings]);
  const latestDiff = workspace?.diffs.find((item) => item.comparisonRunId === latestCompleted?.id);

  async function createRun() {
    const value = await form.validateFields();
    setBusy(true);
    try {
      await request("/api/v5/site-audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, ...mutationContext(0, "人工创建官网审计批次") }) });
      setCreateOpen(false); form.resetFields(); await refresh(); messageApi.success("官网审计已进入真实 Runner 队列");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "审计批次创建失败"); }
    finally { setBusy(false); }
  }

  async function mutateFinding(finding: SiteAuditFinding, action: "remediation" | "resolved" | "ignored", note: string) {
    if (!note.trim()) { messageApi.warning("请先填写处理说明"); return; }
    setBusy(true);
    try {
      const path = action === "remediation" ? `/api/v5/site-audit-findings/${finding.id}/remediation` : `/api/v5/site-audit-findings/${finding.id}/review`;
      const payload = action === "remediation" ? { note, ...mutationContext(finding.version, "人工创建官网整改任务") } : { decision: action, note, ...mutationContext(finding.version, "人工复审官网审计问题") };
      await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setSelected(undefined); await refresh(); messageApi.success(action === "remediation" ? "整改任务已创建" : "复审结果已保存");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="site-audit-panel">
      {contextHolder}
      <div className="site-audit-toolbar"><div><h2>官网监控 <Tag>独立主线</Tag></h2><p>确定性检查抓取、Schema、内容和可引用性；与问题监控平行，在 MonthlyReview 汇合。</p></div><Space><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>开始审计</Button></Space></div>
      {latest?.status === "pending_config" ? <Alert showIcon type="warning" message="官网审计 Runner 待配置" description={latest.failureReason} /> : null}
      {latest && ["queued", "running"].includes(latest.status) ? <Alert showIcon type="info" message={`真实官网审计${latest.status === "queued" ? "已排队" : "执行中"}`} description="Runner 会保存页面证据哈希、规则版本和确定性问题；刷新可查看进度。" /> : null}
      <div className="site-audit-status-strip"><span>技术准备度 <strong>{latestCompleted?.technicalReadinessScore?.toFixed(1) || "—"}</strong></span><span>内容可引用性 <strong>{latestCompleted?.contentCitabilityScore?.toFixed(1) || "—"}</strong></span><span>平台合规准备度 <strong>{latestCompleted?.platformComplianceScore?.toFixed(1) || "—"}</strong></span><span>最近审计 <strong>{latest ? new Date(latest.createdAt).toLocaleDateString("zh-CN") : "暂无"}</strong></span><span>已审计 <strong>{latestCompleted?.auditedUrlCount || 0}</strong></span><span>失败 <strong>{latestCompleted?.failedUrlCount || 0}</strong></span><span>新增 <strong>{latestDiff?.newFindingIds.length || 0}</strong></span><span>已解决 <strong>{latestDiff?.resolvedFindingIds.length || 0}</strong></span></div>
      {workspace?.experimentalSignals.length ? <Alert showIcon type="info" message="实验信号（不计入核心准备度）" description={<Space wrap>{workspace.experimentalSignals.map((item) => <Tag key={item.code} color={item.status === "present" ? "green" : item.status === "missing" ? "default" : "gold"}>{item.code}：{item.status}</Tag>)}</Space>} /> : null}
      <Card size="small">
        <Segmented className="site-audit-filter" value={filter} onChange={(value) => setFilter(String(value))} options={[{ value: "all", label: "全部" }, { value: "technical", label: "技术" }, { value: "schema", label: "Schema" }, { value: "content", label: "内容" }, { value: "citability", label: "可引用性" }, { value: "compliance", label: "平台合规" }, { value: "remediation", label: "整改任务" }]} />
        {findings.length ? <Table rowKey="id" size="small" scroll={{ x: 860 }} style={{ marginTop: 16 }} pagination={{ pageSize: 10 }} dataSource={findings} columns={[
          { title: "严重度", dataIndex: "severity", width: 90, render: (value) => <Tag color={value === "critical" ? "red" : value === "high" ? "orange" : "blue"}>{value}</Tag> },
          { title: "页面 / 问题", render: (_, row) => <div className="v5-table-stack"><strong>{row.title}</strong><span>{row.url}</span></div> },
          { title: "类型", dataIndex: "category", width: 110 },
          { title: "状态", dataIndex: "status", width: 140 },
          { title: "操作", width: 90, render: (_, row) => <Button type="link" size="small" onClick={() => setSelected(row)}>查看</Button> }
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实官网审计结果；未配置 Runner 时不会填充模拟问题。" />}
      </Card>
      <Modal title="创建官网审计批次" open={createOpen} okText="进入真实审计队列" cancelText="取消" confirmLoading={busy} onOk={createRun} onCancel={() => setCreateOpen(false)}><Form form={form} layout="vertical"><Form.Item label="官网范围" name="scopeUrl" rules={[{ required: true }, { type: "url" }]}><Input placeholder="https://www.example.com" onBlur={(event) => {
        const host = (value?: string) => { try { return new URL(value || "").hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
        const matched = products.find((item) => host(item.officialUrl) && host(item.officialUrl) === host(event.target.value));
        if (matched && !form.getFieldValue("productId")) form.setFieldValue("productId", matched.productId);
      }} /></Form.Item><Form.Item label="关联产品（可选）" name="productId" tooltip="URL 与正式产品官网一致时系统会自动关联；关联后才能在 MonthlyReview 做同产品汇合。"><Select allowClear showSearch optionFilterProp="label" options={products.map((item) => ({ label: item.displayName, value: item.productId }))} /></Form.Item><Form.Item label="Sitemap（可选，系统会自动发现）" name="sitemapUrl" rules={[{ type: "url" }]}><Input placeholder="https://www.example.com/sitemap.xml" /></Form.Item></Form><Alert showIcon type="info" message="官网监控不会生成或改写问题集" description="核心准备度只包含确定性信号；llms.txt 等实验性约定单独展示，不计入核心分。" /></Modal>
      <SiteAuditFindingDrawer finding={selected} open={Boolean(selected)} busy={busy} onClose={() => setSelected(undefined)} onCreateRemediation={(finding, note) => mutateFinding(finding, "remediation", note)} onReview={(finding, decision, note) => mutateFinding(finding, decision, note)} />
    </div>
  );
}
