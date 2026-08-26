"use client";

import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CodeOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  LockOutlined,
  LogoutOutlined,
  MailOutlined,
  PlusOutlined,
  ReadOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UploadOutlined,
  UserOutlined,
  WechatOutlined
} from "@ant-design/icons";
import { Button, Input, InputNumber, Spin, Switch } from "antd";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./hosted-mode.module.css";

const HostedConnectionsWorkspace = dynamic(
  () => import("./hosted/connections/HostedConnectionsWorkspace").then((module) => module.HostedConnectionsWorkspace),
  {
    ssr: false,
    loading: () => <div className={styles.embeddedConnectionLoading}><Spin /><span>正在加载安全账号连接向导</span></div>
  }
);

interface HostedIdentity {
  email: string;
  workspaceId: string;
  role: "workspace_admin" | "product_owner" | "operator" | "viewer";
}

interface HostedProduct {
  productId: string;
  displayName: string;
  officialUrl?: string;
  productCategory?: string;
  strategyPackId?: string;
}

type ChannelCapability = "auto_publish" | "draft_only" | "unsupported";
type AuthorizationStatus = "connected" | "required" | "not_applicable" | "unavailable";
type AuthorizationPhase = "system_setup" | "needs_login" | "manual_takeover_required" | "needs_account_confirmation" | "connected";

interface ChannelOption {
  channel: string;
  capability: ChannelCapability;
  authorizationStatus: AuthorizationStatus;
  authorizationPhase?: AuthorizationPhase;
  accountCandidate?: string;
  accountCandidateLabel?: string;
  accountBindingVersion?: number;
  accountLabel?: string;
  detail: string;
  nextAction?: string;
}

interface HostedOrder {
  orderId: string;
  productId: string;
  productName: string;
  status: string;
  rowVersion: number;
  channels: Array<{ channel: string; dailyCap?: number }>;
  dailyCaps: Record<string, number>;
  notificationPreferences: { dailyDigest: boolean; monthlyCompleted: boolean };
  materialSummary?: {
    officialUrl?: string;
    fileNames: string[];
    acceptedSourceCount: number;
    importStatus: string;
  };
}

interface ChannelPresentation {
  label: string;
  icon: ReactNode;
}

interface BrowserConnectionSummary {
  total: number;
  connected: number;
}

type IdentityStatus = "checking" | "anonymous" | "authenticated";
type StepState = "done" | "active" | "locked" | "waiting";

const channelPresentation: Record<string, ChannelPresentation> = {
  wechat: { label: "微信公众号", icon: <WechatOutlined /> },
  zhihu: { label: "知乎", icon: <ReadOutlined /> },
  csdn: { label: "CSDN", icon: <CodeOutlined /> },
  juejin: { label: "掘金", icon: <GlobalOutlined /> }
};

const browserChannels = new Set(["zhihu", "csdn", "juejin"]);
const roleLabels: Record<HostedIdentity["role"], string> = {
  workspace_admin: "工作区管理员",
  product_owner: "产品负责人",
  operator: "运营人员",
  viewer: "查看者"
};
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function materialIcon(name: string) {
  return name.toLowerCase().endsWith(".pdf") ? <FilePdfOutlined /> : <FileTextOutlined />;
}

function readApiError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const nextAction = String(record.nextAction || nested.nextAction || "").trim();
  const message = String(record.message || nested.message || fallback);
  return nextAction && !message.includes(nextAction) ? `${message} ${nextAction}` : message;
}

function SetupGuide({
  title,
  summary,
  steps,
  note,
  defaultOpen = false
}: {
  title: string;
  summary: string;
  steps: string[];
  note?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  return (
    <details className={styles.setupGuide} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><InfoCircleOutlined /><span><strong>{title}</strong><small>{summary}</small></span><b>{open ? "收起" : "展开"}</b></summary>
      <div className={styles.setupGuideBody}>
        <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
        {note ? <p>{note}</p> : null}
      </div>
    </details>
  );
}

function LockedStep({ reason, nextAction }: { reason: string; nextAction: string }) {
  return (
    <div className={styles.lockedStep}>
      <LockOutlined />
      <div><strong>{reason}</strong><span>{nextAction}</span></div>
    </div>
  );
}

function StepStatusBadge({ state }: { state: StepState }) {
  const copy: Record<StepState, string> = { done: "已完成", active: "现在处理", locked: "等待前置步骤", waiting: "发布前完成" };
  return <span className={`${styles.stepStatusBadge} ${styles[`stepStatus-${state}`]}`}>{state === "done" ? <CheckOutlined /> : null}{copy[state]}</span>;
}

export default function HostedTaskPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>("checking");
  const [identity, setIdentity] = useState<HostedIdentity>();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSending, setLoginSending] = useState(false);
  const [loginSent, setLoginSent] = useState(false);
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
  const [dailyDigest, setDailyDigest] = useState(true);
  const [monthlyCompleted, setMonthlyCompleted] = useState(true);
  const [order, setOrder] = useState<HostedOrder>();
  const [browserConnectionSummary, setBrowserConnectionSummary] = useState<BrowserConnectionSummary>({ total: 0, connected: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmingWechat, setConfirmingWechat] = useState(false);
  const [notice, setNotice] = useState<string>();
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

  const loadBrowserConnectionSummary = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(orderId)}/channel-connections`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { channels?: Array<{ connection?: { authorizationStatus?: string } }> };
      if (!response.ok) throw new Error(readApiError(payload, "发布账号状态读取失败。"));
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      setBrowserConnectionSummary({
        total: channels.length,
        connected: channels.filter((item) => item.connection?.authorizationStatus === "connected").length
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布账号状态读取失败。");
    }
  }, []);

  useEffect(() => {
    let active = true;
    let sessionEstablished = false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("loginError") || params.get("error")) setError("登录链接无效、已使用或已过期，请重新获取。");

    void fetch("/api/v5/hosted/auth/session", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (active) {
          setIdentityStatus("anonymous");
          setProductsLoading(false);
          setChannelsLoading(false);
        }
        return;
      }
      if (!response.ok) throw new Error(readApiError(payload, "登录状态读取失败。"));
      const nextIdentity = payload.identity as HostedIdentity;
      if (!active) return;
      sessionEstablished = true;
      setIdentity(nextIdentity);
      setIdentityStatus("authenticated");
      setLoginEmail(nextIdentity.email);

      const targetOrderId = params.get("orderId")?.trim() || "";
      const productsPromise = fetch("/api/v5/hosted/products", { cache: "no-store" }).then(async (productsResponse) => {
        const productsPayload = await productsResponse.json();
        if (!productsResponse.ok) throw new Error(readApiError(productsPayload, "产品读取失败。"));
        return Array.isArray(productsPayload.products) ? productsPayload.products as HostedProduct[] : [];
      });
      const orderPromise = targetOrderId
        ? fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}`, { cache: "no-store" }).then(async (orderResponse) => {
            const orderPayload = await orderResponse.json();
            if (!orderResponse.ok) throw new Error(readApiError(orderPayload, "已创建的托管任务读取失败。"));
            return orderPayload.order as HostedOrder;
          })
        : Promise.resolve(undefined);
      const [items, existingOrder] = await Promise.all([productsPromise, orderPromise]);
      if (!active) return;
      setProducts(items);
      setProductsLoading(false);
      if (existingOrder) {
        setOrder(existingOrder);
        setSelectedProductId(existingOrder.productId);
        setIsAddingNew(false);
        setSelectedChannels(existingOrder.channels.map((item) => item.channel));
        setCustomCaps(existingOrder.dailyCaps || {});
        setDailyDigest(existingOrder.notificationPreferences?.dailyDigest !== false);
        setMonthlyCompleted(existingOrder.notificationPreferences?.monthlyCompleted !== false);
        await Promise.all([loadChannels(existingOrder.productId), loadBrowserConnectionSummary(existingOrder.orderId)]);
      } else {
        await loadChannels();
      }
    }).catch((cause) => {
      if (!active) return;
      if (!sessionEstablished) setIdentityStatus("anonymous");
      setProductsLoading(false);
      setChannelsLoading(false);
      setError(cause instanceof Error ? cause.message : "托管入口暂时不可用。");
    });
    return () => { active = false; };
  }, [loadBrowserConnectionSummary, loadChannels]);

  const selectedProduct = useMemo(() => products.find((product) => product.productId === selectedProductId), [products, selectedProductId]);
  const selectedOptionMap = useMemo(() => new Map(channelOptions.map((item) => [item.channel, item])), [channelOptions]);
  const selectedChannelLabels = useMemo(() => selectedChannels.map((key) => channelPresentation[key]?.label || key), [selectedChannels]);
  const selectedBrowserChannelCount = selectedChannels.filter((channel) => browserChannels.has(channel)).length;
  const wechatOption = selectedOptionMap.get("wechat");
  const wechatReady = !selectedChannels.includes("wechat") || wechatOption?.authorizationStatus === "connected";
  const browserConnectionsReady = selectedBrowserChannelCount === 0
    || browserConnectionSummary.total === selectedBrowserChannelCount && browserConnectionSummary.connected === selectedBrowserChannelCount;
  const productInputReady = Boolean(selectedProductId || productName.trim());
  const materialInputReady = Boolean(selectedProductId || officialUrl.trim() || files.length);
  const channelsReady = selectedChannels.length > 0;
  const identityReady = identityStatus === "authenticated";
  const canManage = identity?.role === "workspace_admin" || identity?.role === "product_owner";
  const researchReady = Boolean(order);
  const publishReady = Boolean(order && wechatReady && browserConnectionsReady);
  const currentStep = !identityReady ? 1 : !productInputReady || !materialInputReady ? 2 : !channelsReady ? 3 : !order ? 4 : !publishReady ? 5 : 6;

  const stepRows: Array<{ number: number; label: string; state: StepState }> = [
    { number: 1, label: "工作邮箱登录", state: identityReady ? "done" : "active" },
    { number: 2, label: "产品与资料", state: order || productInputReady && materialInputReady ? "done" : identityReady ? "active" : "locked" },
    { number: 3, label: "渠道与发布频率", state: channelsReady ? "done" : identityReady && productInputReady && materialInputReady ? "active" : "locked" },
    { number: 4, label: "通知与确认委托", state: order ? "done" : channelsReady ? "active" : "locked" },
    { number: 5, label: "发布账号连接", state: publishReady ? "done" : order ? "waiting" : "locked" },
    { number: 6, label: "就绪检查与后续", state: publishReady ? "done" : order ? "waiting" : "locked" }
  ];

  function selectProduct(product: HostedProduct) {
    if (order) return;
    setSelectedProductId(product.productId);
    setIsAddingNew(false);
    setProductName("");
    setOfficialUrl("");
    setFiles([]);
    setError(undefined);
    void loadChannels(product.productId);
  }

  function startAddingNew() {
    if (order) return;
    setSelectedProductId("");
    setIsAddingNew(true);
    setError(undefined);
    void loadChannels();
  }

  function addFiles(fileList: FileList | File[]) {
    if (order) return;
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
    setSelectedChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
    setNotice(undefined);
  }

  async function requestLogin() {
    if (!EMAIL_PATTERN.test(loginEmail.trim())) return setError("请输入有效的工作邮箱地址。");
    setLoginSending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v5/hosted/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim() })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiError(payload, "登录邮件发送失败。"));
      setLoginSent(true);
      setNotice("登录链接已发送。打开邮件后会自动回到这张配置页。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录邮件发送失败，请稍后重试。");
    } finally {
      setLoginSending(false);
    }
  }

  async function logout() {
    await fetch("/api/v5/hosted/auth/logout", { method: "POST" }).catch(() => undefined);
    window.history.replaceState(null, "", "/");
    setIdentity(undefined);
    setIdentityStatus("anonymous");
    setOrder(undefined);
    setProducts([]);
    setSelectedProductId("");
    setSelectedChannels([]);
    setBrowserConnectionSummary({ total: 0, connected: 0 });
    setLoginSent(false);
    setNotice("已安全退出。如需继续，请重新使用工作邮箱登录。");
  }

  async function persistOrderSettings(targetOrder: HostedOrder) {
    const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrder.orderId)}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": `hosted-settings-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: targetOrder.rowVersion,
        channels: selectedChannels.map((channel) => ({ channel, ...(customCaps[channel] ? { dailyCap: customCaps[channel] } : {}) })),
        dailyDigest,
        monthlyCompleted
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(readApiError(payload, "渠道与通知设置保存失败。"));
    return payload.order as HostedOrder;
  }

  async function submitTask() {
    if (!identity) return setError("请先完成第 1 步邮箱登录。");
    if (!selectedProductId && !productName.trim()) return setError("请填写产品名称，或选择已有产品。");
    if (isAddingNew && !officialUrl.trim() && !files.length) return setError("请至少提供产品官网或一份产品资料。");
    if (!selectedChannels.length) return setError("请至少选择一个可托管的推广渠道。");
    setSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const idempotencyKey = `hosted-submit-${crypto.randomUUID()}`;
      const formData = new FormData();
      if (selectedProductId) formData.set("productId", selectedProductId);
      if (productName.trim()) formData.set("productName", productName.trim());
      if (officialUrl.trim()) formData.set("officialUrl", officialUrl.trim());
      formData.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai");
      formData.set("idempotencyKey", idempotencyKey);
      formData.set("channels", JSON.stringify(selectedChannels.map((channel) => ({ channel, ...(customCaps[channel] ? { dailyCap: customCaps[channel] } : {}) }))));
      for (const file of files) formData.append("files", file);
      const response = await fetch("/api/v5/hosted/orders", { method: "POST", headers: { "x-idempotency-key": idempotencyKey }, body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiError(payload, "托管任务提交失败。"));
      let nextOrder = payload.order as HostedOrder;
      setOrder(nextOrder);
      setSelectedProductId(nextOrder.productId);
      setIsAddingNew(false);
      window.history.replaceState(null, "", `/?orderId=${encodeURIComponent(nextOrder.orderId)}`);
      try {
        nextOrder = await persistOrderSettings(nextOrder);
        setOrder(nextOrder);
      } catch (settingsError) {
        setError(`委托已创建，但通知偏好暂未保存。${settingsError instanceof Error ? settingsError.message : "请在本页重试。"}`);
      }
      await Promise.all([loadChannels(nextOrder.productId), loadBrowserConnectionSummary(nextOrder.orderId)]);
      setNotice("委托已创建，系统已开始处理资料。请继续完成第 5 步发布账号连接。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "托管任务提交失败。请检查资料后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSettings() {
    if (!order || !selectedChannels.length) return setError("至少保留一个托管渠道。");
    setSavingSettings(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const savedOrder = await persistOrderSettings(order);
      setOrder(savedOrder);
      await Promise.all([loadChannels(savedOrder.productId), loadBrowserConnectionSummary(savedOrder.orderId)]);
      setNotice("渠道、每日上限与邮件通知设置已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置保存失败。请刷新后重试。");
    } finally {
      setSavingSettings(false);
    }
  }

  async function confirmWechatAccount() {
    if (!order || !wechatOption?.accountCandidate) return;
    setConfirmingWechat(true);
    setError(undefined);
    try {
      const idempotencyKey = `hosted-account-${order.orderId}-wechat-${crypto.randomUUID()}`;
      const response = await fetch(`/api/v5/products/${encodeURIComponent(order.productId)}/publish-account-binding`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ platform: "wechat", accountLabel: wechatOption.accountCandidate, expectedVersion: wechatOption.accountBindingVersion || 0, idempotencyKey })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiError(payload, "公众号确认失败。"));
      await loadChannels(order.productId);
      setNotice("微信公众号已确认给当前产品使用。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公众号确认失败。请刷新后重试。");
    } finally {
      setConfirmingWechat(false);
    }
  }

  const displayProductName = order?.productName || selectedProduct?.displayName || productName.trim() || "尚未填写";
  const materialLabel = order
    ? order.materialSummary?.acceptedSourceCount ? `${order.materialSummary.acceptedSourceCount} 个资料来源已接收` : "已提交，系统正在处理"
    : selectedProduct
      ? (files.length || officialUrl ? `${files.length} 份新文件${officialUrl ? " + 官网" : ""}` : "沿用已治理资料")
      : `${files.length} 份文件${officialUrl ? " + 官网" : ""}`;

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div><div className={styles.kicker}>JOTO / GUIDED MANAGED SETUP</div><h1>一次配置，托管你后续的GEO品牌推广。</h1></div>
        <aside className={styles.introAside}><strong>当前进度：第 {currentStep} / 6 步</strong><span>{researchReady ? "调研已经开始；发布账号可以在正式发布前继续补齐。" : "先完成登录、产品资料、渠道和通知设置，即可开始调研。"}</span><small>文字教程可随时展开或收起</small></aside>
      </section>

      {error || notice ? <div className={`${styles.setupFeedbackDock} ${error ? styles.setupFeedbackError : styles.setupFeedbackSuccess}`} role={error ? "alert" : "status"}><span>{error ? <InfoCircleOutlined /> : <CheckCircleFilled />}</span><div><strong>{error ? "当前操作未完成" : "操作已生效"}</strong><small>{error || notice}</small></div><Button type="text" size="small" onClick={() => { setError(undefined); setNotice(undefined); }}>关闭</Button></div> : null}

      <div className={styles.workspace}>
        <div className={styles.formColumn}>
          <section className={styles.section} id="setup-identity">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>01</span><div><h2>用工作邮箱登录</h2><p>不设密码，邮件里的一次性链接就是登录凭证。</p></div></div><StepStatusBadge state={stepRows[0].state} /></div>
            <SetupGuide title="详细操作教程" summary="第一次使用大约需要 1 分钟" defaultOpen={!identityReady} steps={["在下方输入你常用、能正常收信的工作邮箱。", "点击“发送登录链接”，然后去收件箱查找主题含 JOTO 的邮件。", "在 15 分钟内打开邮件中的链接。链接只能用一次。", "验证成功后会自动回到本页，并解锁第 2 步。"]} note="收不到邮件时，先查看垃圾邮件；仍然没有时再点一次发送。不要把登录链接转发给别人。" />
            {identityStatus === "checking" ? <div className={styles.inlineLoading}><Spin size="small" /> 正在检查当前登录状态</div> : identity ? <div className={styles.accountRow}><div className={styles.accountIdentity}><span className={styles.mailMark}><UserOutlined /></span><span><strong>{identity.email}</strong><span>{roleLabels[identity.role]} · 登录已验证</span></span></div><Button type="text" icon={<LogoutOutlined />} onClick={logout}>退出或更换账号</Button></div> : loginSent ? <div className={styles.loginSentCard}><CheckCircleFilled /><div><strong>登录邮件已发送到 {loginEmail}</strong><span>请在 15 分钟内打开邮件链接。完成后会自动回到这里。</span></div><Button onClick={() => setLoginSent(false)}>更换邮箱或重新发送</Button></div> : <div className={styles.inlineLoginForm}><label><span>工作邮箱</span><Input size="large" prefix={<MailOutlined />} value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} onPressEnter={requestLogin} placeholder="name@company.com" /></label><Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={loginSending} onClick={requestLogin}>发送登录链接</Button></div>}
          </section>

          <section className={styles.section} id="setup-product">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>02</span><div><h2>提供产品资料</h2><p>官网和文件是系统撰写内容时的事实依据。</p></div></div><StepStatusBadge state={stepRows[1].state} /></div>
            <SetupGuide title="怎么选、怎么填" summary="有旧产品直接点选；新产品至少提供官网或一份资料" defaultOpen={identityReady && currentStep === 2} steps={["如果页面中已有你的产品，直接点击产品卡片，无需重复上传资料。", "如果是新产品，点击“新增产品”，填写对外使用的正式名称。", "优先填写产品官网；如官网信息不完整，再上传 PDF、Word、PPT 等公开推广资料。", "检查文件中没有内部密钥、客户隐私或不允许对外的内容。"]} note="最多 10 份文件，单个不超过 20 MB。资料越真实、越聚焦，后续策略和正文越可靠。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="登录后，系统才能读取当前工作区已有的产品。" /> : productsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在读取已有产品</div> : <><div className={styles.productGrid}>{products.map((product) => { const selected = product.productId === selectedProductId; return <button className={`${styles.productCard} ${selected ? styles.isSelected : ""}`} type="button" disabled={Boolean(order)} aria-pressed={selected} key={product.productId} onClick={() => selectProduct(product)}><span className={styles.productIcon}><AppstoreOutlined /></span><span className={styles.productCopy}><strong>{product.displayName}</strong><span>{product.productCategory || product.officialUrl || "已有产品资料"}</span><small className={`${styles.knowledgeBadge} ${styles[product.strategyPackId ? "knowledge-ready" : "knowledge-building"]}`}>{product.strategyPackId ? "策略资料已建立" : "可继续补充资料"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>; })}<button className={`${styles.productCard} ${styles.addProductCard} ${isAddingNew ? styles.isSelected : ""}`} type="button" disabled={Boolean(order)} aria-pressed={isAddingNew} onClick={startAddingNew}><span className={`${styles.productIcon} ${styles.addProductIcon}`}><PlusOutlined /></span><span className={styles.productCopy}><strong>新增产品</strong><span>填写官网并上传公开推广资料</span></span><span className={styles.selectionMark}>{isAddingNew ? <CheckOutlined /> : null}</span></button></div>{isAddingNew || selectedProduct ? <div className={styles.newProductForm}>{isAddingNew ? <div className={styles.newProductField}><label>产品名称</label><Input disabled={Boolean(order)} value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：WorkBuddy" size="large" /></div> : null}<div className={styles.newProductField}><label>产品官网{selectedProduct ? "（有更新时填写）" : ""}</label><Input disabled={Boolean(order)} value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} placeholder={selectedProduct?.officialUrl || "https://example.com/product"} prefix={<LinkOutlined />} size="large" /></div><div className={styles.newProductField}><label>产品资料{selectedProduct ? "（可选补充）" : ""}</label><label className={`${styles.dropzone} ${styles.compactDropzone} ${dragging ? styles.isDragging : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!order) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}><input ref={fileInputRef} disabled={Boolean(order)} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md" onChange={(event) => event.target.files && addFiles(event.target.files)} /><span className={styles.uploadIcon}><UploadOutlined /></span><strong>{order ? "资料已随委托提交" : "拖入资料，或点击选择"}</strong><span>{order ? "新的补充资料请新建一项委托" : "最多 10 份，单个文件不超过 20 MB"}</span></label>{files.length ? <div className={styles.fileList}>{files.map((file) => <div className={styles.fileItem} key={`${file.name}:${file.size}:${file.lastModified}`}>{materialIcon(file.name)}<span>{file.name}</span><small>{formatSize(file.size)}</small>{!order ? <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} /> : null}</div>)}</div> : null}</div></div> : null}</>}
          </section>

          <section className={styles.section} id="setup-channels">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>03</span><div><h2>选择渠道与每日上限</h2><p>只选你确定要运营的渠道；账号登录在第 5 步完成。</p></div></div><StepStatusBadge state={stepRows[2].state} /></div>
            <SetupGuide title="渠道选择和频率设置教程" summary="点卡片选中；需要控制数量时再展开高级设置" defaultOpen={identityReady && currentStep === 3} steps={["点击渠道卡片即可选中，再点一次取消。灰色卡片表示系统能力尚未开通。", "“已连接”表示可直接使用；“需连接账号”表示选完后还要去第 5 步登录平台。", "没有特殊要求时，保留系统安全上限即可，不需要填数字。", "如果想降低每日发布量，展开“自定义每日上限”，为已选渠道填写 1–100 的整数。"]} note="每日上限只能比系统安全上限更保守，不会绕过平台规则。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="系统会在登录后检查当前可用的托管渠道。" /> : channelsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在核对渠道能力</div> : <><div className={styles.choiceGrid}>{channelOptions.map((option) => { const selected = selectedChannels.includes(option.channel); const disabled = option.capability === "unsupported"; const presentation = channelPresentation[option.channel] || { label: option.channel, icon: <GlobalOutlined /> }; return <button className={`${styles.choiceButton} ${selected ? styles.isSelected : ""} ${disabled ? styles.isDisabled : ""}`} type="button" aria-pressed={selected} aria-disabled={disabled} disabled={disabled} key={option.channel} onClick={() => toggleChannel(option.channel)}><span className={styles.choiceIcon}>{presentation.icon}</span><span className={styles.choiceCopy}><strong>{presentation.label}</strong><span>{option.detail}</span><small className={`${styles.capabilityBadge} ${styles[`capability-${option.authorizationStatus}`]}`}>{option.authorizationStatus === "connected" ? "已连接" : option.authorizationStatus === "required" ? "需连接账号" : "暂不可托管"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>; })}</div>{selectedChannels.some((key) => selectedOptionMap.get(key)?.authorizationStatus === "required") ? <div className={styles.actionNotice}><SettingOutlined /><span>这不会阻止系统先开始调研。委托创建后，继续在本页第 5 步完成账号连接即可。</span></div> : null}<button className={styles.advancedToggle} type="button" onClick={() => setShowAdvanced((current) => !current)}><SettingOutlined /> {showAdvanced ? "收起每日上限" : "高级：自定义每日上限"}</button>{showAdvanced ? <div className={styles.capGrid}>{selectedChannels.map((channel) => <label key={channel}><span>{channelPresentation[channel]?.label || channel}</span><InputNumber min={1} max={100} value={customCaps[channel]} placeholder="系统上限" onChange={(value) => setCustomCaps((current) => ({ ...current, [channel]: value || undefined }))} /><small>篇 / 日</small></label>)}</div> : null}</>}
          </section>

          <section className={styles.section} id="setup-notifications">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>04</span><div><h2>确认通知方式并创建委托</h2><p>需要你判断的事和公开 URL，都会发到登录邮箱。</p></div></div><StepStatusBadge state={stepRows[3].state} /></div>
            <SetupGuide title="通知和提交前检查" summary="确认收信邮箱、选择汇总邮件，然后创建委托" defaultOpen={identityReady && currentStep === 4} steps={["确认下方邮箱是你本人可以长期收信的地址。它与登录邮箱一致，如需更换请先退出并换邮箱登录。", "保留“每日 URL 汇总”，当天发布结束后只收一封汇总，不会逐篇打扰。", "保留“月度完成通知”，MonthlyReview 形成后会收到当月结果。", "最后检查右侧“配置通行证”，然后点击“确认委托，开始调研”。"]} note="GEO 策略、代表样文和异常通知是必要邮件，不能关闭；可关闭的只是日报和月度完成提醒。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="登录邮箱会自动成为通知邮箱，不需要重复输入。" /> : !canManage ? <LockedStep reason="当前角色只能查看，不能创建或修改托管委托" nextAction="请让工作区管理员或产品负责人完成本步。" /> : <><div className={styles.notificationEmail}><MailOutlined /><div><strong>{identity?.email}</strong><span>登录、重要确认和发布结果使用同一邮箱</span></div><small>已验证</small></div><div className={styles.notificationGrid}><label><span><strong>每日 URL 汇总</strong><small>当日批次结束后发一封</small></span><Switch checked={dailyDigest} onChange={setDailyDigest} /></label><label><span><strong>月度完成通知</strong><small>MonthlyReview 形成后发送</small></span><Switch checked={monthlyCompleted} onChange={setMonthlyCompleted} /></label></div>{order ? <div className={styles.submitBar}><span className={styles.submitHint}>修改渠道、每日上限或通知偏好后，点击保存才会生效。</span><Button className={styles.submitButton} type="primary" size="large" icon={<CheckOutlined />} loading={savingSettings} onClick={saveSettings}>保存渠道与通知设置</Button></div> : <div className={styles.submitBar}><span className={styles.submitHint}>点击即确认这些资料可以用于公开推广。策略和样文仍必须由你本人确认。</span><Button className={styles.submitButton} type="primary" size="large" loading={submitting} disabled={!productInputReady || !materialInputReady || !channelsReady} onClick={submitTask} icon={!submitting ? <ArrowRightOutlined /> : undefined}>确认委托，开始调研</Button></div>}</>}
          </section>

          <section className={styles.section} id="setup-accounts">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>05</span><div><h2>连接正式发布账号</h2><p>调研可以先运行；正式发布前，已选渠道必须全部确认。</p></div></div><StepStatusBadge state={stepRows[4].state} /></div>
            <SetupGuide title="发布账号连接完整教程" summary="公众号走官方能力；知乎、CSDN、掘金逐个登录并确认昵称" defaultOpen={Boolean(order) && currentStep === 5} steps={["微信公众号：先由部署管理员在公众平台获取 AppID / AppSecret 并写入安全环境，然后你在本页确认系统识别到的公众号名称。", "知乎、CSDN、掘金：先选“云端托管”或“私有化 Connector”。不确定时优先选云端托管。", "点击“连接”后，只在平台官方页面输入账号信息。验证码、手机确认或安全挑战必须由你本人完成。", "系统识别到公开昵称和主页后，请仔细核对，再点击“确认用于当前产品”。", "完成后每个渠道都应显示“已连接”。系统以后每次发布前都会再次核对账号。"]} note="不要在本页、聊天、文档或工单中粘贴 Cookie、Token、AppSecret 或平台密码。" />
            {!order ? <LockedStep reason="先完成第 4 步并创建委托" nextAction="发布账号需要绑定到具体产品和工作区，因此必须在委托创建后连接。" /> : <div className={styles.accountSetupStack}>{selectedChannels.includes("wechat") ? <div className={`${styles.platformSetupCard} ${wechatReady ? styles.platformSetupReady : ""}`}><span className={styles.platformSetupIcon}><WechatOutlined /></span><div className={styles.platformSetupCopy}><strong>微信公众号</strong><span>{wechatOption?.detail || "正在检查公众号官方能力。"}</span><small>{wechatReady ? `已连接 ${wechatOption?.accountLabel || wechatOption?.accountCandidateLabel || "发布账号"}` : wechatOption?.nextAction || "由部署管理员完成官方发布能力配置。"}</small></div>{wechatReady ? <span className={styles.platformSetupCheck}><CheckOutlined /></span> : wechatOption?.authorizationPhase === "needs_account_confirmation" && wechatOption.accountCandidate ? <Button type="primary" loading={confirmingWechat} onClick={confirmWechatAccount}>确认使用 {wechatOption.accountCandidateLabel || "此公众号"}</Button> : <Button icon={<ReloadOutlined />} onClick={() => loadChannels(order.productId)}>我已配置，重新检查</Button>}</div> : null}{selectedBrowserChannelCount ? <HostedConnectionsWorkspace embedded embeddedOrderId={order.orderId} onConnectionsChanged={() => void Promise.all([loadBrowserConnectionSummary(order.orderId), loadChannels(order.productId)])} /> : <div className={styles.embeddedConnectionEmpty}><CheckCircleFilled /><div><strong>没有选择需要浏览器登录的渠道</strong><span>当前只需核对上方公众号状态。</span></div></div>}</div>}
          </section>

          <section className={styles.section} id="setup-ready">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>06</span><div><h2>检查就绪状态，了解后续操作</h2><p>调研就绪与发布就绪分开判断，不会因平台登录而浪费调研时间。</p></div></div><StepStatusBadge state={stepRows[5].state} /></div>
            <SetupGuide title="创建委托后，你还需要做什么" summary="只保留两次必要判断，其余默认自动运行" defaultOpen={Boolean(order) && currentStep === 6} steps={["系统先整理官网和文件，完成 GEO 调研。这一阶段可以关闭页面。", "GEO 策略准备好后，邮件会提醒你确认目标用户、核心表达、渠道和内容方向。", "策略通过后会生成一篇代表样文，你再确认一次。", "样文通过且发布账号全部就绪后，系统才会按 MonthlyPlan 生产、排程、发布并回传公开 URL。"]} note="登录失效、平台风控或事实冲突时系统会暂停对应动作，邮件会告诉你原因和恢复方法。" />
            {!order ? <LockedStep reason="创建委托后才能生成真实就绪检查" nextAction="现在请继续完成前面的必填步骤。" /> : <div className={styles.finalReadinessGrid}><div className={`${styles.finalReadinessCard} ${styles.isReady}`}><CheckCircleFilled /><div><strong>调研已就绪</strong><span>委托 {order.orderId} 已创建，资料处理与 GEO 调研已经开始。</span></div></div><div className={`${styles.finalReadinessCard} ${publishReady ? styles.isReady : styles.needsWork}`}>{publishReady ? <CheckCircleFilled /> : <SettingOutlined />}<div><strong>{publishReady ? "发布账号已就绪" : "发布前还有配置要完成"}</strong><span>{publishReady ? "所有已选渠道都有已确认的正式账号。" : `微信公众号：${wechatReady ? "已就绪" : "待配置"}；浏览器渠道：${browserConnectionSummary.connected}/${selectedBrowserChannelCount} 已连接。`}</span></div></div><div className={styles.finalReadinessActions}><Link href={`/hosted/success?orderId=${encodeURIComponent(order.orderId)}`}><Button type="primary" size="large">查看托管状态与调研进度</Button></Link><Button size="large" icon={<ReloadOutlined />} onClick={() => void Promise.all([loadChannels(order.productId), loadBrowserConnectionSummary(order.orderId)])}>重新检查全部状态</Button></div></div>}
          </section>

          <details className={styles.deploymentGuide}><summary><SafetyCertificateOutlined /><span><strong>部署管理员一次性准备</strong><small>普通使用者不需要处理；只在发邮件或连接渠道失败时展开</small></span></summary><div><p>管理员需要事先准备邮件投递、公开访问地址、发布执行节点与公众号官方能力。页面只显示就绪状态，不显示或收集密钥。</p><Link href="/hosted/email-sender">仅部署管理员：管理发件邮箱</Link></div></details>
        </div>

        <aside className={styles.receipt} aria-label="配置通行证">
          <div className={styles.receiptHeader}><div><span className={styles.receiptKicker}>SETUP PASSPORT</span><h2>配置通行证</h2><p>不用记路径，只看哪一步还没有绿。</p></div><span className={styles.receiptStamp}><SafetyCertificateOutlined /></span></div>
          <div className={styles.receiptBody}><div className={styles.setupPassportSteps}>{stepRows.map((step) => <a href={`#setup-${["identity", "product", "channels", "notifications", "accounts", "ready"][step.number - 1]}`} className={`${styles.setupPassportStep} ${styles[`passport-${step.state}`]}`} key={step.number}><span>{step.state === "done" ? <CheckOutlined /> : step.number}</span><strong>{step.label}</strong><small>{step.state === "done" ? "已完成" : step.number === currentStep ? "现在处理" : step.state === "waiting" ? "发布前完成" : "等待前置"}</small></a>)}</div><div className={styles.receiptSection}><dl><div className={styles.receiptRow}><dt>登录账号</dt><dd>{identity?.email || "尚未登录"}</dd></div><div className={styles.receiptRow}><dt>推广产品</dt><dd>{displayProductName}</dd></div><div className={styles.receiptRow}><dt>产品资料</dt><dd className={styles.wrap}>{materialLabel || "尚未添加"}</dd></div><div className={styles.receiptRow}><dt>推广渠道</dt><dd className={styles.wrap}>{selectedChannelLabels.length ? selectedChannelLabels.join("、") : "尚未选择"}</dd></div></dl></div><div className={styles.receiptSection}><div className={styles.readinessStampGrid}><div className={researchReady ? styles.readinessReady : styles.readinessWaiting}><span>{researchReady ? <CheckOutlined /> : <LockOutlined />}</span><strong>调研就绪</strong><small>{researchReady ? "已开始" : "完成 1–4 步"}</small></div><div className={publishReady ? styles.readinessReady : styles.readinessWaiting}><span>{publishReady ? <CheckOutlined /> : <LockOutlined />}</span><strong>发布就绪</strong><small>{publishReady ? "账号已齐" : "完成第 5 步"}</small></div></div></div><div className={styles.receiptSection}><div className={styles.receiptNote}><strong>你只保留核心判断</strong><br />策略确认一次、代表样文确认一次。正常运行后不需要每天操作。</div></div></div>
          <div className={styles.receiptFooter}>执行周期：当前日历月 · 日期只是 MonthlyPlan 下的执行视图</div>
        </aside>
      </div>
    </div>
  );
}
