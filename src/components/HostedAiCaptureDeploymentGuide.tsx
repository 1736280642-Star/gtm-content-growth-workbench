"use client";

import { CheckCircleFilled, CopyOutlined, DesktopOutlined, KeyOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { type FormEvent, useState } from "react";
import type { AiFrontendConnection } from "@/lib/v5/observation-contracts";
import styles from "@/app/hosted-mode.module.css";

interface DeploymentDevice {
  deviceId: string;
  status: string;
  lastHeartbeatAt?: string;
  adapterVersion?: string;
}

interface DeploymentSummary {
  devices: DeploymentDevice[];
  connections: AiFrontendConnection[];
  queue: Record<string, number>;
}

interface PairingCodeResult { pairingCode: string; expiresAt: string }

function unwrap<T>(payload: unknown): T {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return (record.data && typeof record.data === "object" ? record.data : record) as T;
}

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return String(nested.message || record.message || fallback);
}

export function HostedAiCaptureDeploymentGuide() {
  const [summary, setSummary] = useState<DeploymentSummary>();
  const [pairing, setPairing] = useState<PairingCodeResult>();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(formElement);
    form.set("action", submitter?.dataset.action || "status");
    setLoading(true);
    setError(undefined);
    setCopied(false);
    try {
      const response = await fetch("/api/v5/hosted/ai-capture-deployment", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "部署级采集配置读取失败。"));
      if (form.get("action") === "pair") setPairing(unwrap<PairingCodeResult>(payload));
      else setSummary(unwrap<DeploymentSummary>(payload));
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "部署级采集配置读取失败。");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.pairingCode);
    setCopied(true);
  }

  const online = summary?.devices.filter((device) => device.status === "online").length || 0;
  const queueTotal = Number(summary?.queue.pending || 0) + Number(summary?.queue.leased || 0);

  return <div className={styles.deploymentCaptureConsole}>
    <form className={styles.deploymentCaptureAuth} onSubmit={submit}>
      <label><span>部署级 AI 采集 Setup Token</span><input name="setupToken" type="password" autoComplete="off" required placeholder="填写 HOSTED_CAPTURE_SETUP_TOKEN" /></label>
      <div><Button htmlType="submit" data-action="status" icon={<ReloadOutlined />} loading={loading}>检查共享服务器</Button><Button htmlType="submit" data-action="pair" type="primary" icon={<KeyOutlined />} loading={loading}>生成部署配对码</Button></div>
    </form>
    <p className={styles.deploymentCaptureTokenNote}>Token 只随本次请求发送到服务端校验，不会保存在页面、浏览器存储或 URL 中。</p>
    {pairing ? <div className={styles.deploymentPairingResult}><KeyOutlined /><div><strong>{pairing.pairingCode}</strong><span>把它粘贴到 24 小时服务器上的 JOTO 扩展；10 分钟内使用一次。</span></div><Button icon={copied ? <CheckCircleFilled /> : <CopyOutlined />} onClick={copyCode}>{copied ? "已复制" : "复制配对码"}</Button></div> : null}
    {summary ? <div className={styles.deploymentCaptureStatus}>
      <div className={online ? styles.deploymentCaptureReady : styles.deploymentCaptureWarning}><DesktopOutlined /><span><strong>{online} 台共享服务器在线</strong><small>{summary.devices.length ? `共登记 ${summary.devices.length} 台设备` : "尚未使用部署配对码绑定设备"}</small></span></div>
      <div className={summary.connections.length ? styles.deploymentCaptureReady : styles.deploymentCaptureWarning}><RobotOutlined /><span><strong>{summary.connections.length} 个共享 AI 账号</strong><small>{summary.connections.length ? summary.connections.map((item) => `${item.platform} · ${item.accountAlias}`).join("；") : "在服务器扩展中登录并绑定测试账号"}</small></span></div>
      <div><ReloadOutlined /><span><strong>{queueTotal} 个执行中或排队任务</strong><small>服务器按账号可用性和队列长度自动分配</small></span></div>
    </div> : null}
    {error ? <div className={styles.connectionError} role="alert">{error}</div> : null}
  </div>;
}
