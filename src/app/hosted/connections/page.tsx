"use client";

import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  LinkOutlined,
  LoadingOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Avatar, Button, Segmented, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../hosted-mode.module.css";

type Channel = "zhihu" | "csdn" | "juejin";
type ExecutorType = "cloud_browser" | "desktop_connector";
type SessionStatus = "created" | "queued" | "waiting_for_user" | "manual_takeover_required" | "account_detected" | "confirmed" | "failed" | "expired" | "cancelled";

interface DetectedAccount {
  providerAccountRef: string;
  publicDisplayName: string;
  publicAvatarUrl?: string;
  publicProfileUrl?: string;
  capabilities: string[];
}

interface AuthorizationSession {
  id: string;
  channel: Channel;
  executorType: ExecutorType;
  status: SessionStatus;
  detectedAccount?: DetectedAccount;
  accountConnectionId?: string;
  failureMessage?: string;
  rowVersion: number;
}

interface ChannelState {
  channel: Channel;
  session?: AuthorizationSession;
  connection?: {
    accountConnectionId: string;
    publicDisplayName: string;
    publicAvatarUrl?: string;
    authorizationStatus: string;
    executorType: ExecutorType;
  };
}

interface HostedOrder {
  orderId: string;
  productName: string;
}

interface ExecutorNode {
  nodeId: string;
  executorType: ExecutorType;
  displayName: string;
  status: "online" | "offline";
}

const labels: Record<Channel, string> = { zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedConnectionsPage() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<HostedOrder>();
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [executorType, setExecutorType] = useState<ExecutorType>("cloud_browser");
  const [activeChannel, setActiveChannel] = useState<Channel>();
  const [activeSession, setActiveSession] = useState<AuthorizationSession>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [executorNodes, setExecutorNodes] = useState<ExecutorNode[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const eventSourceRef = useRef<EventSource>();

  const load = useCallback(async (targetOrderId: string) => {
    setLoading(true);
    setError("");
    try {
      const [orderResponse, connectionResponse, nodesResponse] = await Promise.all([
        fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}`, { cache: "no-store" }),
        fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}/channel-connections`, { cache: "no-store" }),
        fetch("/api/v5/publish-executors/nodes", { cache: "no-store" })
      ]);
      const [orderPayload, connectionPayload, nodesPayload] = await Promise.all([orderResponse.json(), connectionResponse.json(), nodesResponse.json()]);
      if (orderResponse.status === 401 || connectionResponse.status === 401) {
        window.location.href = "/hosted/login";
        return;
      }
      if (!orderResponse.ok) throw new Error(readError(orderPayload, "托管任务读取失败。"));
      if (!connectionResponse.ok) throw new Error(readError(connectionPayload, "渠道连接状态读取失败。"));
      const nextChannels = Array.isArray(connectionPayload.channels) ? connectionPayload.channels as ChannelState[] : [];
      setOrder(orderPayload.order as HostedOrder);
      setExecutorNodes(nodesResponse.ok && Array.isArray(nodesPayload.nodes) ? nodesPayload.nodes as ExecutorNode[] : []);
      setChannels(nextChannels);
      const incomplete = nextChannels.find((item) => !item.connection || item.connection.authorizationStatus !== "connected");
      setActiveChannel((current) => current && nextChannels.some((item) => item.channel === current) ? current : incomplete?.channel || nextChannels[0]?.channel);
      if (incomplete?.session && !["failed", "expired", "cancelled"].includes(incomplete.session.status)) setActiveSession(incomplete.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "渠道连接状态读取失败。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const targetOrderId = new URLSearchParams(window.location.search).get("orderId")?.trim() || "";
    setOrderId(targetOrderId);
    if (targetOrderId) void load(targetOrderId);
    else { setError("缺少托管任务编号。"); setLoading(false); }
  }, [load]);

  const activeSessionId = activeSession?.id;
  const activeSessionStatus = activeSession?.status;
  useEffect(() => {
    eventSourceRef.current?.close();
    if (!activeSessionId || ["confirmed", "failed", "expired", "cancelled"].includes(activeSessionStatus || "")) return;
    const source = new EventSource(`/api/v5/hosted/authorization-sessions/${encodeURIComponent(activeSessionId)}/events`);
    eventSourceRef.current = source;
    const refresh = async () => {
      const response = await fetch(`/api/v5/hosted/authorization-sessions/${encodeURIComponent(activeSessionId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) {
        setActiveSession(payload.session as AuthorizationSession);
        if (["confirmed", "failed", "expired", "cancelled"].includes(String(payload.session?.status))) {
          source.close();
          if (orderId) await load(orderId);
        }
      }
    };
    const events = ["window_opened", "waiting_for_login", "manual_takeover_required", "account_detected", "permission_checked", "connected", "terminal"];
    for (const event of events) source.addEventListener(event, () => void refresh());
    source.onerror = () => {
      source.close();
      window.setTimeout(() => void refresh(), 1500);
    };
    return () => source.close();
  }, [activeSessionId, activeSessionStatus, load, orderId]);

  const current = useMemo(() => channels.find((item) => item.channel === activeChannel), [activeChannel, channels]);
  const connectedCount = channels.filter((item) => item.connection?.authorizationStatus === "connected").length;
  const complete = channels.length > 0 && connectedCount === channels.length;

  async function startConnection(channel: Channel) {
    if (!orderId) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(orderId)}/channel-connections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, executorType,
          ...(executorType === "desktop_connector" ? { connectorDeviceId: executorNodes.find((item) => item.executorType === "desktop_connector" && item.status === "online")?.nodeId } : {}) })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "账号连接会话创建失败。"));
      setActiveChannel(channel);
      setActiveSession(payload.session as AuthorizationSession);
      if (payload.launchUrl) {
        if (executorType === "desktop_connector") window.location.href = String(payload.launchUrl);
        else window.open(String(payload.launchUrl), `joto-${channel}-authorization`, "popup,width=1280,height=820");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账号连接会话创建失败。请稍后重试。");
    } finally {
      setWorking(false);
    }
  }

  async function createPairingCode() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/v5/publish-executors/pairing-codes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "我的 Desktop Connector" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "配对码创建失败。"));
      setPairingCode(String(payload.pairingCode || ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配对码创建失败。");
    } finally { setWorking(false); }
  }

  async function confirmAccount() {
    if (!activeSession?.detectedAccount) return;
    setWorking(true);
    setError("");
    try {
      const idempotencyKey = `confirm-publish-account-${crypto.randomUUID()}`;
      const response = await fetch(`/api/v5/hosted/authorization-sessions/${encodeURIComponent(activeSession.id)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ expectedVersion: activeSession.rowVersion, idempotencyKey })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "账号确认失败。"));
      await load(orderId);
      const latest = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(orderId)}/channel-connections`, { cache: "no-store" }).then((response) => response.json());
      const next = (latest.channels as ChannelState[]).find((item) => !item.connection);
      if (next) setActiveChannel(next.channel);
      setActiveSession(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账号确认失败。请刷新后重试。");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在读取发布账号连接</span></div>;
  if (!order) return <div className={styles.reviewError}><strong>无法打开账号连接向导</strong><span>{error}</span><Link href="/"><Button>返回工作台</Button></Link></div>;

  const session = activeSession || current?.session;
  const account = session?.detectedAccount;
  return (
    <div className={styles.connectionWizardPage}>
      <header className={styles.authorizationHeader}>
        <Link href={`/hosted/settings?orderId=${encodeURIComponent(orderId)}`}><Button type="text" icon={<ArrowLeftOutlined />}>返回托管设置</Button></Link>
        <div className={styles.kicker}>PUBLISH ACCOUNT CONNECTIONS</div>
        <h1>连接发布账号</h1>
        <p>{order.productName} · 已完成 {connectedCount}/{channels.length}。每个账号都与当前工作区隔离，确认后自动进入下一个渠道。</p>
      </header>

      <div className={styles.connectionWizardGrid}>
        <aside className={styles.connectionChannelList}>
          {channels.map((item, index) => {
            const connected = item.connection?.authorizationStatus === "connected";
            const active = item.channel === activeChannel;
            return <button type="button" className={`${styles.connectionChannelItem} ${active ? styles.isActive : ""}`} onClick={() => { setActiveChannel(item.channel); setActiveSession(item.session); }} key={item.channel}><span>{connected ? <CheckOutlined /> : index + 1}</span><div><strong>{labels[item.channel]}</strong><small>{connected ? item.connection?.publicDisplayName : item.session?.status === "account_detected" ? "等待确认账号" : item.session ? "连接进行中" : "等待连接"}</small></div></button>;
          })}
        </aside>

        <main className={styles.connectionWizardCard}>
          {complete ? <div className={styles.connectionComplete}><CheckCircleFilled /><h2>三个渠道已经连接完成</h2><p>系统会在每次发布前核对账号指纹，发现账号切换时立即暂停，不会发布到未知账号。</p><Link href={`/hosted/success?orderId=${encodeURIComponent(orderId)}`}><Button type="primary" size="large">返回托管状态</Button></Link></div> : current?.connection ? <div className={styles.connectionComplete}><CheckCircleFilled /><h2>{labels[current.channel]} 已连接</h2><p>{current.connection.publicDisplayName}</p><Button type="primary" onClick={() => { const next = channels.find((item) => !item.connection); if (next) setActiveChannel(next.channel); }}>连接下一个渠道</Button></div> : <>
            <div className={styles.authorizationState}>{session ? session.status.toUpperCase() : "READY TO CONNECT"}</div>
            <h2>{labels[activeChannel || "zhihu"]}</h2>
            {!session || ["failed", "expired", "cancelled"].includes(session.status) ? <>
              <p>选择账号托管位置，然后在平台官方页面完成登录。工作台不会要求你粘贴 Cookie 或 Token。</p>
              <Segmented block value={executorType} onChange={(value) => setExecutorType(value as ExecutorType)} options={[
                { value: "cloud_browser", label: <span><CloudServerOutlined /> 云端托管</span> },
                { value: "desktop_connector", label: <span><DesktopOutlined /> 私有化 Connector</span> }
              ]} />
              <div className={styles.authorizationCallout}>{executorType === "cloud_browser" ? "账号会话保存在当前工作区独占的加密浏览器 Profile 中，用户电脑关机后仍可按计划发布。" : "账号会话只保存在指定设备；该设备离线时发布任务会暂停。"}</div>
              {executorType === "desktop_connector" && !executorNodes.some((item) => item.executorType === "desktop_connector" && item.status === "online") ? <div className={styles.connectorPairingBox}>
                <strong>先连接这台电脑</strong>
                <span>生成一次性配对码，在本机 PowerShell 执行命令。配对码 10 分钟有效，只能使用一次。</span>
                <Button loading={working} onClick={createPairingCode}>生成配对码</Button>
                {pairingCode ? <code>powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-desktop-publish-connector.ps1 -PairingCode {pairingCode}</code> : null}
                {pairingCode ? <Button onClick={() => void load(orderId)}>我已启动，刷新状态</Button> : null}
              </div> : null}
              <Button type="primary" size="large" icon={<LinkOutlined />} loading={working} onClick={() => activeChannel && startConnection(activeChannel)}>连接 {labels[activeChannel || "zhihu"]}</Button>
            </> : session.status === "account_detected" && account ? <>
              <p>系统已经从平台公开创作页面识别到以下账号。确认前请核对昵称和公开主页。</p>
              <div className={styles.detectedAccountCard}>
                <Avatar size={56} src={account.publicAvatarUrl}>{account.publicDisplayName.slice(0, 1)}</Avatar>
                <div><strong>{account.publicDisplayName}</strong><small>{account.providerAccountRef}</small>{account.publicProfileUrl ? <a href={account.publicProfileUrl} target="_blank" rel="noreferrer">查看公开主页</a> : null}</div>
              </div>
              <div className={styles.authorizationActions}><Button type="primary" size="large" icon={<CheckOutlined />} loading={working} onClick={confirmAccount}>确认用于 {order.productName}</Button><Button size="large" onClick={() => activeChannel && startConnection(activeChannel)}>切换其他账号</Button></div>
            </> : <>
              <div className={styles.connectionWaiting}><LoadingOutlined spin /><div><strong>{session.status === "manual_takeover_required" ? "需要你完成安全验证" : "等待平台登录完成"}</strong><span>{session.status === "created" ? "云端执行节点正在排队；分配后会自动打开安全浏览器。" : session.status === "manual_takeover_required" ? "请在安全浏览器中完成验证码、手机确认或平台安全挑战。" : "登录成功后页面会自动识别账号，不需要手动刷新。"}</span></div></div>
              <div className={styles.authorizationCallout}><SafetyCertificateOutlined /> 登录凭据不会进入工作台数据库、Git、日志或邮件。</div>
            </>}
          </>}
          {error ? <div className={styles.formError}><strong>当前步骤未完成</strong><span>{error}</span></div> : null}
        </main>
      </div>
    </div>
  );
}
