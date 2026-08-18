"use client";

import { CheckCircleFilled, PictureOutlined, SwapOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Upload, message } from "antd";
import { useEffect, useState } from "react";
import type { RiskAndGapItem } from "@/lib/v5/free-production-contracts";

export interface WechatCoverFile {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export function WechatCoverBindingPanel({ batchId, batchVersion, coverRisk, saving, locked, onSave }: {
  batchId: string;
  batchVersion: number;
  coverRisk?: RiskAndGapItem;
  saving?: boolean;
  locked?: boolean;
  onSave: (file: WechatCoverFile) => Promise<void>;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [pendingFile, setPendingFile] = useState<WechatCoverFile>();
  const [pendingPreview, setPendingPreview] = useState<string>();
  const saved = coverRisk?.status === "ready" && Boolean(coverRisk.assetRef);

  useEffect(() => {
    setPendingFile(undefined);
    setPendingPreview(undefined);
  }, [coverRisk?.assetRef]);

  async function save() {
    if (!pendingFile) return;
    try {
      await onSave(pendingFile);
      messageApi.success("封面已保存，并会随正文进入公众号发布任务。");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "封面保存失败。");
    }
  }

  const savedPreview = saved
    ? `/api/v5/free-production/batches/${encodeURIComponent(batchId)}/cover?v=${batchVersion}`
    : undefined;
  const preview = pendingPreview || savedPreview;

  return (
    <section className={`wechat-cover-binding${saved ? " is-ready" : ""}`} aria-label="公众号封面">
      {contextHolder}
      <div className="wechat-cover-preview">
        {preview ? <img src={preview} alt="公众号封面预览" /> : <span><PictureOutlined /><small>2.35 : 1</small></span>}
      </div>
      <div className="wechat-cover-copy">
        <span className="v5-kicker">发布封面</span>
        <strong>{pendingFile?.fileName || coverRisk?.value || "为这篇正文配一张封面"}</strong>
        <p>{saved ? "已写入当前正文的发布配置，可继续更换。" : "支持 JPG、PNG、WebP，最大 5 MB。封面只用于公众号卡片，不会插入正文。"}</p>
      </div>
      <div className="wechat-cover-actions">
        <Upload
          accept="image/jpeg,image/png,image/webp"
          maxCount={1}
          showUploadList={false}
          disabled={locked || saving}
          beforeUpload={(file) => {
            if (file.size > 5 * 1024 * 1024) {
              messageApi.error("封面不能超过 5 MB，请压缩后重试。");
              return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result || "");
              setPendingPreview(dataUrl);
              setPendingFile({ fileName: file.name, mimeType: file.type, dataBase64: dataUrl.split(",")[1] || "" });
            };
            reader.readAsDataURL(file);
            return false;
          }}
        >
          <Button icon={saved ? <SwapOutlined /> : <UploadOutlined />} disabled={locked || saving}>{saved ? "更换" : "选择封面"}</Button>
        </Upload>
        {pendingFile ? <Button type="primary" icon={<CheckCircleFilled />} loading={saving} disabled={locked} onClick={() => void save()}>保存封面</Button> : null}
      </div>
    </section>
  );
}
