"use client";

import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CheckOutlined,
  LoginOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Button, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../../hosted-mode.module.css";

type AuthorizationPhase = "system_setup" | "needs_login" | "manual_takeover_required" | "needs_account_confirmation" | "connected";

interface Order {
  orderId: string;
  productId: string;
  productName: string;
}

interface ChannelOption {
  channel: string;
  capability: "auto_publish" | "draft_only" | "unsupported";
  authorizationStatus: "connected" | "required" | "not_applicable" | "unavailable";
  authorizationPhase: AuthorizationPhase;
  accountCandidate?: string;
  accountCandidateLabel?: string;
  accountBindingVersion?: number;
  detail: string;
  nextAction?: string;
}

const channelLabels: Record<string, string> = { zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };
const channelGuidance: Record<string, string[]> = {
  zhihu: ["使用具备文章或专栏写作权限的账号", "验证码、手机确认和安全挑战必须由你本人完成"],
  csdn: ["系统按已批准规则使用原创、公开发布设置", "标签或分类缺失时会在发布前阻断并提示"],
  juejin: ["系统按已批准规则选择分类和标签", "平台审核期间保持待验证，不会重复发布"]
};

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return String(record.message || error.message || error.nextAction || fallback);
}

export default function HostedChannelConnectPage({ params }: { params: Promise<{ channel: string }> }) {
  const [channel, setChannel] = useState("");
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<Order>();
  const [option, setOption] = useState<ChannelOption>();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loginWindowOpened, setLoginWindowOpened] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async (targetOrderId: string, targetChannel: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const orderResponse = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}`, { cache: "no-store" });
      const orderPayload = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(readError(orderPayload, "托管任务读取失败。"));
      const nextOrder = orderPayload.order as Order;
      const channelsResponse = await fetch(`/api/v5/hosted/channels?productId=${encodeURIComponent(nextOrder.productId)}`, { cache: "no-store" });
      const channelsPayload = await channelsResponse.json();
      if (!channelsResponse.ok) throw new Error(readError(channelsPayload, "渠道授权状态读取失败。"));
      const nextOption = (Array.isArray(channelsPayload.channels) ? channelsPayload.channels : [])
        .find((item: ChannelOption) => item.channel === targetChannel) as ChannelOption | undefined;
      if (!nextOption) throw new Error("该渠道不存在或尚未接入托管模式。");
      setOrder(nextOrder);
      setOption(nextOption);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "渠道授权状态读取失败。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void params.then(({ channel: targetChannel }) => {
      if (!active) return;
      const targetOrderId = new URLSearchParams(window.location.search).get("orderId")?.trim() || "";
      setChannel(targetChannel);
      setOrderId(targetOrderId);
      if (targetOrderId) void load(targetOrderId, targetChannel);
      else { setError("缺少托管任务编号。"); setLoading(false); }
    });
    return () => { active = false; };
  }, [load, params]);

  const phaseIndex = useMemo(() => {
    if (!option || option.authorizationPhase === "system_setup") return 0;
    if (["needs_login", "manual_takeover_required"].includes(option.authorizationPhase)) return 1;
    if (option.authorizationPhase === "needs_account_confirmation") return 2;
    return 3;
  }, [option]);

  async function openLoginWindow() {
    if (!order || !channel) return;
    setOpening(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(order.orderId)}/channels/${encodeURIComponent(channel)}/authorization`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "专用登录窗口启动失败。"));
      setLoginWindowOpened(true);
      setNotice(String(payload.authorization?.nextAction || "专用登录窗口已打开。完成登录后回到这里继续。"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "专用登录窗口启动失败。请检查本机发布服务后重试。");
    } finally {
      setOpening(false);
    }
  }

  async function refreshAuthorization() {
    if (!order) return;
    setNotice(undefined);
    await load(order.orderId, channel);
  }

  async function confirmAccount() {
    if (!order || !option?.accountCandidate) return;
    setConfirming(true);
    setError(undefined);
    try {
      const idempotencyKey = `hosted-account-${order.orderId}-${channel}-${crypto.randomUUID()}`;
      const response = await fetch(`/api/v5/products/${encodeURIComponent(order.productId)}/publish-account-binding`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          platform: channel,
          accountLabel: option.accountCandidate,
          expectedVersion: option.accountBindingVersion || 0,
          idempotencyKey
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "发布账号确认失败。"));
      setNotice("账号已经绑定到当前产品，系统会自动重新检查并继续托管。");
      await load(order.orderId, channel);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布账号确认失败。请重新检查登录状态。");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在检查渠道连接</span></div>;
  if (!order || !option) return <div className={styles.reviewError}><strong>无法打开渠道连接</strong><span>{error}</span><Link href={orderId ? `/hosted/settings?orderId=${encodeURIComponent(orderId)}` : "/"}><Button>返回托管设置</Button></Link></div>;

  const label = channelLabels[channel] || channel;
  const setupBlocked = option.authorizationPhase === "system_setup";
  const loginRequired = option.authorizationPhase === "needs_login" || option.authorizationPhase === "manual_takeover_required";
  const confirmationRequired = option.authorizationPhase === "needs_account_confirmation";
  const connected = option.authorizationPhase === "connected";

  return (
    <div className={styles.authorizationPage}>
      <header className={styles.authorizationHeader}>
        <Link href={`/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`}><Button type="text" icon={<ArrowLeftOutlined />}>返回托管设置</Button></Link>
        <div className={styles.kicker}>CHANNEL HANDOFF</div>
        <h1>连接 {label}</h1>
        <p>你只负责在平台官方页面完成登录。账号会话保存在本机专用浏览器中，工作台不要求你粘贴 Cookie、Token 或请求头。</p>
      </header>

      <div className={styles.authorizationRail} aria-label="渠道授权进度">
        {["系统开通渠道", "本人完成登录", "确认用于当前产品"].map((step, index) => {
          const done = phaseIndex > index;
          const active = phaseIndex === index;
          return <div className={`${styles.authorizationRailItem} ${done ? styles.isDone : ""} ${active ? styles.isActive : ""}`} key={step}><span>{done ? <CheckOutlined /> : index + 1}</span><strong>{step}</strong></div>;
        })}
      </div>

      <main className={styles.authorizationGrid}>
        <section className={styles.authorizationCard}>
          {setupBlocked ? <><div className={styles.authorizationState}>SYSTEM SETUP</div><h2>这个渠道还没开放托管</h2><p>{option.detail}</p><div className={styles.authorizationCallout}>你现在不需要提供任何账号信息。渠道规则和发布适配器由运营人员完成开通，开放后这里会自动变成登录入口。</div></> : null}
          {loginRequired ? <><div className={styles.authorizationState}>YOUR TURN</div><h2>{loginWindowOpened ? "在专用窗口完成登录" : `打开 ${label} 专用登录窗口`}</h2><p>{option.detail}</p><div className={styles.authorizationCallout}>{option.authorizationPhase === "manual_takeover_required" ? "平台要求验证码、手机确认或安全挑战。请在专用窗口亲自完成，系统不会绕过。" : "首次连接只需登录一次；登录失效时，系统会再次邮件提醒。"}</div><div className={styles.authorizationActions}>{!loginWindowOpened ? <Button type="primary" size="large" icon={<LoginOutlined />} loading={opening} onClick={openLoginWindow}>打开 {label} 登录窗口</Button> : <Button type="primary" size="large" icon={<ReloadOutlined />} onClick={refreshAuthorization}>我已完成登录，重新检查</Button>}<Button size="large" icon={<ReloadOutlined />} onClick={refreshAuthorization}>仅重新检查</Button></div></> : null}
          {confirmationRequired ? <><div className={styles.authorizationState}>CONFIRM ACCOUNT</div><h2>登录成功，确认交给系统使用</h2><p>系统已识别 {option.accountCandidateLabel || "专用浏览器中的账号"}。确认后，它只用于 {order.productName} 的当前托管发布。</p><div className={styles.accountHandoff}><SafetyCertificateOutlined /><span><strong>{option.accountCandidateLabel || "已登录账号"}</strong><small>不会在页面显示账号凭据</small></span></div><div className={styles.authorizationActions}><Button type="primary" size="large" icon={<CheckOutlined />} loading={confirming} onClick={confirmAccount}>确认用于 {order.productName}</Button></div></> : null}
          {connected ? <><CheckCircleFilled className={styles.authorizationCompleteIcon} /><div className={styles.authorizationState}>CONNECTED</div><h2>{label} 已连接</h2><p>系统会按 MonthlyPlan 和该渠道安全上限执行。正常运行时不再要求你逐篇操作。</p><div className={styles.authorizationActions}><Link href={`/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`}><Button type="primary" size="large">返回托管设置</Button></Link></div></> : null}
          {notice ? <div className={styles.savedNotice}><CheckOutlined /> {notice}</div> : null}
          {error ? <div className={styles.formError}><strong>当前步骤未完成</strong><span>{error}</span></div> : null}
        </section>

        <aside className={styles.authorizationAside}>
          <strong>系统替你处理</strong>
          <ul>{(channelGuidance[channel] || []).map((item) => <li key={item}><CheckOutlined />{item}</li>)}</ul>
          <div><SafetyCertificateOutlined /><span><strong>凭据留在本机</strong><small>专用 Profile 位于项目目录外，不进入 Git、文档或通知邮件。</small></span></div>
        </aside>
      </main>
    </div>
  );
}
