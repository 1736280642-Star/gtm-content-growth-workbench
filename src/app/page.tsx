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
  RobotOutlined,
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

const HostedAiCaptureRequestPanel = dynamic(
  () => import("@/components/HostedAiCaptureRequestPanel").then((module) => module.HostedAiCaptureRequestPanel),
  {
    ssr: false,
    loading: () => <div className={styles.embeddedConnectionLoading}><Spin /><span>正在加载 AI 前台请求面板</span></div>
  }
);

const HostedAiCaptureDeploymentGuide = dynamic(
  () => import("@/components/HostedAiCaptureDeploymentGuide").then((module) => module.HostedAiCaptureDeploymentGuide),
  {
    ssr: false,
    loading: () => <div className={styles.embeddedConnectionLoading}><Spin /><span>正在加载共享采集服务器控制台</span></div>
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

interface SenderSetupStatus {
  configured: boolean;
  provider?: string;
  senderHint?: string;
}

type IdentityStatus = "checking" | "anonymous" | "authenticated";
type StepState = "done" | "active" | "locked" | "waiting";
type PageAudience = "user" | "deployment";

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
  const [pageAudience, setPageAudience] = useState<PageAudience>("user");
  const [senderStatus, setSenderStatus] = useState<SenderSetupStatus>();
  const [senderStatusLoading, setSenderStatusLoading] = useState(true);
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
  const [aiFrontendEnabled, setAiFrontendEnabled] = useState<boolean>();
  const [order, setOrder] = useState<HostedOrder>();
  const [browserConnectionSummary, setBrowserConnectionSummary] = useState<BrowserConnectionSummary>({ total: 0, connected: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmingWechat, setConfirmingWechat] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const loadSenderStatus = useCallback(async () => {
    setSenderStatusLoading(true);
    try {
      const response = await fetch("/api/v5/hosted/email-sender", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readApiError(payload, "发件邮箱状态读取失败。"));
      setSenderStatus(payload.sender as SenderSetupStatus);
    } catch {
      setSenderStatus(undefined);
    } finally {
      setSenderStatusLoading(false);
    }
  }, []);

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
    if (params.get("role") === "deployment") setPageAudience("deployment");
    if (params.get("loginError") || params.get("error")) setError("登录链接无效、已使用或已过期，请重新获取。");

    void loadSenderStatus();

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
  }, [loadBrowserConnectionSummary, loadChannels, loadSenderStatus]);

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

  function switchAudience(nextAudience: PageAudience, anchor?: string) {
    setPageAudience(nextAudience);
    setError(undefined);
    setNotice(undefined);
    const url = new URL(window.location.href);
    if (nextAudience === "deployment") url.searchParams.set("role", "deployment");
    else url.searchParams.delete("role");
    url.hash = anchor || "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.requestAnimationFrame(() => {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function chooseAiFrontend(enabled: boolean) {
    setAiFrontendEnabled(enabled);
    if (!enabled) return;
    window.requestAnimationFrame(() => {
      document.getElementById("setup-ai-frontend")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

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
        <div><div className={styles.kicker}>JOTO / GUIDED MANAGED SETUP</div><h1>{pageAudience === "deployment" ? "先把系统发信跑通，再交给普通用户。" : "一次配置，托管你后续的GEO品牌推广。"}</h1></div>
        <aside className={styles.introAside}>{pageAudience === "deployment" ? <><strong>{senderStatus?.configured ? "系统发件邮箱已连接" : "现在处理：部署初始化"}</strong><span>{senderStatus?.configured ? "下一步切到普通用户，发送一封真实登录邮件完成验收。" : "先写入服务端安全参数，再连接一个系统发件邮箱。"}</span><small>只需部署人员操作一次</small></> : <><strong>当前进度：第 {currentStep} / 6 步</strong><span>{researchReady ? "调研已经开始；发布账号可以在正式发布前继续补齐。" : "先完成登录、产品资料、渠道和通知设置，即可开始调研。"}</span><small>文字教程可随时展开或收起</small></>}</aside>
      </section>

      <nav className={styles.roleSwitcher} aria-label="选择当前操作角色">
        <button type="button" aria-controls="role-panel-user" aria-pressed={pageAudience === "user"} className={pageAudience === "user" ? styles.roleSwitchActive : ""} onClick={() => switchAudience("user")}>
          <UserOutlined />
          <span><strong>我是普通用户</strong><small>登录、提交资料、查看托管进度</small></span>
          {pageAudience === "user" ? <CheckCircleFilled /> : <ArrowRightOutlined />}
        </button>
        <button type="button" aria-controls="role-panel-deployment" aria-pressed={pageAudience === "deployment"} className={pageAudience === "deployment" ? styles.roleSwitchActive : ""} onClick={() => switchAudience("deployment")}>
          <SafetyCertificateOutlined />
          <span><strong>我是部署人员</strong><small>配置系统发件邮箱、部署安全参数和 24h 共享采集服务器</small></span>
          {pageAudience === "deployment" ? <CheckCircleFilled /> : <ArrowRightOutlined />}
        </button>
      </nav>

      {error || notice ? <div className={`${styles.setupFeedbackDock} ${error ? styles.setupFeedbackError : styles.setupFeedbackSuccess}`} role={error ? "alert" : "status"}><span>{error ? <InfoCircleOutlined /> : <CheckCircleFilled />}</span><div><strong>{error ? "当前操作未完成" : "操作已生效"}</strong><small>{error || notice}</small></div><Button type="text" size="small" onClick={() => { setError(undefined); setNotice(undefined); }}>关闭</Button></div> : null}

      <div id="role-panel-deployment" className={styles.deploymentWorkspace} hidden={pageAudience !== "deployment"}>
        <div className={styles.deploymentMain}>
          <section className={styles.deploymentSection} id="deployment-security">
            <div className={styles.deploymentSectionHeader}><div><h2>准备服务端安全参数</h2><p>这一步只在部署机器上完成。普通用户看不到，也不需要填写任何 Token。</p></div><StepStatusBadge state="active" /></div>
            <SetupGuide
              title="照着填，不需要理解代码"
              summary="打开 .env.local，逐行加入所需配置项"
              defaultOpen
              steps={[
                "在项目根目录打开被 Git 忽略的 .env.local。不要把真实值写进聊天、截图或代码仓库。",
                "新增 HOSTED_EMAIL_SETUP_TOKEN，使用密码管理器生成至少 32 位随机值。稍后管理员授权邮箱时，需要在页面输入同一个值。",
                "新增 HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY。它不是从 Gmail 或 Vercel 领取的，请按下方命令在本机生成独立的 32 字节随机值。",
                "填写 HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL。本机使用 http://127.0.0.1:3027，线上使用正式 HTTPS 域名。",
                "如果使用 Gmail，填写 HOSTED_EMAIL_GOOGLE_CLIENT_ID / HOSTED_EMAIL_GOOGLE_CLIENT_SECRET；如果使用 Outlook，填写对应的 HOSTED_EMAIL_MICROSOFT_CLIENT_ID / CLIENT_SECRET。它们来自部署人员创建的 OAuth Web 应用。",
                "保存文件后运行 npm.cmd run docker:3027:deploy -- -NoOpen。看到 3027 健康检查通过，再继续下一步。"
              ]}
              note="Setup Token、加密密钥和 Google Client Secret 必须是三个不同的值。Gmail 登录密码或应用专用密码都不能替代它们。"
            />
            <div className={styles.deploymentVariables} aria-label="部署配置清单">
              <div><code>HOSTED_EMAIL_SETUP_TOKEN</code><span>管理员页面核对口令</span></div>
              <div><code>HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY</code><span>加密保存邮箱授权</span></div>
              <div><code>HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL</code><span>OAuth 授权返回域名</span></div>
              <div><code>HOSTED_EMAIL_GOOGLE_CLIENT_ID</code><span>Google OAuth 应用编号</span></div>
              <div><code>HOSTED_EMAIL_GOOGLE_CLIENT_SECRET</code><span>只保存在服务端</span></div>
              <div><code>HOSTED_EMAIL_MICROSOFT_CLIENT_ID</code><span>Microsoft OAuth 应用编号</span></div>
              <div><code>HOSTED_EMAIL_MICROSOFT_CLIENT_SECRET</code><span>只保存在服务端</span></div>
            </div>
            <div className={styles.credentialSourceGuide} aria-labelledby="credential-source-guide-title">
              <div className={styles.credentialSourceGuideHeader}>
                <LinkOutlined />
                <div><strong id="credential-source-guide-title">每个字段从哪里获得</strong><span>按要使用的邮箱选择对应入口。链接打开的都是供应商官方页面，生成的 Secret 只写入服务端环境变量。</span></div>
              </div>
              <div className={styles.credentialSourceGrid}>
                <article>
                  <span className={styles.credentialSourceLabel}>工作台自己生成</span>
                  <strong>Setup Token 与加密密钥</strong>
                  <dl>
                    <div><dt><code>HOSTED_EMAIL_SETUP_TOKEN</code></dt><dd>在项目终端运行：<code>{`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`}</code></dd></div>
                    <div><dt><code>HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY</code></dt><dd>在项目终端运行：<code>{`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}</code></dd></div>
                  </dl>
                  <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">打开 Vercel Dashboard 写入环境变量 <ArrowRightOutlined /></a>
                </article>
                <article>
                  <span className={styles.credentialSourceLabel}>部署域名</span>
                  <strong>OAuth 返回域名</strong>
                  <dl><div><dt><code>HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL</code></dt><dd>打开 Vercel 项目 → Settings → Domains，复制 Production 主域名，只保留 <code>https://域名</code>，末尾不要加斜杠。</dd></div></dl>
                  <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">打开 Vercel 项目列表 <ArrowRightOutlined /></a>
                </article>
                <article>
                  <span className={styles.credentialSourceLabel}>Gmail / Google Workspace</span>
                  <strong>Google OAuth Client</strong>
                  <dl>
                    <div><dt><code>HOSTED_EMAIL_GOOGLE_CLIENT_ID</code></dt><dd>Google Auth Platform → Clients → Create client → Web application；创建后复制 Client ID。</dd></div>
                    <div><dt><code>HOSTED_EMAIL_GOOGLE_CLIENT_SECRET</code></dt><dd>在同一个 Web client 详情页复制 Client secret，并立即保存到服务端。</dd></div>
                    <div><dt>Authorized redirect URI</dt><dd><code>{`<正式域名>/api/v5/hosted/email-sender/oauth/callback/gmail`}</code></dd></div>
                  </dl>
                  <div className={styles.credentialSourceActions}><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">打开 Google OAuth Clients <ArrowRightOutlined /></a><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">启用 Gmail API <ArrowRightOutlined /></a></div>
                </article>
                <article>
                  <span className={styles.credentialSourceLabel}>Outlook 个人邮箱</span>
                  <strong>Microsoft Entra OAuth App</strong>
                  <dl>
                    <div><dt><code>HOSTED_EMAIL_MICROSOFT_CLIENT_ID</code></dt><dd>App registrations → New registration；创建后在 Overview 复制 Application (client) ID。</dd></div>
                    <div><dt><code>HOSTED_EMAIL_MICROSOFT_CLIENT_SECRET</code></dt><dd>Certificates &amp; secrets → New client secret；复制 Value，不是 Secret ID。</dd></div>
                    <div><dt>Web redirect URI</dt><dd><code>{`<正式域名>/api/v5/hosted/email-sender/oauth/callback/outlook`}</code></dd></div>
                  </dl>
                  <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">打开 Microsoft App registrations <ArrowRightOutlined /></a>
                </article>
              </div>
              <p><InfoCircleOutlined /> 环境变量新增或修改后不会作用于旧部署。保存后必须重新部署最新的 main，再进入下一步授权邮箱。</p>
            </div>
            <div className={styles.deploymentKeyGuide} aria-label="邮箱凭据加密密钥获取说明">
              <div className={styles.deploymentKeyGuideHeader}>
                <SafetyCertificateOutlined />
                <div><strong>HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY 怎么获得</strong><span>由部署人员在本机生成，不需要向 Gmail、Vercel 或邮箱供应商申请。</span></div>
              </div>
              <ol>
                <li><strong>生成随机值</strong><span>在项目终端运行下面的命令。它会输出 64 位 hex，正好代表 32 字节。</span><code>{`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}</code></li>
                <li><strong>写入部署环境</strong><span>本机把结果写入被 Git 忽略的 <code>.env.local</code>。Vercel 打开 Project Settings → Environment Variables，变量名填写 <code>HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY</code>，变量值粘贴刚生成的 64 位字符串，至少勾选 Production。</span></li>
                <li><strong>保存并重新部署</strong><span>值的前后不要加引号。Vercel 保存后重新部署最新的 main，本机则重新执行 3027 部署命令。</span></li>
              </ol>
              <p><strong>请妥善保存：</strong>不要把真实值发到聊天、截图或 GitHub，也不要随意更换。更换后，之前保存的 SMTP 或 OAuth 凭据将无法解密，必须重新连接系统发件邮箱。</p>
            </div>
          </section>

          <section className={styles.deploymentSection} id="deployment-email">
            <div className={styles.deploymentSectionHeader}><div><h2>连接系统发件邮箱</h2><p>系统以后统一用这个邮箱发送登录链接和托管通知，普通用户只负责收信。</p></div><StepStatusBadge state={senderStatus?.configured ? "done" : "active"} /></div>
            <SetupGuide
              title="完成邮箱授权"
              summary="系统自动识别邮箱服务商，不需要手动选择"
              defaultOpen={!senderStatus?.configured}
              steps={[
                "点击下方按钮进入发件邮箱授权页。",
                "输入准备作为系统发件人的完整邮箱地址，等待页面显示识别结果。",
                "QQ、163、阿里云企业邮箱填写供应商生成的 SMTP 授权码。Gmail 和 Outlook 会跳到 Google / Microsoft 官方页面登录并授权，应用不接触邮箱登录密码。",
                "在部署级 Setup Token 输入框中，填写 .env.local 里完全相同的 HOSTED_EMAIL_SETUP_TOKEN。",
                "提交后查看页面顶部。只有显示“当前发件邮箱已连接”，才算完成。"
              ]}
              note="这里连接的是系统发件邮箱，不是普通用户用来接收登录邮件的邮箱。一个部署只需要连接一次。"
            />
            <SetupGuide
              title="Gmail / Outlook OAuth 到底是什么"
              summary="部署人员先登记应用，用户只在供应商官方页面点同意"
              steps={[
                "部署人员在 Google Cloud 或 Microsoft Entra 创建 Web OAuth 应用，并只申请发送邮件和识别当前账号所需权限，不申请读取收件箱。",
                "在供应商后台登记回调地址：Gmail 使用 <正式域名>/api/v5/hosted/email-sender/oauth/callback/gmail；Outlook 使用 <正式域名>/api/v5/hosted/email-sender/oauth/callback/outlook。下方卡片可直接复制核对。",
                "把 Client ID / Client Secret 写入 Vercel 环境变量并重新部署。Secret 只能保存在服务端，不能放进 NEXT_PUBLIC_ 变量。",
                "授权时页面会离开工作台，进入 Google / Microsoft 官方登录页。确认账号和权限后点同意，供应商再把浏览器送回工作台。",
                "工作台只保存可撤销的发送授权，用它发送登录链接和通知；普通用户不会看到 Client Secret，也不需要提供邮箱密码。"
              ]}
              note="OAuth 不是 SMTP 授权码。二者是两条不同连接方式：Gmail / Outlook 优先 OAuth，QQ / 163 等使用邮箱后台生成的 SMTP 授权码。"
            />
            <div className={styles.smtpSourceGuide} aria-labelledby="smtp-source-guide-title">
              <div className={styles.credentialSourceGuideHeader}>
                <MailOutlined />
                <div><strong id="smtp-source-guide-title">SMTP 授权码直达入口</strong><span>先用准备作为系统发件人的账号登录，再按卡片中的路径操作。授权码不是邮箱登录密码。</span></div>
              </div>
              <div className={styles.smtpSourceGrid}>
                <article><strong>QQ 邮箱</strong><p>登录后打开 设置 → 账号与安全 → 安全设置 → POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务，开启 SMTP 并点击“生成授权码”。</p><a href="https://mail.qq.com/" target="_blank" rel="noreferrer">打开 QQ 邮箱官方网页版 <ArrowRightOutlined /></a></article>
                <article><strong>163 邮箱</strong><p>登录后打开 设置 → POP3/SMTP/IMAP，开启 IMAP/SMTP 或 POP3/SMTP；按安全验证提示创建“客户端授权密码”。</p><a href="https://mail.163.com/" target="_blank" rel="noreferrer">打开 163 邮箱官方网页版 <ArrowRightOutlined /></a></article>
                <article><strong>阿里云企业邮箱</strong><p>管理员先允许三方客户端访问；用户再在邮箱设置中开启“三方客户端安全密码”，生成独立密码后填入 SMTP 授权码字段。</p><a href="https://help.aliyun.com/zh/document_detail/444380.html" target="_blank" rel="noreferrer">查看阿里云官方操作说明 <ArrowRightOutlined /></a></article>
                <article><strong>Gmail / Outlook</strong><p>不生成 SMTP 授权码。部署字段填写完成并重新部署后，点击页面中的 Google / Microsoft OAuth 按钮，在供应商官方授权页完成登录。</p><div className={styles.credentialSourceActions}><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Clients <ArrowRightOutlined /></a><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">Microsoft Apps <ArrowRightOutlined /></a></div></article>
              </div>
            </div>
            <div className={`${styles.deploymentActionCard} ${senderStatus?.configured ? styles.deploymentActionReady : ""}`}>
              {senderStatusLoading ? <Spin size="small" /> : senderStatus?.configured ? <CheckCircleFilled /> : <MailOutlined />}
              <div><strong>{senderStatusLoading ? "正在检查发件邮箱" : senderStatus?.configured ? "发件邮箱已经连接" : "还没有连接发件邮箱"}</strong><span>{senderStatus?.configured ? `${senderStatus.senderHint || "已连接邮箱"} 可以发送系统邮件。` : "完成授权后，所有普通用户共用这一个系统发件邮箱。"}</span></div>
              <Link href="/hosted/email-sender"><Button type={senderStatus?.configured ? "default" : "primary"}>{senderStatus?.configured ? "检查或更换邮箱" : "现在连接发件邮箱"}</Button></Link>
            </div>
          </section>

          <section className={styles.deploymentSection} id="deployment-ai-capture">
            <div className={styles.deploymentSectionHeader}><div><h2>部署一台 24h 共享 AI 采集服务器</h2><p>扩展、Windows 伴侣和 AI 测试账号都只安装在部署人员的常开电脑；普通用户不接触这些配置。</p></div><span className={styles.optionalBadge}>部署人员操作</span></div>
            <SetupGuide
              title="从零部署照着做"
              summary="一台 Windows 常开机服务所有普通用户"
              steps={[
                "在数据库执行到 20260827_042_v5_deployment_shared_ai_capture.sql。它会把共享执行器与普通用户工作区分开，并为每个请求保存发起人归属。",
                "在 Vercel 生成并保存 HOSTED_CAPTURE_SETUP_TOKEN。它只用于部署人员打开本区控制台，不能发给普通用户。保存后重新部署。",
                "在这台 24h Windows 电脑打开 Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序，选择项目中的 browser-extension 目录。",
                "复制 Chrome 显示的扩展 ID，在这台电脑的伴侣环境中设置 V5_CAPTURE_EXTENSION_ID；再把正式工作台地址设置为 V5_WORKBENCH_BASE_URL。",
                "在下方输入部署级 Setup Token，先点“生成部署配对码”。然后启动 npm.cmd run capture-companion:start，并在伴侣窗口输入这个一次性配对码。",
                "只在这台共享电脑的 Chrome 中登录 ChatGPT、豆包、DeepSeek、千问测试账号。验收在线后运行 npm.cmd run capture-companion:autostart，让伴侣随 Windows 启动。"
              ]}
              note="这不是运行在 Vercel 容器里的浏览器。Vercel 负责接收和隔离请求，常开 Windows 电脑负责真实页面操作。普通用户只提交请求，不安装扩展、不配对设备、不登录 AI 测试账号。"
              defaultOpen
            />
            <div className={styles.deploymentVariables} aria-label="AI 前台采集部署变量">
              <div><code>HOSTED_CAPTURE_SETUP_TOKEN</code><span>Vercel：部署人员控制台口令，建议 32 字节随机值</span></div>
              <div><code>V5_CAPTURE_EXTENSION_ID</code><span>共享电脑：伴侣只信任这一 Chrome 扩展</span></div>
              <div><code>V5_WORKBENCH_BASE_URL</code><span>共享电脑：正式 HTTPS 工作台地址</span></div>
              <div><code>V5_CAPTURE_CHROME_PROFILE_DIRECTORY</code><span>共享电脑：专用浏览器档案，可选</span></div>
            </div>
            <div className={styles.deploymentCommandGrid}>
              <div><span>先在前台运行验收</span><code>npm.cmd run capture-companion:start</code></div>
              <div><span>验收通过后设置开机运行</span><code>npm.cmd run capture-companion:autostart</code></div>
            </div>
            {pageAudience === "deployment" ? <HostedAiCaptureDeploymentGuide /> : null}
          </section>

          <section className={styles.deploymentSection} id="deployment-test">
            <div className={styles.deploymentSectionHeader}><div><h2>切换角色，发送真实测试邮件</h2><p>部署人员最后模拟一次普通用户登录，确认邮件从系统发件邮箱送达。</p></div><StepStatusBadge state={senderStatus?.configured ? "active" : "locked"} /></div>
            <SetupGuide
              title="最后一次验收"
              summary="发送、收信、打开链接，三件事都成功才算交付"
              defaultOpen={Boolean(senderStatus?.configured)}
              steps={[
                "确认上一项已经显示“发件邮箱已经连接”。",
                "点击下方“切到普通用户试发”，页面会自动回到普通用户登录步骤。",
                "输入一个你能立即查收的工作邮箱，点击“发送登录链接”。",
                "查看收件箱和垃圾邮件，在 15 分钟内打开主题含 JOTO 的邮件。",
                "浏览器自动回到本页并显示登录已验证后，部署流程才算完成。"
              ]}
              note="普通用户以后只重复登录和业务配置，不会再看到或填写部署级密钥。"
            />
            {senderStatus?.configured ? <Button type="primary" size="large" icon={<UserOutlined />} onClick={() => switchAudience("user", "setup-identity")}>切到普通用户试发</Button> : <LockedStep reason="先连接系统发件邮箱" nextAction="完成上一项后刷新状态，再进行真实登录邮件验收。" />}
          </section>
        </div>

        <aside className={styles.deploymentPassport} aria-label="部署完成清单">
          <SafetyCertificateOutlined />
          <h2>部署完成清单</h2>
          <p>系统发信是必做项；AI 前台采集按实际需要开启。</p>
          <ol>
            <li><span>1</span><div><strong>安全参数</strong><small>写入 .env.local 并重建 3027</small></div></li>
            <li className={senderStatus?.configured ? styles.deploymentPassportDone : ""}><span>{senderStatus?.configured ? <CheckOutlined /> : "2"}</span><div><strong>系统发件邮箱</strong><small>{senderStatus?.configured ? "已连接" : "等待授权"}</small></div></li>
            <li><span>3</span><div><strong>共享 AI 采集服务器</strong><small>扩展、伴侣、部署级配对</small></div></li>
            <li><span>4</span><div><strong>普通用户试发</strong><small>收到并打开登录邮件</small></div></li>
          </ol>
          <Button block icon={<ReloadOutlined />} loading={senderStatusLoading} onClick={loadSenderStatus}>重新检查发件邮箱</Button>
        </aside>
      </div>

      <div id="role-panel-user" className={styles.workspace} hidden={pageAudience !== "user"}>
        <div className={styles.formColumn}>
          <section className={styles.section} id="setup-identity">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>01</span><div><h2>用工作邮箱登录</h2><p>不设密码，邮件里的一次性链接就是登录凭证。</p></div></div><StepStatusBadge state={stepRows[0].state} /></div>
            <SetupGuide title="详细操作教程" summary="第一次使用大约需要 1 分钟" defaultOpen={!identityReady} steps={["在下方输入你常用、能正常收信的工作邮箱。这个邮箱同时用于接收登录链接和托管结果。", "点击“发送登录链接”，然后打开这个邮箱的收件箱。", "查找主题中含 JOTO 的邮件。如果 1 分钟后仍未收到，再查看垃圾邮件。", "在 15 分钟内点击邮件中的登录链接。每条链接只能使用一次。", "验证成功后浏览器会自动回到本页，并解锁第 2 步。"]} note="普通用户不需要配置发件邮箱、SMTP、OAuth 或 Setup Token。收不到邮件时，请联系部署人员检查系统发件邮箱。不要把登录链接转发给别人。" />
            {identityStatus === "checking" ? <div className={styles.inlineLoading}><Spin size="small" /> 正在检查当前登录状态</div> : identity ? <div className={styles.accountRow}><div className={styles.accountIdentity}><span className={styles.mailMark}><UserOutlined /></span><span><strong>{identity.email}</strong><span>{roleLabels[identity.role]} · 登录已验证</span></span></div><Button type="text" icon={<LogoutOutlined />} onClick={logout}>退出或更换账号</Button></div> : loginSent ? <div className={styles.loginSentCard}><CheckCircleFilled /><div><strong>登录邮件已发送到 {loginEmail}</strong><span>请在 15 分钟内打开邮件链接。完成后会自动回到这里。</span></div><Button onClick={() => setLoginSent(false)}>更换邮箱或重新发送</Button></div> : <div className={styles.inlineLoginForm}><label><span>工作邮箱</span><Input size="large" prefix={<MailOutlined />} value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} onPressEnter={requestLogin} placeholder="name@company.com" /></label><Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={loginSending} onClick={requestLogin}>发送登录链接</Button></div>}
          </section>

          <section className={styles.section} id="setup-product">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>02</span><div><h2>提供产品资料</h2><p>官网和文件是系统撰写内容时的事实依据。</p></div></div><StepStatusBadge state={stepRows[1].state} /></div>
            <SetupGuide title="怎么选、怎么填" summary="有旧产品直接点选；新产品至少提供官网或一份资料" defaultOpen={identityReady && currentStep === 2} steps={["如果页面中已有你的产品，直接点击产品卡片，无需重复上传资料。", "如果是新产品，点击“新增产品”，填写对外使用的正式名称。", "优先填写产品官网；如官网信息不完整，再上传 PDF、Word、PPT 等公开推广资料。", "检查文件中没有内部密钥、客户隐私或不允许对外的内容。"]} note="最多 10 份文件，单个不超过 20 MB。资料越真实、越聚焦，后续策略和正文越可靠。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="登录后，系统才能读取当前工作区已有的产品。" /> : productsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在读取已有产品</div> : <><div className={styles.productGrid}>{products.map((product) => { const selected = product.productId === selectedProductId; return <button className={`${styles.productCard} ${selected ? styles.isSelected : ""}`} type="button" disabled={Boolean(order)} aria-pressed={selected} key={product.productId} onClick={() => selectProduct(product)}><span className={styles.productIcon}><AppstoreOutlined /></span><span className={styles.productCopy}><strong>{product.displayName}</strong><span>{product.productCategory || product.officialUrl || "已有产品资料"}</span><small className={`${styles.knowledgeBadge} ${styles[product.strategyPackId ? "knowledge-ready" : "knowledge-building"]}`}>{product.strategyPackId ? "策略资料已建立" : "可继续补充资料"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>; })}<button className={`${styles.productCard} ${styles.addProductCard} ${isAddingNew ? styles.isSelected : ""}`} type="button" disabled={Boolean(order)} aria-pressed={isAddingNew} onClick={startAddingNew}><span className={`${styles.productIcon} ${styles.addProductIcon}`}><PlusOutlined /></span><span className={styles.productCopy}><strong>新增产品</strong><span>填写官网并上传公开推广资料</span></span><span className={styles.selectionMark}>{isAddingNew ? <CheckOutlined /> : null}</span></button></div>{isAddingNew || selectedProduct ? <div className={styles.newProductForm}>{isAddingNew ? <div className={styles.newProductField}><label>产品名称</label><Input disabled={Boolean(order)} value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：WorkBuddy" size="large" /></div> : null}<div className={styles.newProductField}><label>产品官网{selectedProduct ? "（有更新时填写）" : ""}</label><Input disabled={Boolean(order)} value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} placeholder={selectedProduct?.officialUrl || "https://example.com/product"} prefix={<LinkOutlined />} size="large" /></div><div className={styles.newProductField}><label>产品资料{selectedProduct ? "（可选补充）" : ""}</label><label className={`${styles.dropzone} ${styles.compactDropzone} ${dragging ? styles.isDragging : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!order) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}><input ref={fileInputRef} disabled={Boolean(order)} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md" onChange={(event) => event.target.files && addFiles(event.target.files)} /><span className={styles.uploadIcon}><UploadOutlined /></span><strong>{order ? "资料已随委托提交" : "拖入资料，或点击选择"}</strong><span>{order ? "新的补充资料请新建一项委托" : "最多 10 份，单个文件不超过 20 MB"}</span></label>{files.length ? <div className={styles.fileList}>{files.map((file) => <div className={styles.fileItem} key={`${file.name}:${file.size}:${file.lastModified}`}>{materialIcon(file.name)}<span>{file.name}</span><small>{formatSize(file.size)}</small>{!order ? <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} /> : null}</div>)}</div> : null}</div></div> : null}</>}
          </section>

          <section className={styles.section} id="setup-channels">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>03</span><div><h2>选择渠道与每日上限</h2><p>只选你确定要运营的渠道；账号登录在第 5 步完成。</p></div></div><StepStatusBadge state={stepRows[2].state} /></div>
            <SetupGuide title="渠道选择和频率设置教程" summary="点卡片选中；需要控制数量时再展开高级设置" defaultOpen={identityReady && currentStep === 3} steps={["点击渠道卡片即可选中，再点一次取消。灰色卡片表示系统能力尚未开通。", "“已连接”表示可直接使用；“需连接账号”表示选完后还要去第 5 步登录平台。", "没有特殊要求时，保留系统安全上限即可，不需要填数字。", "如果想降低每日发布量，展开“自定义每日上限”，为已选渠道填写 1-100 的整数。"]} note="每日上限只能比系统安全上限更保守，不会绕过平台规则。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="系统会在登录后检查当前可用的托管渠道。" /> : channelsLoading ? <div className={styles.inlineLoading}><Spin size="small" /> 正在核对渠道能力</div> : <><div className={styles.choiceGrid}>{channelOptions.map((option) => { const selected = selectedChannels.includes(option.channel); const disabled = option.capability === "unsupported"; const presentation = channelPresentation[option.channel] || { label: option.channel, icon: <GlobalOutlined /> }; return <button className={`${styles.choiceButton} ${selected ? styles.isSelected : ""} ${disabled ? styles.isDisabled : ""}`} type="button" aria-pressed={selected} aria-disabled={disabled} disabled={disabled} key={option.channel} onClick={() => toggleChannel(option.channel)}><span className={styles.choiceIcon}>{presentation.icon}</span><span className={styles.choiceCopy}><strong>{presentation.label}</strong><span>{option.detail}</span><small className={`${styles.capabilityBadge} ${styles[`capability-${option.authorizationStatus}`]}`}>{option.authorizationStatus === "connected" ? "已连接" : option.authorizationStatus === "required" ? "需连接账号" : "暂不可托管"}</small></span><span className={styles.selectionMark}>{selected ? <CheckOutlined /> : null}</span></button>; })}</div>{selectedChannels.some((key) => selectedOptionMap.get(key)?.authorizationStatus === "required") ? <div className={styles.actionNotice}><SettingOutlined /><span>这不会阻止系统先开始调研。委托创建后，继续在本页第 5 步完成账号连接即可。</span></div> : null}<button className={styles.advancedToggle} type="button" onClick={() => setShowAdvanced((current) => !current)}><SettingOutlined /> {showAdvanced ? "收起每日上限" : "高级：自定义每日上限"}</button>{showAdvanced ? <div className={styles.capGrid}>{selectedChannels.map((channel) => <label key={channel}><span>{channelPresentation[channel]?.label || channel}</span><InputNumber min={1} max={100} value={customCaps[channel]} placeholder="系统上限" onChange={(value) => setCustomCaps((current) => ({ ...current, [channel]: value || undefined }))} /><small>篇 / 日</small></label>)}</div> : null}</>}
          </section>

          <section className={styles.section} id="setup-notifications">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>04</span><div><h2>确认通知方式并创建委托</h2><p>需要你判断的事和公开 URL，都会发到登录邮箱。</p></div></div><StepStatusBadge state={stepRows[3].state} /></div>
            <SetupGuide title="通知和提交前检查" summary="确认收信邮箱、选择汇总邮件，然后创建委托" defaultOpen={identityReady && currentStep === 4} steps={["确认下方邮箱是你本人可以长期收信的地址。它与登录邮箱一致，如需更换请先退出并换邮箱登录。", "保留“每日 URL 汇总”，当天发布结束后只收一封汇总，不会逐篇打扰。", "保留“月度完成通知”，MonthlyReview 形成后会收到当月结果。", "最后检查右侧“配置通行证”，然后点击“确认委托，开始调研”。"]} note="GEO 策略、代表样文和异常通知是必要邮件，不能关闭；可关闭的只是日报和月度完成提醒。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步登录" nextAction="登录邮箱会自动成为通知邮箱，不需要重复输入。" /> : !canManage ? <LockedStep reason="当前角色只能查看，不能创建或修改托管委托" nextAction="请让工作区管理员或产品负责人完成本步。" /> : <><div className={styles.notificationEmail}><MailOutlined /><div><strong>{identity?.email}</strong><span>登录、重要确认和发布结果使用同一邮箱</span></div><small>已验证</small></div><div className={styles.notificationGrid}><label><span><strong>每日 URL 汇总</strong><small>当日批次结束后发一封</small></span><Switch checked={dailyDigest} onChange={setDailyDigest} /></label><label><span><strong>月度完成通知</strong><small>MonthlyReview 形成后发送</small></span><Switch checked={monthlyCompleted} onChange={setMonthlyCompleted} /></label></div>{order ? <div className={styles.submitBar}><span className={styles.submitHint}>修改渠道、每日上限或通知偏好后，点击保存才会生效。</span><Button className={styles.submitButton} type="primary" size="large" icon={<CheckOutlined />} loading={savingSettings} onClick={saveSettings}>保存渠道与通知设置</Button></div> : <div className={styles.submitBar}><span className={styles.submitHint}>点击即确认这些资料可以用于公开推广。策略和样文仍必须由你本人确认。</span><Button className={styles.submitButton} type="primary" size="large" loading={submitting} disabled={!productInputReady || !materialInputReady || !channelsReady} onClick={submitTask} icon={!submitting ? <ArrowRightOutlined /> : undefined}>确认委托，开始调研</Button></div>}</>}
            <div className={styles.aiTestDecision}><div className={styles.aiTestDecisionCopy}><span className={styles.aiTestDecisionIcon}><RobotOutlined /></span><div><strong>是否开启 AI 前台测试？</strong><span>可选。点击“是”进入请求面板；共享服务器会自动执行，你不需要安装扩展、配对电脑或登录 AI 账号。</span></div></div><div className={styles.aiTestDecisionActions}><Button type={aiFrontendEnabled === true ? "primary" : "default"} aria-pressed={aiFrontendEnabled === true} onClick={() => chooseAiFrontend(true)}>是，发送请求</Button><Button type={aiFrontendEnabled === false ? "primary" : "default"} aria-pressed={aiFrontendEnabled === false} onClick={() => chooseAiFrontend(false)}>否，暂时跳过</Button></div></div>
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

          {aiFrontendEnabled ? <section className={`${styles.section} ${styles.aiFrontendSection}`} id="setup-ai-frontend">
            <div className={styles.sectionHeader}><div className={styles.sectionTitle}><span className={`${styles.sectionNumber} ${styles.optionalSectionNumber}`}><RobotOutlined /></span><div><h2>发送 AI 前台测试请求</h2><p>选择平台并提交，系统会自动把任务交给部署人员维护的 24h 共享服务器。</p></div></div><span className={styles.optionalBadge}>普通用户操作</span></div>
            <SetupGuide title="你只需要完成三步" summary="不安装、不配对、不提供账号密码" defaultOpen steps={["确认页面显示“共享采集服务器在线”。如果离线，请联系部署人员，不要在自己的电脑安装任何工具。", "选择 ChatGPT、豆包、DeepSeek 或千问。系统会使用共享测试账号打开对应平台。", "点击“发送测试请求”后可以关闭页面；请求和结果只归属于你的登录账号与当前工作区。"]} note="扩展、Windows 伴侣、AI 测试账号和部署级 Setup Token 都由部署人员保管。普通用户永远不需要填写 Cookie、Token 或平台密码。" />
            {!identityReady ? <LockedStep reason="先完成第 1 步工作邮箱登录" nextAction="登录用于标记请求归属，防止其他工作区看到你的结果。" /> : <HostedAiCaptureRequestPanel productId={order?.productId || selectedProductId || undefined} />}
          </section> : null}

        </div>

        <aside className={styles.receipt} aria-label="配置通行证">
          <div className={styles.receiptHeader}><div><span className={styles.receiptKicker}>SETUP PASSPORT</span><h2>配置通行证</h2><p>不用记路径，只看哪一步还没有绿。</p></div><span className={styles.receiptStamp}><SafetyCertificateOutlined /></span></div>
          <div className={styles.receiptBody}><div className={styles.setupPassportSteps}>{stepRows.map((step) => <a href={`#setup-${["identity", "product", "channels", "notifications", "accounts", "ready"][step.number - 1]}`} className={`${styles.setupPassportStep} ${styles[`passport-${step.state}`]}`} key={step.number}><span>{step.state === "done" ? <CheckOutlined /> : step.number}</span><strong>{step.label}</strong><small>{step.state === "done" ? "已完成" : step.number === currentStep ? "现在处理" : step.state === "waiting" ? "发布前完成" : "等待前置"}</small></a>)}</div><div className={styles.receiptSection}><dl><div className={styles.receiptRow}><dt>登录账号</dt><dd>{identity?.email || "尚未登录"}</dd></div><div className={styles.receiptRow}><dt>推广产品</dt><dd>{displayProductName}</dd></div><div className={styles.receiptRow}><dt>产品资料</dt><dd className={styles.wrap}>{materialLabel || "尚未添加"}</dd></div><div className={styles.receiptRow}><dt>推广渠道</dt><dd className={styles.wrap}>{selectedChannelLabels.length ? selectedChannelLabels.join("、") : "尚未选择"}</dd></div></dl></div><div className={styles.receiptSection}><div className={styles.readinessStampGrid}><div className={researchReady ? styles.readinessReady : styles.readinessWaiting}><span>{researchReady ? <CheckOutlined /> : <LockOutlined />}</span><strong>调研就绪</strong><small>{researchReady ? "已开始" : "完成 1-4 步"}</small></div><div className={publishReady ? styles.readinessReady : styles.readinessWaiting}><span>{publishReady ? <CheckOutlined /> : <LockOutlined />}</span><strong>发布就绪</strong><small>{publishReady ? "账号已齐" : "完成第 5 步"}</small></div></div></div><div className={styles.receiptSection}><div className={styles.receiptNote}><strong>你只保留核心判断</strong><br />策略确认一次、代表样文确认一次。正常运行后不需要每天操作。</div></div></div>
          <div className={styles.receiptFooter}>执行周期：当前日历月 · 日期只是 MonthlyPlan 下的执行视图</div>
        </aside>
      </div>
    </div>
  );
}
