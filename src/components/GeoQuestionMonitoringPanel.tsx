"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeoMonitoringQuestion, GeoMonitoringRecommendation, GeoMonitoringWorkspace, GeoQuestionMetric } from "@/lib/v5/geo-monitoring-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import { MAX_MONITORING_QUESTIONS_PER_BATCH, parseMonitoringQuestions } from "@/lib/geo-monitoring-input";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";

const platformOptions = [
  { label: "豆包", value: "doubao" }, { label: "DeepSeek", value: "deepseek" },
  { label: "千问", value: "qwen" }, { label: "ChatGPT", value: "chatgpt" }
];
const percent = (value: number | null) => value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`;
const mutation = (expectedVersion: number, reason: string) => ({ actor: WORKSPACE_ACTOR, reason, expectedVersion, idempotencyKey: `geo-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}` });

async function api<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !body.ok) throw new Error(body.error?.message || `请求失败（HTTP ${response.status}）`);
  return body.data as T;
}

export function GeoQuestionMonitoringPanel({ month, products }: { month: string; products: ProductRegistryItem[] }) {
  const [workspace, setWorkspace] = useState<GeoMonitoringWorkspace>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [recommendationDraft, setRecommendationDraft] = useState<GeoMonitoringRecommendation>();
  const [form] = Form.useForm();
  const questionDraft = Form.useWatch("questionText", form) || "";
  const questionDraftCount = parseMonitoringQuestions(questionDraft).length;
  const [messageApi, contextHolder] = message.useMessage();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setWorkspace(await api<GeoMonitoringWorkspace>(`/api/v5/geo-monitoring-questions?month=${month}`)); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "问题监控读取失败"); }
    finally { setLoading(false); }
  }, [messageApi, month]);
  useEffect(() => { void refresh(); }, [refresh]);
  const metrics = useMemo(() => new Map((workspace?.metrics || []).map((item) => [item.monitoringQuestionId, item])), [workspace?.metrics]);

  async function create(payload: Record<string, unknown>, questionTexts: string[]) {
    setBusy(true);
    const failures: Array<{ questionText: string; message: string }> = [];
    let createdCount = 0;
    try {
      for (let start = 0; start < questionTexts.length; start += 3) {
        const batch = questionTexts.slice(start, start + 3);
        const results = await Promise.allSettled(batch.map((questionText) => api("/api/v5/geo-monitoring-questions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, questionText, ...mutation(0, "人工确认问题进入独立 GEO 监控集") })
        })));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") createdCount += 1;
          else failures.push({ questionText: batch[index], message: result.reason instanceof Error ? result.reason.message : "创建失败" });
        });
      }
      await refresh();
      if (failures.length) {
        form.setFieldValue("questionText", failures.map((item) => item.questionText).join("\n"));
        messageApi.warning(`已启用 ${createdCount} 个问题，${failures.length} 个失败；失败项已保留。${failures[0]?.message ? ` ${failures[0].message}` : ""}`);
        return;
      }
      setManualOpen(false); setRecommendOpen(false); setRecommendationDraft(undefined); form.resetFields();
      messageApi.success(`已启用 ${createdCount} 个监控问题，并创建本月采集样本`);
    } finally { setBusy(false); }
  }

  async function createManual() {
    const value = await form.validateFields();
    const questionTexts = parseMonitoringQuestions(String(value.questionText || ""));
    const recommendationUnchanged = Boolean(recommendationDraft && questionTexts.length === 1 && questionTexts[0] === recommendationDraft.questionText);
    await create({
      productId: value.productId,
      platforms: value.platforms,
      locale: "zh-CN",
      region: "CN",
      selectionSource: recommendationUnchanged ? recommendationDraft?.source : "manual",
      questionVersionId: recommendationUnchanged ? recommendationDraft?.questionVersionId : undefined,
      strategyPackId: recommendationUnchanged ? recommendationDraft?.strategyPackId : undefined,
      ownedDomains: String(value.ownedDomains || "").split(/[,，\s]+/).filter(Boolean)
    }, questionTexts);
  }

  function importRecommendation(item: GeoMonitoringRecommendation) {
    const product = products.find((candidate) => candidate.productId === item.productId);
    setRecommendationDraft(item);
    form.setFieldsValue({
      productId: item.productId,
      questionText: item.questionText,
      ownedDomains: product?.officialUrl || "",
      platforms: ["doubao", "deepseek", "qwen", "chatgpt"],
      locale: "zh-CN",
      region: "CN"
    });
    setRecommendOpen(false);
    setManualOpen(true);
  }

  async function update(item: GeoMonitoringQuestion, status: "active" | "paused" | "archived") {
    setBusy(true);
    try {
      await api(`/api/v5/geo-monitoring-questions/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, ...mutation(item.rowVersion, `人工将监控问题调整为 ${status}`) }) });
      await refresh(); messageApi.success("监控状态已更新");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "状态更新失败"); }
    finally { setBusy(false); }
  }

  const renderMetric = (metric: GeoQuestionMetric | undefined) => metric ? (
    <Space size={4} wrap>
      <Tag title={metric.brandMentionConfidence95 ? `95% 区间 ${(metric.brandMentionConfidence95.lower * 100).toFixed(1)}%–${(metric.brandMentionConfidence95.upper * 100).toFixed(1)}%` : undefined}>提及 {percent(metric.brandMentionRate)}</Tag>
      <Tag title={metric.ownedCitationConfidence95 ? `95% 区间 ${(metric.ownedCitationConfidence95.lower * 100).toFixed(1)}%–${(metric.ownedCitationConfidence95.upper * 100).toFixed(1)}%` : undefined}>官网引用 {percent(metric.ownedCitationRate)}</Tag>
      <Tag>引用份额 {percent(metric.citationShareOfVoice)}</Tag>
      <Tag>中位排名 {metric.medianCitationRank === null ? "样本不足" : metric.medianCitationRank.toFixed(1)}</Tag>
      <Tag color={metric.answerFailureRate && metric.answerFailureRate > 0 ? "red" : "default"}>失败 {percent(metric.answerFailureRate)}</Tag>
      <Tag color={metric.sampleStatus === "reliable" ? "green" : metric.sampleStatus === "directional" ? "blue" : "gold"}>{metric.successfulRuns} 次 · {metric.sampleStatus === "reliable" ? "可用于稳定判断" : metric.sampleStatus === "directional" ? "仅方向性" : "样本不足"}</Tag>
      {!metric.platformCoverageComplete && metric.successfulRuns >= 3 ? <Tag color="gold">平台覆盖未齐</Tag> : null}
    </Space>
  ) : <Tag color="gold">尚无样本</Tag>;

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    {contextHolder}
    {workspace?.source === "pending_config" ? <Alert showIcon type="warning" message="问题监控待配置" description={workspace.message} /> : null}
    <Card title="问题监控" extra={<Space><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button><Button onClick={() => setRecommendOpen(true)}>策略推荐</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { setRecommendationDraft(undefined); form.resetFields(); setManualOpen(true); }}>手动添加</Button></Space>}>
      <Alert showIcon type="info" message="与官网监控平行运行" description="问题来自 GEO 策略推荐或用户手动设置；官网审计不会自动改写监控问题集。核心率值仅由真实 AI 前台采集证据计算。" style={{ marginBottom: 16 }} />
      <Table rowKey="id" loading={loading} dataSource={workspace?.questions || []} pagination={{ pageSize: 12 }} locale={{ emptyText: <Empty description="还没有启用监控问题" /> }} expandable={{ expandedRowRender: (row) => {
        const metric = metrics.get(row.id);
        return metric?.platformBreakdown.length ? <Space wrap>{metric.platformBreakdown.map((item) => <Tag key={item.platform}>{item.platform}：{item.successfulRuns} 次，提及 {percent(item.brandMentionRate)}，官网引用 {percent(item.ownedCitationRate)}</Tag>)}</Space> : <span>尚无平台级真实样本</span>;
      } }} columns={[
        { title: "问题", render: (_, row) => <div><strong>{row.questionText}</strong><div><Tag>{row.selectionSource}</Tag><Tag>{row.platforms.length} 个平台</Tag></div></div> },
        { title: "本月真实结果", render: (_, row) => renderMetric(metrics.get(row.id)) },
        { title: "状态", dataIndex: "status", width: 90, render: (value) => <Tag color={value === "active" ? "green" : "default"}>{value}</Tag> },
        { title: "操作", width: 120, render: (_, row) => row.status === "active" ? <Button type="link" disabled={busy} onClick={() => update(row, "paused")}>暂停</Button> : row.status === "paused" ? <Button type="link" disabled={busy} onClick={() => update(row, "active")}>启用</Button> : null }
      ]} />
    </Card>
    <Modal title={recommendationDraft ? "确认推荐问题与监控口径" : "手动添加监控问题"} open={manualOpen} confirmLoading={busy} onOk={createManual} onCancel={() => { setManualOpen(false); setRecommendationDraft(undefined); form.resetFields(); }} okText={questionDraftCount > 1 ? `启用 ${questionDraftCount} 个问题` : "启用监控"}>
      <Form form={form} layout="vertical" initialValues={{ platforms: ["doubao", "deepseek", "qwen"], locale: "zh-CN", region: "CN" }}>
        <Form.Item name="productId" label="产品" rules={[{ required: true }]}><Select options={products.map((item) => ({ label: item.displayName, value: item.productId }))} /></Form.Item>
        <Form.Item name="questionText" label="监控问题（可批量粘贴）" extra={`一行一个问题，重复问题会自动去除，单次最多 ${MAX_MONITORING_QUESTIONS_PER_BATCH} 个。`} rules={[{ validator: (_, value) => {
          const questions = parseMonitoringQuestions(String(value || ""));
          if (!questions.length) return Promise.reject(new Error("请至少输入一个监控问题"));
          if (questions.length > MAX_MONITORING_QUESTIONS_PER_BATCH) return Promise.reject(new Error(`单次最多添加 ${MAX_MONITORING_QUESTIONS_PER_BATCH} 个问题`));
          if (questions.some((item) => item.length < 4)) return Promise.reject(new Error("每个问题至少需要 4 个字符"));
          if (questions.some((item) => item.length > 500)) return Promise.reject(new Error("单个问题不能超过 500 个字符"));
          return Promise.resolve();
        } }]}><Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} placeholder="一行输入一个问题，可直接粘贴多行" /></Form.Item>
        <Form.Item name="ownedDomains" label="自有域名（选填）" tooltip="用于判定官网引用率；多个域名用逗号分隔" extra="不填时优先使用产品已登记官网；没有官网时不计算官网引用率。"><Input placeholder="example.com" /></Form.Item>
        <Form.Item name="platforms" label="平台" rules={[{ required: true }]}><Select mode="multiple" options={platformOptions} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="GEO 策略与调研推荐" width={820} open={recommendOpen} footer={null} onCancel={() => setRecommendOpen(false)}>
      <Table rowKey={(row) => `${row.productId}:${row.questionText}:${row.source}`} size="small" dataSource={workspace?.recommendations || []} pagination={{ pageSize: 8 }} columns={[
        { title: "问题", dataIndex: "questionText" }, { title: "来源", dataIndex: "source", width: 190, render: (value) => <Tag>{value}</Tag> },
        { title: "操作", width: 100, render: (_, row) => <Button type="link" disabled={row.alreadyConfigured || busy} onClick={() => importRecommendation(row)}>{row.alreadyConfigured ? "已监控" : "加入"}</Button> }
      ]} />
    </Modal>
  </Space>;
}
