"use client";

import { CheckCircleFilled, CloseOutlined, PictureOutlined, SearchOutlined, SwapOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Input, Spin, Tag, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisualMaterialSuggestion } from "@/lib/v5/free-production-contracts";
import type { MediaLibraryAsset, MediaLibraryListResult } from "@/lib/v5/media-library-contracts";

const MEDIA_REF_PREFIX = "workbench-media:";

async function request<T>(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string; nextAction?: string } };
  if (!response.ok || !body.ok) throw new Error(`${body.error?.message || "素材读取失败。"}${body.error?.nextAction ? ` ${body.error.nextAction}` : ""}`);
  return body.data as T;
}

function boundAssetId(suggestion: VisualMaterialSuggestion) {
  return suggestion.boundAssetRef?.startsWith(MEDIA_REF_PREFIX) ? suggestion.boundAssetRef.slice(MEDIA_REF_PREFIX.length) : undefined;
}

function formatLabel(asset: MediaLibraryAsset) {
  return asset.mimeType === "image/gif" ? "GIF 动图" : asset.mimeType.replace("image/", "").toUpperCase();
}

export function VisualAssetBindingPanel({ suggestions, productId, onBind }: {
  suggestions: VisualMaterialSuggestion[];
  productId: string;
  onBind: (suggestionId: string, mediaAssetId?: string) => Promise<void>;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [assets, setAssets] = useState<MediaLibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string>();
  const [savingSuggestionId, setSavingSuggestionId] = useState<string>();
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!productId || !suggestions.length) return;
    setLoading(true);
    try {
      const result = await request<MediaLibraryListResult>(`/api/v5/free-production/assets?productId=${encodeURIComponent(productId)}`);
      setAssets(result.items);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "素材读取失败。"); }
    finally { setLoading(false); }
  }, [messageApi, productId, suggestions.length]);

  useEffect(() => { void load(); }, [load]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const boundCount = suggestions.filter((suggestion) => boundAssetId(suggestion)).length;
  const activeSuggestion = suggestions.find((suggestion) => suggestion.id === activeSuggestionId);
  const activeBoundAssetId = activeSuggestion ? boundAssetId(activeSuggestion) : undefined;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleAssets = assets.filter((asset) => !normalizedQuery || `${asset.description} ${asset.originalFileName}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));

  async function bind(suggestionId: string, mediaAssetId?: string) {
    setSavingSuggestionId(suggestionId);
    try {
      await onBind(suggestionId, mediaAssetId);
      setActiveSuggestionId(undefined);
      messageApi.success(mediaAssetId ? "配图已绑定并写入公众号排版。" : "配图已移除，正文恢复为配图建议。");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "配图更新失败。"); }
    finally { setSavingSuggestionId(undefined); }
  }

  if (!suggestions.length) return null;
  return (
    <section className="visual-binding-panel" aria-label="正文配图建议与素材绑定">
      {contextHolder}
      <header className="visual-binding-header">
        <div><strong>配图工位</strong><span>选择后会同时更新预览和正式公众号 HTML</span></div>
        <Tag color={boundCount === suggestions.length ? "success" : "processing"}>{boundCount} / {suggestions.length} 已绑定</Tag>
      </header>
      <div className="visual-binding-list">
        {suggestions.map((suggestion) => {
          const assetId = boundAssetId(suggestion);
          const asset = assetId ? assetById.get(assetId) : undefined;
          const saving = savingSuggestionId === suggestion.id;
          return <article className={`visual-binding-row${asset ? " is-bound" : ""}`} key={suggestion.id}>
            <div className="visual-binding-brief">
              <span>{suggestion.purpose}</span>
              <strong>{suggestion.recommendation}</strong>
              <p>{suggestion.captionSuggestion}</p>
            </div>
            {asset ? <div className="visual-binding-asset">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.contentUrl} alt={asset.description} />
              <div><span><CheckCircleFilled /> 已写入排版</span><strong>{asset.description}</strong><small>{formatLabel(asset)} · {asset.productNameSnapshot}</small></div>
            </div> : <div className="visual-binding-empty"><PictureOutlined /><span>{assetId ? "素材已不可用，请重新选择" : "尚未选择素材"}</span></div>}
            <div className="visual-binding-actions">
              <Button type={asset ? "default" : "primary"} icon={asset ? <SwapOutlined /> : <PictureOutlined />} loading={saving} onClick={() => setActiveSuggestionId(suggestion.id)}>{asset ? "更换" : "从图库选择"}</Button>
              {assetId ? <Button type="text" danger icon={<CloseOutlined />} loading={saving} onClick={() => void bind(suggestion.id)}>移除</Button> : null}
            </div>
          </article>;
        })}
      </div>

      <Drawer width={720} title={activeSuggestion ? `为“${activeSuggestion.recommendation}”选择素材` : "选择素材"} open={Boolean(activeSuggestion)} onClose={() => !savingSuggestionId && setActiveSuggestionId(undefined)}>
        <div className="visual-picker-toolbar"><Input allowClear prefix={<SearchOutlined />} value={query} placeholder="搜索素材描述或文件名" onChange={(event) => setQuery(event.target.value)} /><span>仅显示当前正文产品下的素材</span></div>
        {loading ? <div className="visual-picker-loading"><Spin /><span>正在读取产品素材</span></div> : visibleAssets.length ? <div className="visual-picker-grid">
          {visibleAssets.map((asset) => <button type="button" className={activeBoundAssetId === asset.id ? "is-current" : ""} key={asset.id} disabled={Boolean(savingSuggestionId || !activeSuggestion)} onClick={() => { if (activeSuggestion) void bind(activeSuggestion.id, asset.id); }}>
            <span className="visual-picker-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.contentUrl} alt={asset.description} />
              <Tag color={asset.mediaKind === "animated_image" ? "purple" : "blue"}>{formatLabel(asset)}</Tag>
            </span>
            <strong>{asset.description}</strong>
            <small>{asset.originalFileName}</small>
          </button>)}
        </div> : <div className="visual-picker-empty"><Empty description="当前产品还没有可用素材" /><Link href="/free-production/assets"><Button type="primary">去素材图库上传</Button></Link></div>}
      </Drawer>
    </section>
  );
}
