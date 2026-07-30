"use client";

import { PlusOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Spin, Tabs, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateExpressionDrawer } from "@/components/free-production/CreateExpressionDrawer";
import { ExpressionPresetList } from "@/components/free-production/ExpressionPresetList";
import { GenerationResultWorkspace } from "@/components/free-production/GenerationResultWorkspace";
import { ProductionInputPanel } from "@/components/free-production/ProductionInputPanel";
import type { SupplementValue } from "@/components/free-production/InlineSupplementField";
import { PageHeader } from "@/components/PageHeader";
import type { CreateFreeExpressionInput, CreateFreeProductionInput, FreeContentExpressionTypeSummary, FreeProductionBatch, FreeProductionCatalog } from "@/lib/v5/free-production-contracts";

function key(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string; nextAction?: string; details?: string[] } };
  if (!response.ok || !body.ok) throw new Error(`${body.error?.message || "请求失败。"}${body.error?.details?.length ? ` ${body.error.details.join("；")}` : ""}${body.error?.nextAction ? ` ${body.error.nextAction}` : ""}`);
  return body.data as T;
}

export default function FreeProductionPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [catalog, setCatalog] = useState<FreeProductionCatalog>();
  const [batch, setBatch] = useState<FreeProductionBatch>();
  const [loading, setLoading] = useState(true);
  const [usingId, setUsingId] = useState<string>();
  const [selectedType, setSelectedType] = useState<FreeContentExpressionTypeSummary>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savingExpression, setSavingExpression] = useState(false);
  const [working, setWorking] = useState<"supplements" | "review-sources" | "publish" | "retry">();

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try { setCatalog(await request<FreeProductionCatalog>("/api/v5/free-production/catalog")); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "表达预设读取失败。"); }
    finally { setLoading(false); }
  }, [messageApi]);

  useEffect(() => {
    void loadCatalog();
    const batchId = new URLSearchParams(window.location.search).get("batch");
    if (batchId) void request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batchId)}`).then(setBatch).catch((error) => messageApi.error(error instanceof Error ? error.message : "正文结果读取失败。"));
  }, [loadCatalog, messageApi]);

  async function generateFromExpression(profile: FreeContentExpressionTypeSummary, values: Pick<CreateFreeProductionInput, "productId" | "knowledgeSnapshotIds" | "expressionFocus" | "factItems" | "meetingText">) {
    const versionId = profile.activeVersion!.freeContentExpressionTypeVersionId;
    setUsingId(versionId);
    try {
      const data = await request<FreeProductionBatch>("/api/v5/free-production/batches/from-expression", { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("from-type") }, body: JSON.stringify({ expectedVersion: 0, auditReason: "选择内容类型和资料并生成单篇正文", expressionTypeVersionId: versionId, ...values }) });
      setBatch(data);
      window.history.replaceState(null, "", `/free-production?batch=${encodeURIComponent(data.id)}`);
      if (data.status === "generation_failed") messageApi.error(`${data.failureMessage || "正文生成失败。"} ${data.nextAction || ""}`);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "使用表达生成正文失败。"); }
    finally { setUsingId(undefined); }
  }

  async function createExpression(input: CreateFreeExpressionInput) {
    setSavingExpression(true);
    try {
      const profile = await request<FreeContentExpressionTypeSummary>("/api/v5/free-content-expression-types", { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("create-expression") }, body: JSON.stringify({ expectedVersion: 0, auditReason: "在自由生产页面新建工作区表达", input }) });
      setDrawerOpen(false);
      await loadCatalog();
      messageApi.success("新类型已保存，请填写本次生产资料。");
      setSelectedType(profile);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "新建类型失败。"); }
    finally { setSavingExpression(false); }
  }

  async function supplements(values: Array<{ riskId: string; value: SupplementValue }>) {
    if (!batch) return;
    setWorking("supplements");
    try {
      const saved = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/supplements`, { method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": key("supplements") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "在正文结果页补充缺失事实或素材", supplements: values }) });
      const requiresRegeneration = values.some(({ riskId }) => batch.risks.find((risk) => risk.id === riskId)?.affectedSectionKeys.length);
      if (!requiresRegeneration) {
        setBatch(saved);
        messageApi.success("封面素材已保存，正文和来源核对状态保持不变。");
        return;
      }
      const checked = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/recheck`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("recheck") }, body: JSON.stringify({ expectedVersion: saved.version, auditReason: "局部重生成受影响章节并执行全文复检" }) });
      setBatch(checked);
      messageApi.success("补充内容已写入任务快照，受影响章节和全文检查已更新。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "补充内容重新检查失败。"); }
    finally { setWorking(undefined); }
  }

  async function reviewSources() {
    if (!batch) return;
    const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
    if (!artifact) return;
    setWorking("review-sources");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/review-sources`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("review-sources") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "人工核对当前正文引用来源", artifactId: artifact.id }) });
      setBatch(data);
      messageApi.success("来源核对结果已保存，后续正文变化会自动要求重新核对。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "来源核对失败。"); }
    finally { setWorking(undefined); }
  }

  async function publish() {
    if (!batch) return;
    const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
    if (!artifact) return;
    setWorking("publish");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/confirm-and-publish`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("confirm-publish") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "人工确认当前正文并自动发布", contentDigest: artifact.contentDigest }) });
      setBatch(data);
      messageApi.success(data.status === "published" ? "正文已发布并回填发布结果。" : "正文已进入正式发布队列。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "自动发布失败。"); }
    finally { setWorking(undefined); }
  }

  async function retry() {
    if (!batch) return;
    const previousBatch = batch;
    setWorking("retry");
    setBatch({ ...batch, status: "generating", failureCode: undefined, failureMessage: undefined, nextAction: undefined });
    try { const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/retry-failures`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("retry") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "安全重试自由生产失败任务" }) }); setBatch(data); }
    catch (error) { setBatch(previousBatch); messageApi.error(error instanceof Error ? error.message : "安全重试失败。"); }
    finally { setWorking(undefined); }
  }

  return (
    <>
      {contextHolder}
      <PageHeader title="自由内容生产" subtitle="选择内容类型，补齐本次资料，再生成可追溯的公众号正文。" actions={!batch ? <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>新建类型</Button><Link href="/free-production/tasks"><Button icon={<UnorderedListOutlined />}>任务与发布</Button></Link></Space> : undefined} />
      {!batch ? <Tabs className="free-production-tabs" activeKey="types" items={[{ key: "types", label: "内容类型", children: loading && !catalog ? <div className="v5-loading-row"><Spin /><span>正在读取内容类型</span></div> : catalog ? selectedType ? <ProductionInputPanel profile={selectedType} catalog={catalog} loading={usingId === selectedType.activeVersion?.freeContentExpressionTypeVersionId} onBack={() => setSelectedType(undefined)} onGenerate={(values) => void generateFromExpression(selectedType, values)} /> : <><div className="expression-list-intro"><div><span className="v5-kicker">新建正文</span><h2>选择内容类型</h2></div><p>不同类型会打开对应的资料入口。</p></div><ExpressionPresetList expressions={catalog.expressionTypes} onUse={setSelectedType} /></> : <Alert showIcon type="error" message="内容类型读取失败" /> }, { key: "tasks", label: <Link href="/free-production/tasks">任务与发布</Link>, children: null }]} /> : <GenerationResultWorkspace batch={batch} working={working} onBack={() => { setBatch(undefined); setSelectedType(undefined); window.history.replaceState(null, "", "/free-production"); }} onRetry={() => void retry()} onReviewSources={() => void reviewSources()} onSupplements={(values) => void supplements(values)} onPublish={() => void publish()} />}
      {catalog ? <CreateExpressionDrawer open={drawerOpen} catalog={catalog} saving={savingExpression} onClose={() => setDrawerOpen(false)} onSubmit={(input) => void createExpression(input)} /> : null}
    </>
  );
}
