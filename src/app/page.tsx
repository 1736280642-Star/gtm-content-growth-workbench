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
  UploadOutlined,
  WechatOutlined
} from "@ant-design/icons";
import { Button, Input } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { HostedAiFrontendTestPanel } from "@/components/HostedAiFrontendTestPanel";
import styles from "./hosted-mode.module.css";

// 高级运营控制台继续承载 productProduction、生产产品、自动化运行中、查看任务、处理异常等能力。

type ChannelKey = "wechat" | "zhihu" | "csdn" | "juejin";
type ExpressionKey = "recommended" | "professional" | "scenario" | "comparison";
type ProductKnowledgeStatus = "ready" | "partial" | "building";

interface MaterialItem {
  name: string;
  size: number;
}

interface HostedProduct {
  productId: string;
  displayName: string;
  tagline: string;
  icon: ReactNode;
  knowledgeStatus: ProductKnowledgeStatus;
  knowledgeLabel: string;
  recommended?: boolean;
  category: string;
}

interface NewProductDraft {
  name: string;
  officialUrl: string;
  materials: MaterialItem[];
}

const channels: Array<{ key: ChannelKey; label: string; detail: string; icon: ReactNode; recommended?: boolean }> = [
  { key: "wechat", label: "微信公众号", detail: "已连接 · 官方账号", icon: <WechatOutlined />, recommended: true },
  { key: "zhihu", label: "知乎", detail: "已连接 · 专业问答", icon: <ReadOutlined />, recommended: true },
  { key: "csdn", label: "CSDN", detail: "已连接 · 技术社区", icon: <CodeOutlined /> },
  { key: "juejin", label: "掘金", detail: "已连接 · 技术社区", icon: <GlobalOutlined /> }
];

const expressions: Array<{ key: ExpressionKey; label: string; detail: string; icon: ReactNode }> = [
  { key: "recommended", label: "系统推荐", detail: "按产品问题和渠道自动组合", icon: <SafetyCertificateOutlined /> },
  { key: "professional", label: "专业解答", detail: "适合建立可信度和搜索覆盖", icon: <ReadOutlined /> },
  { key: "scenario", label: "场景故事", detail: "从真实使用情境切入", icon: <FileTextOutlined /> },
  { key: "comparison", label: "对比选型", detail: "回答用户的决策和取舍", icon: <GlobalOutlined /> }
];

const demoEmail = "marketing@example.cn";

const availableProducts: HostedProduct[] = [
  {
    productId: "tencent-adp",
    displayName: "腾讯云 ADP",
    tagline: "AI 原生应用开发平台",
    icon: <CodeOutlined />,
    knowledgeStatus: "ready",
    knowledgeLabel: "知识库就绪",
    recommended: true,
    category: "云服务"
  },
  {
    productId: "workbuddy",
    displayName: "WorkBuddy",
    tagline: "智能工作助手",
    icon: <AppstoreOutlined />,
    knowledgeStatus: "ready",
    knowledgeLabel: "知识库就绪",
    recommended: true,
    category: "效率工具"
  },
  {
    productId: "noteflow",
    displayName: "NoteFlow",
    tagline: "知识管理与笔记",
    icon: <ReadOutlined />,
    knowledgeStatus: "partial",
    knowledgeLabel: "资料待补充",
    category: "效率工具"
  }
];

function formatSize(size: number) {
  if (!size) return "等待上传";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function materialIcon(name: string) {
  if (name.toLowerCase().endsWith(".pdf")) return <FilePdfOutlined />;
  return <FileTextOutlined />;
}

export default function HostedTaskPage() {
  const router = useRouter();
  const newProductInputRef = useRef<HTMLInputElement>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("tencent-adp");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductDraft>({ name: "", officialUrl: "", materials: [] });
  const [channelsSelected, setChannelsSelected] = useState<ChannelKey[]>(["wechat", "zhihu"]);
  const [expression, setExpression] = useState<ExpressionKey>("recommended");
  const [email, setEmail] = useState(demoEmail);
  const [editingEmail, setEditingEmail] = useState(false);
  const [newProductDragging, setNewProductDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const selectedProduct = useMemo(
    () => availableProducts.find((p) => p.productId === selectedProductId),
    [selectedProductId]
  );
  const selectedChannelLabels = useMemo(
    () => channels.filter((channel) => channelsSelected.includes(channel.key)).map((channel) => channel.label),
    [channelsSelected]
  );
  const expressionLabel = expressions.find((item) => item.key === expression)?.label || "系统推荐";

  const displayProductName = useMemo(() => {
    if (selectedProduct) return selectedProduct.displayName;
    if (isAddingNew && newProduct.name) return newProduct.name;
    return "未选择";
  }, [selectedProduct, isAddingNew, newProduct.name]);

  const displayMaterialCount = useMemo(() => {
    if (selectedProduct) {
      if (selectedProduct.knowledgeStatus === "ready") return "知识库已就绪";
      if (selectedProduct.knowledgeStatus === "partial") return "资料待补充";
      return "建设中";
    }
    if (isAddingNew) {
      const count = newProduct.materials.length;
      const hasUrl = newProduct.officialUrl.trim().length > 0;
      const items: string[] = [];
      if (count) items.push(`${count} 份文件`);
      if (hasUrl) items.push("1 个链接");
      return items.length ? items.join(" + ") : "尚未添加资料";
    }
    return "尚未选择";
  }, [selectedProduct, isAddingNew, newProduct.materials.length, newProduct.officialUrl]);

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList)
      .filter((file) => file.name.trim())
      .map((file) => ({ name: file.name, size: file.size }));
    setNewProduct((current) => {
      const existing = new Set(current.materials.map((item) => item.name));
      return { ...current, materials: [...current.materials, ...incoming.filter((item) => !existing.has(item.name))] };
    });
    setError(undefined);
  }

  function removeMaterial(name: string) {
    setNewProduct((current) => ({
      ...current,
      materials: current.materials.filter((item) => item.name !== name)
    }));
  }

  function toggleChannel(key: ChannelKey) {
    setChannelsSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    setIsAddingNew(false);
    setError(undefined);
  }

  function startAddingNew() {
    setSelectedProductId("");
    setIsAddingNew(true);
    setError(undefined);
  }

  function submitTask() {
    if (!selectedProductId && !isAddingNew) {
      setError("请选择一个要推广的产品，或新增一个产品。");
      return;
    }
    if (isAddingNew && !newProduct.name.trim()) {
      setError("请填写新产品名称。");
      return;
    }
    if (isAddingNew && !newProduct.officialUrl.trim() && newProduct.materials.length === 0) {
      setError("请至少提供官方网址或一份产品资料，系统才能开始构建知识库。");
      return;
    }
    if (!channelsSelected.length) {
      setError("请至少选择一个发布渠道。");
      return;
    }
    if (!email.includes("@")) {
      setError("请填写可接收结果的阿里邮箱地址。");
      return;
    }
    setSubmitting(true);
    window.sessionStorage.setItem("joto-hosted-task", JSON.stringify({
      email,
      product: selectedProduct
        ? { productId: selectedProduct.productId, displayName: selectedProduct.displayName, isNew: false }
        : { productId: "new", displayName: newProduct.name, isNew: true, officialUrl: newProduct.officialUrl, materials: newProduct.materials },
      channels: selectedChannelLabels,
      expression: expressionLabel
    }));
    window.setTimeout(() => router.push("/hosted/success?task=JOTO-0820-01"), 650);
  }

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div>
          <div className={styles.kicker}>JOTO / HANDOFF DESK</div>
          <h1>把推广交给系统。</h1>
          <p>选择要推广的产品，选定渠道和表达方式。文章生产、批量发布、效果测试和结果回传，都会在后台自动完成。</p>
        </div>
        <aside className={styles.introAside}>
          <strong>你只需要做一次决定</strong>
          <span>系统会按当前月度周期安排发布，遇到可恢复问题会自行重试，不会把过程变成待办。</span>
          <small>结果默认发送到你的阿里邮箱</small>
        </aside>
      </section>

      <div className={styles.workspace}>
        <div className={styles.formColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>01</span>
                <div><h2>选择推广产品</h2><p>从已有产品中选择，或新增一个产品并提交资料。</p></div>
              </div>
            </div>
            <div className={styles.productGrid}>
              {availableProducts.map((product) => {
                const selected = selectedProductId === product.productId;
                return (
                  <button
                    className={`${styles.productCard} ${selected ? styles.isSelected : ""}`}
                    type="button"
                    aria-pressed={selected}
                    key={product.productId}
                    onClick={() => selectProduct(product.productId)}
                  >
                    <span className={styles.productIcon}>{product.icon}</span>
                    <span className={styles.productCopy}>
                      <strong>
                        {product.displayName}
                        {product.recommended ? <small className={styles.recommended}>推荐</small> : null}
                      </strong>
                      <span>{product.tagline}</span>
                      <small className={`${styles.knowledgeBadge} ${styles[`knowledge-${product.knowledgeStatus}`]}`}>
                        {product.knowledgeLabel}
                      </small>
                    </span>
                    <span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span>
                  </button>
                );
              })}
              <button
                className={`${styles.productCard} ${styles.addProductCard} ${isAddingNew ? styles.isSelected : ""}`}
                type="button"
                aria-pressed={isAddingNew}
                onClick={startAddingNew}
              >
                <span className={`${styles.productIcon} ${styles.addProductIcon}`}><PlusOutlined /></span>
                <span className={styles.productCopy}>
                  <strong>新增产品</strong>
                  <span>不在列表中？提交官方链接或资料文件</span>
                </span>
                <span className={styles.selectionMark}>{isAddingNew ? <CheckOutlined /> : null}</span>
              </button>
            </div>

            {isAddingNew ? (
              <div className={styles.newProductForm}>
                <div className={styles.newProductField}>
                  <label>产品名称</label>
                  <Input
                    value={newProduct.name}
                    onChange={(e) => setNewProduct((c) => ({ ...c, name: e.target.value }))}
                    placeholder="例如：JOTO Guard"
                    size="large"
                  />
                </div>
                <div className={styles.newProductField}>
                  <label>官方网址（可选）</label>
                  <Input
                    value={newProduct.officialUrl}
                    onChange={(e) => setNewProduct((c) => ({ ...c, officialUrl: e.target.value }))}
                    placeholder="https://example.com/product"
                    prefix={<LinkOutlined style={{ color: "#84908a" }} />}
                    size="large"
                  />
                </div>
                <div className={styles.newProductField}>
                  <label>产品资料（可选，支持多文件）</label>
                  <label
                    className={`${styles.dropzone} ${styles.compactDropzone} ${newProductDragging ? styles.isDragging : ""}`}
                    onDragEnter={(event) => { event.preventDefault(); setNewProductDragging(true); }}
                    onDragOver={(event) => { event.preventDefault(); setNewProductDragging(true); }}
                    onDragLeave={() => setNewProductDragging(false)}
                    onDrop={(event) => { event.preventDefault(); setNewProductDragging(false); addFiles(event.dataTransfer.files); }}
                  >
                    <input
                      ref={newProductInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md"
                      onChange={(event) => { if (event.target.files) addFiles(event.target.files); }}
                    />
                    <span className={styles.uploadIcon}><UploadOutlined /></span>
                    <strong>拖入文件，或点击选择</strong>
                    <span>支持 PDF、Word、PPT、Excel、Markdown</span>
                  </label>
                  {newProduct.materials.length ? (
                    <div className={styles.fileList} aria-label="已上传资料">
                      {newProduct.materials.map((material) => (
                        <div className={styles.fileItem} key={material.name}>
                          {materialIcon(material.name)}
                          <span>{material.name}</span>
                          <small>{formatSize(material.size)}</small>
                          <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除 ${material.name}`} onClick={() => removeMaterial(material.name)} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>02</span>
                <div><h2>验证 AI 前台表现</h2><p>点击已绑定账号，系统会自动打开原登录会话并发送测试问题。</p></div>
              </div>
            </div>
            <HostedAiFrontendTestPanel productId={isAddingNew ? undefined : selectedProductId || undefined} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>03</span>
                <div><h2>结果发到哪里</h2><p>登录阿里邮箱后，所有公开 URL 和测试结论都会发到这里。</p></div>
              </div>
            </div>
            {editingEmail ? (
              <div className={styles.accountEditor}>
                <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.cn" autoFocus />
                <Button type="primary" onClick={() => setEditingEmail(false)}>确认邮箱</Button>
              </div>
            ) : (
              <div className={styles.accountRow}>
                <div className={styles.accountIdentity}>
                  <span className={styles.mailMark}><MailOutlined /></span>
                  <div><strong>{email}</strong><span>阿里邮箱已连接 · 结果通知已开启</span></div>
                </div>
                <Button type="text" onClick={() => setEditingEmail(true)}>更换邮箱</Button>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>04</span>
                <div><h2>选择发布渠道</h2><p>只显示适合当前产品且已经可以使用的渠道。</p></div>
              </div>
            </div>
            <div className={styles.choiceGrid}>
              {channels.map((channel) => {
                const selected = channelsSelected.includes(channel.key);
                return (
                  <button className={`${styles.choiceButton} ${selected ? styles.isSelected : ""}`} type="button" aria-pressed={selected} key={channel.key} onClick={() => toggleChannel(channel.key)}>
                    <span className={styles.choiceIcon}>{channel.icon}</span>
                    <span className={styles.choiceCopy}><strong>{channel.label}{channel.recommended ? <small className={styles.recommended}>推荐</small> : null}</strong><span>{channel.detail}</span></span>
                    <span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.channelMeta}><i />已选 {channelsSelected.length} 个渠道 · 系统会根据账号额度自动排程</div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>05</span>
                <div><h2>选择文章表达</h2><p>你可以指定倾向，也可以让系统按问题自动组合。</p></div>
              </div>
            </div>
            <div className={styles.choiceGrid}>
              {expressions.map((item) => {
                const selected = expression === item.key;
                return (
                  <button className={`${styles.choiceButton} ${selected ? styles.isSelected : ""}`} type="button" aria-pressed={selected} key={item.key} onClick={() => setExpression(item.key)}>
                    <span className={styles.choiceIcon}>{item.icon}</span>
                    <span className={styles.choiceCopy}><strong>{item.label}{item.key === "recommended" ? <small className={styles.recommended}>默认</small> : null}</strong><span>{item.detail}</span></span>
                    <span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className={styles.submitBar}>
            <span className={styles.submitHint}>提交后可以关闭页面。系统会在完成发布、获得公开 URL 或遇到必须判断的问题时发邮件。</span>
            <Button className={styles.submitButton} type="primary" size="large" loading={submitting} onClick={submitTask} icon={!submitting ? <ArrowRightOutlined /> : undefined}>交给系统处理</Button>
          </div>
          {error ? <div role="alert" style={{ marginTop: 12, color: "#a34836", fontSize: 12 }}>{error}</div> : null}
        </div>

        <aside className={styles.receipt} aria-label="托管回执预览">
          <div className={styles.receiptHeader}>
            <div><span className={styles.receiptKicker}>HANDOFF RECEIPT</span><h2>本次托管</h2><p>提交前，确认系统理解的是这件事。</p></div>
            <span className={styles.receiptStamp}><SafetyCertificateOutlined /></span>
          </div>
          <div className={styles.receiptBody}>
            <div className={styles.receiptSection}>
              <dl>
                <div className={styles.receiptRow}><dt>推广产品</dt><dd className={!selectedProductId && !isAddingNew ? styles.receiptEmpty : ""}>{displayProductName}</dd></div>
                <div className={styles.receiptRow}><dt>资料状态</dt><dd className="wrap">{displayMaterialCount}</dd></div>
                <div className={styles.receiptRow}><dt>发布渠道</dt><dd className="wrap">{selectedChannelLabels.length ? selectedChannelLabels.join("、") : "尚未选择"}</dd></div>
                <div className={styles.receiptRow}><dt>文章表达</dt><dd>{expressionLabel}</dd></div>
                <div className={styles.receiptRow}><dt>结果邮箱</dt><dd>{email || "尚未填写"}</dd></div>
              </dl>
            </div>
            <div className={styles.receiptSection}>
              <div className={styles.receiptNote}><strong>系统会自动完成</strong><br />资料整理、文章批量生产、渠道发布、公开 URL 回传，以及 24h / 72h 效果测试。</div>
            </div>
          </div>
          <div className={styles.receiptFooter}>执行周期：2026 年 8 月 · 默认只在需要你判断时打扰</div>
        </aside>
      </div>
    </div>
  );
}
