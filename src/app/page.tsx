"use client";

import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  CodeOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  MailOutlined,
  PlusOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UploadOutlined,
  WechatOutlined
} from "@ant-design/icons";
import { Button, Input, InputNumber, Spin } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./hosted-mode.module.css";

interface HostedProduct {
  productId: string;
  displayName: string;
  officialUrl?: string;
  productCategory?: string;
  strategyPackId?: string;
}

type ChannelCapability = "auto_publish" | "draft_only" | "unsupported";
type AuthorizationStatus = "connected" | "required" | "not_applicable" | "unavailable";

interface ChannelOption {
  channel: string;
  capability: ChannelCapability;
  authorizationStatus: AuthorizationStatus;
  accountLabel?: string;
  detail: string;
  nextAction?: string;
}

interface ChannelPresentation {
  label: string;
  icon: ReactNode;
}

const channelPresentation: Record<string, ChannelPresentation> = {
  wechat: { label: "微信公众号", icon: <WechatOutlined /> },
  zhihu: { label: "知乎", icon: <ReadOutlined /> },
  csdn: { label: "CSDN", icon: <CodeOutlined /> },
  juejin: { label: "掘金", icon: <GlobalOutlined /> }
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function materialIcon(name: string) {
  return name.toLowerCase().endsWith(".pdf") ? <FilePdfOutlined /> : <FileTextOutlined />;
}

function readApiError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || (record.error as Record<string, unknown> | undefined)?.message || fallback);
}

export default function HostedTaskPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<HostedProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(true);
  const [productName, setProductName] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [customCaps, setCustomCaps] = useState<Record<string, number | undefined>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const loadChannels = useCallback(async (productId?: string) => {
    setChannelsLoading(true);
    try {
      const query = productId ? `?productId=${encodeURIComponent(productId)}` : "";
      const response = await fetch(`/api/v5/hosted/channels${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiError(payload, "渠道状态读取失败。"));
      const options = Array.isArray(payload.channels) ? payload.channels as ChannelOption[] : [];
      setChannelOptions(options);
      setSelectedChannels((current) => current.filter((key) => options.some((item) => item.channel === key && item.capability !== "unsupported")));
    } catch (cause) {
      setChannelOptions([]);
      setError(cause instanceof Error ? cause.message : "渠道状态读取失败。请稍后重试。");
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v5/products", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(readApiError(payload, "产品读取失败。"));
        return Array.isArray(payload.products) ? payload.products as HostedProduct[] : [];
      }),
      loadChannels()
    ]).then(([items]) => {
      if (active) setProducts(items);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "托管入口暂时不可用。");
    }).finally(() => {
      if (active) setProductsLoading(false);
    });
    return () => { active = false; };
  }, [loadChannels]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.productId === selectedProductId),
    [products, selectedProductId]
  );
  const selectedOptionMap = useMemo(
    () => new Map(channelOptions.map((item) => [item.channel, item])),
    [channelOptions]
  );
  const selectedChannelLabels = useMemo(
    () => selectedChannels.map((key) => channelPresentation[key]?.label || key),
    [selectedChannels]
  );
  const authorizationRequired = selectedChannels.filter((key) => selectedOptionMap.get(key)?.authorizationStatus === "required");

  function selectProduct(product: HostedProduct) {
    setSelectedProductId(product.productId);
    setIsAddingNew(false);
    setProductName("");
    setOfficialUrl("");
    setFiles([]);
    setError(undefined);
    void loadChannels(product.productId);
  }

  function startAddingNew() {
    setSelectedProductId("");
    setIsAddingNew(true);
    setError(undefined);
    void loadChannels();
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((file) => file.name.trim());
    setFiles((current) => {
      const keys = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...incoming.filter((file) => !keys.has(`${file.name}:${file.size}:${file.lastModified}`))].slice(0, 10);
    });
    setError(undefined);
  }

  function toggleChannel(channel: string) {
    const option = selectedOptionMap.get(channel);
    if (!option || option.capability === "unsupported") return;
    setSelectedChannels((current) => current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel]);
  }

  async function submitTask() {
    if (!selectedProductId && !productName.trim()) return setError("请填写产品名称，或选择已有产品。");
    if (isAddingNew && !officialUrl.trim() && !files.length) return setError("请至少提供产品官网或一份产品资料。");
    if (!selectedChannels.length) return setError("请至少选择一个可托管的推广渠道。");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("请填写可接收确认链接和发布结果的邮箱。");
    setSubmitting(true);
    setError(undefined);
    try {
      const idempotencyKey = `hosted-submit-${crypto.randomUUID()}`;
      const formData = new FormData();
      if (selectedProductId) formData.set("productId", selectedProductId);
      if (productName.trim()) formData.set("productName", productName.trim());
      if (officialUrl.trim()) formData.set("officialUrl", officialUrl.trim());
      formData.set("contactEmail", email.trim());
      formData.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai");
      formData.set("idempotencyKey", idempotencyKey);
      formData.set("channels", JSON.stringify(selectedChannels.map((channel) => ({
        channel,
        ...(customCaps[channel] ? { dailyCap: customCaps[channel] } : {})
      }))));
      for (const file of files) formData.append("files", file);
      const response = await fetch("/api/v5/hosted/orders", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiError(payload, "托管任务提交失败。"));
      router.push(`/hosted/success?orderId=${encodeURIComponent(payload.order.orderId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "托管任务提交失败。请检查资料后重试。");
      setSubmitting(false);
    }
  }

  const displayProductName = selectedProduct?.displayName || productName.trim() || "尚未填写";
  const materialLabel = selectedProduct
    ? (files.length || officialUrl ? `${files.length} 份新文件${officialUrl ? " + 官网" : ""}` : "沿用已治理资料")
    : `${files.length} 份文件${officialUrl ? " + 官网" : ""}`;

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div><div className={styles.kicker}>JOTO / MANAGED HANDOFF</div><h1>交资料，确认两次，其余交给系统。</h1><p>提交产品资料和渠道。调研完成后，你只需要在邮件里确认策略与样文；之后系统按当月计划自动发布并回传公开 URL。</p></div>
        <aside className={styles.introAside}><strong>正常运行时每天零操作</strong><span>可恢复问题由系统重试；只有事实冲突、授权失效和平台阻断才会请求你处理。</span><small>今天只完成这张委托单</small></aside>
      </section>

      <div className={styles.workspace}>
        <div className={styles.formColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>01</span><div><h2>提供产品资料</h2><p>官网和文件会作为受治理的产品事实来源。</p></div></div></div>
            {productsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在读取已有产品</div> : (
              <div className={styles.productGrid}>
                {products.map((product) => {
                  const selected = product.productId === selectedProductId;
                  return <button className={`${styles.productCard} ${selected ? styles.isSelected : ""}`} type="button" aria-pressed={selected} key={product.productId} onClick={() => selectProduct(product)}><span className={styles.productIcon}><AppstoreOutlined /></span><span className={styles.productCopy}><strong>{product.displayName}</strong><span>{product.productCategory || product.officialUrl || "已有产品资料"}</span><small className={`${styles.knowledgeBadge} ${styles[product.strategyPackId ? "knowledge-ready" : "knowledge-building"]}`}>{product.strategyPackId ? "策略资料已建立" : "可继续补充资料"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>;
                })}
                <button className={`${styles.productCard} ${styles.addProductCard} ${isAddingNew ? styles.isSelected : ""}`} type="button" aria-pressed={isAddingNew} onClick={startAddingNew}><span className={`${styles.productIcon} ${styles.addProductIcon}`}><PlusOutlined /></span><span className={styles.productCopy}><strong>新增产品</strong><span>填写官网并上传公开推广资料</span></span><span className={styles.selectionMark}>{isAddingNew ? <CheckOutlined /> : null}</span></button>
              </div>
            )}
            {isAddingNew || selectedProduct ? (
              <div className={styles.newProductForm}>
                {isAddingNew ? <div className={styles.newProductField}><label>产品名称</label><Input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：WorkBuddy" size="large" /></div> : null}
                <div className={styles.newProductField}><label>产品官网{selectedProduct ? "（有更新时填写）" : ""}</label><Input value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} placeholder={selectedProduct?.officialUrl || "https://example.com/product"} prefix={<LinkOutlined />} size="large" /></div>
                <div className={styles.newProductField}><label>产品资料{selectedProduct ? "（可选补充）" : ""}</label><label className={`${styles.dropzone} ${styles.compactDropzone} ${dragging ? styles.isDragging : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}><input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md" onChange={(event) => event.target.files && addFiles(event.target.files)} /><span className={styles.uploadIcon}><UploadOutlined /></span><strong>拖入资料，或点击选择</strong><span>最多 10 份，单个文件不超过 20 MB</span></label>{files.length ? <div className={styles.fileList}>{files.map((file) => <div className={styles.fileItem} key={`${file.name}:${file.size}:${file.lastModified}`}>{materialIcon(file.name)}<span>{file.name}</span><small>{formatSize(file.size)}</small><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} /></div>)}</div> : null}</div>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>02</span><div><h2>选择推广渠道</h2><p>系统只允许选择已经具备托管规则的渠道。</p></div></div></div>
            {channelsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在核对渠道能力</div> : <div className={styles.choiceGrid}>{channelOptions.map((option) => {
              const selected = selectedChannels.includes(option.channel);
              const disabled = option.capability === "unsupported";
              const presentation = channelPresentation[option.channel] || { label: option.channel, icon: <GlobalOutlined /> };
              return <button className={`${styles.choiceButton} ${selected ? styles.isSelected : ""} ${disabled ? styles.isDisabled : ""}`} type="button" aria-pressed={selected} aria-disabled={disabled} disabled={disabled} key={option.channel} onClick={() => toggleChannel(option.channel)}><span className={styles.choiceIcon}>{presentation.icon}</span><span className={styles.choiceCopy}><strong>{presentation.label}</strong><span>{option.detail}</span><small className={`${styles.capabilityBadge} ${styles[`capability-${option.authorizationStatus}`]}`}>{option.authorizationStatus === "connected" ? "已连接" : option.authorizationStatus === "required" ? "需连接账号" : "暂不可托管"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>;
            })}</div>}
            {authorizationRequired.length ? <div className={styles.actionNotice}><SettingOutlined /><span>已选渠道中有 {authorizationRequired.length} 个需要连接账号。可以先提交，系统会在正式发布前提醒你完成授权。</span><Link href="/settings?tab=connections">管理连接</Link></div> : null}
            <button className={styles.advancedToggle} type="button" onClick={() => setShowAdvanced((current) => !current)}><SettingOutlined /> {showAdvanced ? "收起每日上限" : "高级：自定义每日上限"}</button>
            {showAdvanced ? <div className={styles.capGrid}>{selectedChannels.map((channel) => <label key={channel}><span>{channelPresentation[channel]?.label || channel}</span><InputNumber min={1} max={100} value={customCaps[channel]} placeholder="系统安全上限" onChange={(value) => setCustomCaps((current) => ({ ...current, [channel]: value || undefined }))} /><small>篇 / 日</small></label>)}</div> : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>03</span><div><h2>接收确认与结果</h2><p>策略、样文和每日公开 URL 都发送到这个邮箱。</p></div></div></div>
            <div className={styles.accountEditor}><Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.cn" prefix={<MailOutlined />} size="large" /><span className={styles.emailAssurance}>不会逐篇打扰</span></div>
          </section>

          {error ? <div className={styles.formError} role="alert"><strong>暂时不能提交</strong><span>{error}</span></div> : null}
          <div className={styles.submitBar}><span className={styles.submitHint}>点击即确认这些资料可以用于公开推广。策略和样文仍必须由你本人确认。</span><Button className={styles.submitButton} type="primary" size="large" loading={submitting} onClick={submitTask} icon={!submitting ? <ArrowRightOutlined /> : undefined}>确认委托，开始调研</Button></div>
        </div>

        <aside className={styles.receipt} aria-label="当前委托单">
          <div className={styles.receiptHeader}><div><span className={styles.receiptKicker}>MANAGED HANDOFF</span><h2>当前委托单</h2><p>确认系统接手的是这件事。</p></div><span className={styles.receiptStamp}><SafetyCertificateOutlined /></span></div>
          <div className={styles.receiptBody}><div className={styles.receiptSection}><dl><div className={styles.receiptRow}><dt>推广产品</dt><dd>{displayProductName}</dd></div><div className={styles.receiptRow}><dt>产品资料</dt><dd className="wrap">{materialLabel || "尚未添加"}</dd></div><div className={styles.receiptRow}><dt>推广渠道</dt><dd className="wrap">{selectedChannelLabels.length ? selectedChannelLabels.join("、") : "尚未选择"}</dd></div><div className={styles.receiptRow}><dt>每日上限</dt><dd>默认平台安全上限</dd></div><div className={styles.receiptRow}><dt>通知邮箱</dt><dd>{email || "尚未填写"}</dd></div></dl></div><div className={styles.receiptSection}><div className={styles.receiptNote}><strong>之后只需确认两次</strong><br />GEO 策略一次、代表样文一次。进入托管发布后，没有异常就不需要每天操作。</div></div></div>
          <div className={styles.receiptFooter}>执行周期：当前日历月 · 每日发布属于月度计划的执行节流</div>
        </aside>
      </div>
    </div>
  );
}
