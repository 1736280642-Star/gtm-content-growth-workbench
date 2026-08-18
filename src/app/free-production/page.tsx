"use client";

import { PictureOutlined, PlusOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Spin, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateExpressionDrawer } from "@/components/free-production/CreateExpressionDrawer";
import { ExpressionPresetList } from "@/components/free-production/ExpressionPresetList";
import { GenerationResultWorkspace } from "@/components/free-production/GenerationResultWorkspace";
import { ProductionInputPanel } from "@/components/free-production/ProductionInputPanel";
import type { SupplementValue } from "@/components/free-production/InlineSupplementField";
import type { WechatCoverFile } from "@/components/free-production/WechatCoverBindingPanel";
import { PageHeader } from "@/components/PageHeader";
import type { CreateFreeExpressionInput, CreateFreeProductionInput, FreeContentExpressionTypeSummary, FreeProductionBatch, FreeProductionCatalog } from "@/lib/v5/free-production-contracts";
import type { WechatRenderableTemplateId } from "@/lib/v5/wechat-presentation-contracts";

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
  const [hotspotError, setHotspotError] = useState<string>();
  const [selectedType, setSelectedType] = useState<FreeContentExpressionTypeSummary>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savingExpression, setSavingExpression] = useState(false);
  const [working, setWorking] = useState<"supplements" | "visual" | "cover" | "layout" | "content" | "hotspot" | "restore" | "publish" | "retry">();

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
      const profile = await request<FreeContentExpressionTypeSummary>("/api/v5/free-content-expression-types", { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("create-expression") }, body: JSON.stringify({ expectedVersion: 0, auditReason: "在公众号生产中心新建工作区表达", input }) });
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
      const checked = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/recheck`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("recheck") }, body: JSON.stringify({ expectedVersion: saved.version, auditReason: "局部重生成受影响章节并执行全文复检" }) });
      setBatch(checked);
      messageApi.success("补充内容已写入任务快照，受影响章节和全文检查已更新。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "补充内容重新检查失败。"); }
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
      messageApi.success(data.status === "draft_created" ? "正文已写入公众号草稿箱，请到后台预览并人工发布。" : data.status === "published" ? "正文已发布并回填发布结果。" : "正文已进入正式发布队列。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "自动发布失败。"); }
    finally { setWorking(undefined); }
  }

  async function bindVisual(artifactId: string, suggestionId: string, mediaAssetId?: string) {
    if (!batch) return;
    setWorking("visual");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/visual-assets`, { method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": key("bind-visual") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: mediaAssetId ? "从产品素材图库选择正文配图并更新公众号排版" : "移除正文配图并恢复配图建议", artifactId, suggestionId, mediaAssetId }) });
      setBatch(data);
    } finally { setWorking(undefined); }
  }

  async function saveCover(file: WechatCoverFile) {
    if (!batch) return;
    setWorking("cover");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/cover`, { method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": key("cover") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "在正文预览页选择公众号封面", file }) });
      setBatch(data);
    } finally { setWorking(undefined); }
  }

  async function changeLayout(artifactId: string, templateId: WechatRenderableTemplateId) {
    if (!batch) return;
    setWorking("layout");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/layout`, { method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": key("layout") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "在正文与排版页切换公众号排版风格", artifactId, templateId }) });
      setBatch(data);
      messageApi.success("排版风格已更新，正式发布 HTML 已同步重建。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "排版风格更新失败。"); }
    finally { setWorking(undefined); }
  }

  async function editContent(artifactId: string, input: { title: string; summary: string; articleBody: string }) {
    if (!batch) return;
    setWorking("content");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/content`, { method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": key("content") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "在正文与排版页人工编辑公众号文字", artifactId, ...input }) });
      setBatch(data);
      messageApi.success("正文已保存，排版预览和正式发布 HTML 已同步更新。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "正文保存失败。"); throw error; }
    finally { setWorking(undefined); }
  }

  async function integrateHotspot(artifactId: string, mode: "integrate" | "replace") {
    if (!batch) return;
    setHotspotError(undefined);
    setWorking("hotspot");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/hotspot`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": key("hotspot") },
        body: JSON.stringify({
          expectedVersion: batch.version,
          auditReason: mode === "replace" ? "由模型更换公众号正文热点与写作方向" : "由模型选择最新热点并融入公众号正文",
          artifactId,
          mode
        })
      });
      setBatch(data);
      setHotspotError(undefined);
      messageApi.success(mode === "replace" ? "已更换热点和写作方向，上一版本仍可恢复。" : "热点已融入正文，原版本已保留。");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "热点融入失败，当前正文未变化。";
      setHotspotError(errorMessage);
      messageApi.error(errorMessage);
    } finally {
      setWorking(undefined);
    }
  }

  async function restorePreviousVersion(artifactId: string) {
    if (!batch) return;
    setWorking("restore");
    try {
      const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/restore-version`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": key("restore-version") },
        body: JSON.stringify({ expectedVersion: batch.version, auditReason: "恢复公众号正文的上一版本", artifactId })
      });
      setBatch(data);
      setHotspotError(undefined);
      messageApi.success("已恢复上一版本，后续热点尝试仍保留在版本记录中。");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "上一版本恢复失败。");
    } finally {
      setWorking(undefined);
    }
  }

  async function retry() {
    if (!batch) return;
    const previousBatch = batch;
    setWorking("retry");
    setBatch({ ...batch, status: "generating", failureCode: undefined, failureMessage: undefined, nextAction: undefined });
    try { const data = await request<FreeProductionBatch>(`/api/v5/free-production/batches/${encodeURIComponent(batch.id)}/retry-failures`, { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": key("retry") }, body: JSON.stringify({ expectedVersion: batch.version, auditReason: "安全重试公众号生产失败任务" }) }); setBatch(data); }
    catch (error) { setBatch(previousBatch); messageApi.error(error instanceof Error ? error.message : "安全重试失败。"); }
    finally { setWorking(undefined); }
  }

  return (
    <>
      {contextHolder}
      <PageHeader title="微信公众号内容生产" subtitle="独立完成单篇公众号内容：选择文章类型、补齐资料、生成与复检，确认后进入公众号发布队列。" actions={!batch ? <Space wrap><Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>新建类型</Button><Link href="/free-production/assets"><Button icon={<PictureOutlined />}>素材图库</Button></Link><Link href="/free-production/tasks"><Button icon={<UnorderedListOutlined />}>任务与发布</Button></Link></Space> : undefined} />
      {!batch ? loading && !catalog ? <div className="v5-loading-row"><Spin /><span>正在读取内容类型</span></div> : catalog ? selectedType ? <ProductionInputPanel profile={selectedType} catalog={catalog} loading={usingId === selectedType.activeVersion?.freeContentExpressionTypeVersionId} onBack={() => setSelectedType(undefined)} onGenerate={(values) => void generateFromExpression(selectedType, values)} /> : <><div className="expression-list-intro"><div><span className="v5-kicker">新建正文</span><h2>选择内容类型</h2></div><p>不同类型会打开对应的资料入口。</p></div><ExpressionPresetList expressions={catalog.expressionTypes} onUse={setSelectedType} /></> : <Alert showIcon type="error" message="内容类型读取失败" /> : <GenerationResultWorkspace batch={batch} working={working} hotspotError={hotspotError} onBack={() => { setBatch(undefined); setSelectedType(undefined); setHotspotError(undefined); window.history.replaceState(null, "", "/free-production"); }} onRetry={() => void retry()} onSupplements={(values) => void supplements(values)} onChangeLayout={changeLayout} onEditContent={editContent} onBindVisual={bindVisual} onIntegrateHotspot={integrateHotspot} onRestorePreviousVersion={restorePreviousVersion} onPublish={() => void publish()} />}
      {catalog ? <CreateExpressionDrawer open={drawerOpen} catalog={catalog} saving={savingExpression} onClose={() => setDrawerOpen(false)} onSubmit={(input) => void createExpression(input)} /> : null}
    </>
  );
}
