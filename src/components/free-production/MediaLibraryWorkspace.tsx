"use client";

import { DeleteOutlined, EditOutlined, FileImageOutlined, InboxOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Input, Popconfirm, Select, Spin, Tag, Upload, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FreeProductionCatalog } from "@/lib/v5/free-production-contracts";
import type { MediaLibraryAsset, MediaLibraryFileInput, MediaLibraryListResult } from "@/lib/v5/media-library-contracts";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function key(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string; nextAction?: string; details?: string[] } };
  if (!response.ok || !body.ok) throw new Error(`${body.error?.message || "请求失败。"}${body.error?.details?.length ? ` ${body.error.details.join("；")}` : ""}${body.error?.nextAction ? ` ${body.error.nextAction}` : ""}`);
  return body.data as T;
}

function fileToPayload(file: File): Promise<MediaLibraryFileInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败，请重新选择。"));
    reader.onload = () => resolve({ fileName: file.name, mimeType: file.type, dataBase64: String(reader.result || "").split(",")[1] || "" });
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatLabel(asset: MediaLibraryAsset) {
  if (asset.mimeType === "image/gif") return "GIF 动图";
  return asset.mimeType.replace("image/", "").toUpperCase();
}

interface EditorState {
  asset?: MediaLibraryAsset;
  productId: string;
  description: string;
  file?: MediaLibraryFileInput;
  fileName?: string;
}

const EMPTY_EDITOR: EditorState = { productId: "", description: "" };

export function MediaLibraryWorkspace({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [catalog, setCatalog] = useState<FreeProductionCatalog>();
  const [assets, setAssets] = useState<MediaLibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCatalog, result] = await Promise.all([
        request<FreeProductionCatalog>("/api/v5/free-production/catalog"),
        request<MediaLibraryListResult>("/api/v5/free-production/assets")
      ]);
      setCatalog(nextCatalog);
      setAssets(result.items);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "素材图库读取失败。");
    } finally { setLoading(false); }
  }, [messageApi]);

  useEffect(() => { void load(); }, [load, refreshSignal]);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return assets.filter((asset) => selectedProduct === "all" || asset.productId === selectedProduct)
      .filter((asset) => !normalizedQuery || `${asset.description} ${asset.originalFileName} ${asset.productNameSnapshot}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  }, [assets, query, selectedProduct]);

  const products = catalog?.products || [];
  const productOptions = products.map((product) => ({ value: product.productId, label: product.name }));
  const productFilterOptions = [{ value: "all", label: "全部产品" }, ...productOptions];

  function openCreate() {
    setEditor({ ...EMPTY_EDITOR, productId: selectedProduct === "all" ? products[0]?.productId || "" : selectedProduct });
  }

  function openEdit(asset: MediaLibraryAsset) {
    setEditor({ asset, productId: asset.productId, description: asset.description });
  }

  async function save() {
    if (!editor) return;
    if (!editor.productId) { messageApi.warning("请选择素材对应的产品。"); return; }
    if (!editor.description.trim()) { messageApi.warning("请填写素材描述。"); return; }
    if (!editor.asset && !editor.file) { messageApi.warning("请选择要上传的图片或动图。"); return; }
    setSaving(true);
    try {
      if (editor.asset) {
        await request<MediaLibraryAsset>(`/api/v5/free-production/assets/${encodeURIComponent(editor.asset.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-idempotency-key": key("update-media") },
          body: JSON.stringify({ expectedVersion: editor.asset.version, auditReason: "更新公众号素材的产品分类与描述", productId: editor.productId, description: editor.description.trim() })
        });
        messageApi.success("素材信息已更新。");
      } else {
        await request<MediaLibraryAsset>("/api/v5/free-production/assets", {
          method: "POST",
          headers: { "content-type": "application/json", "x-idempotency-key": key("create-media") },
          body: JSON.stringify({ expectedVersion: 0, auditReason: "上传公众号图片或动图到产品素材图库", productId: editor.productId, description: editor.description.trim(), file: editor.file })
        });
        messageApi.success("素材已加入图库。");
      }
      setEditor(undefined);
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "素材保存失败。");
    } finally { setSaving(false); }
  }

  async function archive(asset: MediaLibraryAsset) {
    try {
      await request<MediaLibraryAsset>(`/api/v5/free-production/assets/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-idempotency-key": key("archive-media") },
        body: JSON.stringify({ expectedVersion: asset.version, auditReason: "将不再使用的公众号素材移出图库" })
      });
      messageApi.success("素材已移出图库，原文件仍保留以便恢复。");
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "素材移出失败。");
    }
  }

  async function chooseFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) { messageApi.error("仅支持 JPG、PNG、WebP 和 GIF。"); return Upload.LIST_IGNORE; }
    if (file.size > MAX_FILE_SIZE) { messageApi.error("单个素材不能超过 5 MB。"); return Upload.LIST_IGNORE; }
    try {
      const payload = await fileToPayload(file);
      setEditor((current) => current ? { ...current, file: payload, fileName: file.name } : current);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "文件读取失败。"); }
    return false;
  }

  return (
    <section className="media-library-workspace" aria-label="公众号产品素材图库">
      {contextHolder}
      <div className="media-library-toolbar">
        <Input allowClear prefix={<SearchOutlined />} value={query} placeholder="搜索描述、文件名或产品" onChange={(event) => setQuery(event.target.value)} />
        <Select value={selectedProduct} onChange={setSelectedProduct} options={productFilterOptions} aria-label="按产品筛选素材" />
        <span>显示 {filteredAssets.length} / {assets.length} 份素材</span>
      </div>

      {loading ? <div className="media-library-loading"><Spin /><span>正在整理产品素材</span></div> : filteredAssets.length ? (
        <div className="media-library-grid">
          {filteredAssets.map((asset) => (
            <article className="media-asset-card" key={asset.id}>
              <div className="media-asset-visual">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.contentUrl} alt={asset.description} loading="lazy" />
                <Tag color={asset.mediaKind === "animated_image" ? "purple" : "blue"}>{formatLabel(asset)}</Tag>
              </div>
              <div className="media-asset-body">
                <span className="media-asset-product">{asset.productNameSnapshot}</span>
                <p>{asset.description}</p>
                <div className="media-asset-meta"><span>{asset.originalFileName}</span><span>{formatBytes(asset.byteSize)}</span></div>
              </div>
              <div className="media-asset-actions">
                <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(asset)}>编辑信息</Button>
                <Popconfirm title="将素材移出图库？" description="图库中不再显示，但原文件会保留。" okText="移出" cancelText="取消" onConfirm={() => void archive(asset)}>
                  <Button type="text" danger icon={<DeleteOutlined />}>移出</Button>
                </Popconfirm>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-library-empty">
          <Empty image={<FileImageOutlined />} description={assets.length ? "没有符合当前筛选条件的素材" : "还没有产品素材"} />
          {!assets.length ? <Button type="primary" icon={<PlusOutlined />} disabled={!products.length} onClick={openCreate}>上传第一份素材</Button> : null}
        </div>
      )}

      <Drawer width={480} title={editor?.asset ? "编辑素材信息" : "上传产品素材"} open={Boolean(editor)} onClose={() => !saving && setEditor(undefined)} extra={<Button type="primary" loading={saving} onClick={() => void save()}>{editor?.asset ? "保存修改" : "加入图库"}</Button>}>
        {editor ? <div className="media-library-editor">
          {!editor.asset ? <Upload.Dragger accept={ACCEPTED_TYPES.join(",")} maxCount={1} showUploadList={false} beforeUpload={(file) => { void chooseFile(file); return false; }}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{editor.fileName || "选择图片或 GIF 动图"}</p>
            <p className="ant-upload-hint">支持 JPG、PNG、WebP、GIF，单个文件不超过 5 MB</p>
          </Upload.Dragger> : <div className="media-library-editor-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={editor.asset.contentUrl} alt={editor.asset.description} />
            <span>{editor.asset.originalFileName}</span>
          </div>}
          <label><span>产品标记</span><Select value={editor.productId || undefined} placeholder="标记该素材对应的产品" options={productOptions} onChange={(productId) => setEditor({ ...editor, productId })} /></label>
          <label><span>素材描述</span><Input.TextArea value={editor.description} maxLength={300} showCount autoSize={{ minRows: 4, maxRows: 8 }} placeholder="例如：WorkBuddy 桌面端任务拆解界面，适合放在产品能力介绍章节。" onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
          <p className="media-library-editor-note">描述应说明“画面是什么、适合用在哪里”，方便后续搜索和选择。</p>
        </div> : null}
      </Drawer>
    </section>
  );
}
