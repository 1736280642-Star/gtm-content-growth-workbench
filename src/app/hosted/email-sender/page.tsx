"use client";

import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloudOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Button, Input, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../../hosted-mode.module.css";

type Provider = "qq" | "163" | "gmail" | "outlook";

interface SenderStatus {
  configured: boolean;
  provider?: Provider;
  authType?: string;
  status?: string;
  senderHint?: string;
}

const providers: Array<{
  key: Provider;
  name: string;
  method: string;
  description: string;
}> = [
  { key: "qq", name: "QQ 邮箱", method: "SMTP 授权码", description: "在 QQ 邮箱设置中开启 SMTP，并使用授权码连接。" },
  { key: "163", name: "163 邮箱", method: "SMTP 授权码", description: "在 163 邮箱设置中开启 SMTP，并使用客户端授权码连接。" },
  { key: "gmail", name: "Gmail", method: "Google OAuth", description: "跳转 Google，只授权发送邮件，不读取收件箱。" },
  { key: "outlook", name: "Outlook", method: "Microsoft OAuth", description: "跳转 Microsoft，只授予 Mail.Send 发件权限。" }
];

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nextAction = typeof record.nextAction === "string" ? record.nextAction : "";
  return `${String(record.message || fallback)}${nextAction ? ` ${nextAction}` : ""}`;
}

export default function HostedEmailSenderPage() {
  const [provider, setProvider] = useState<Provider>("qq");
  const [status, setStatus] = useState<SenderStatus>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v5/hosted/email-sender", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "无法读取发件邮箱状态。"));
      setStatus(payload.sender as SenderStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取发件邮箱状态。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("result") === "connected") setMessage("邮箱授权已完成，可以发送登录链接和托管通知。");
    if (query.get("error") === "authorization_cancelled") setError("邮箱授权已取消，当前连接没有变化。");
    if (query.get("error") === "authorization_failed") setError("邮箱授权未完成。请检查 OAuth 回调地址后重新授权。");
    void loadStatus();
  }, [loadStatus]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    form.reset();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const oauth = provider === "gmail" || provider === "outlook";
      const response = await fetch(
        oauth ? "/api/v5/hosted/email-sender/oauth/start" : "/api/v5/hosted/email-sender/smtp",
        { method: "POST", body: formData }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "发件邮箱授权失败。"));
      if (oauth) {
        const authorizationUrl = String(payload.authorizationUrl || "");
        if (!authorizationUrl.startsWith("https://")) throw new Error("授权地址无效，请检查 OAuth 客户端配置。");
        window.location.assign(authorizationUrl);
        return;
      }
      setStatus(payload.sender as SenderStatus);
      setMessage("SMTP 授权已验证并加密保存，可以发送登录链接和托管通知。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发件邮箱授权失败。");
    } finally {
      formData.delete("setupToken");
      formData.delete("appPassword");
      setSubmitting(false);
    }
  }

  const selected = providers.find((item) => item.key === provider) || providers[0];
  const usesOAuth = provider === "gmail" || provider === "outlook";

  return (
    <main className={styles.senderSetupPage}>
      <header className={styles.senderSetupHeader}>
        <div>
          <div className={styles.kicker}>PERSONAL EMAIL SENDER</div>
          <h1>连接你的发件邮箱</h1>
          <p>选择 QQ、163、Gmail 或 Outlook。授权只保存在服务端，页面不会保存授权码、Token 或邮箱密码。</p>
        </div>
        <Link href="/hosted/login"><Button icon={<ArrowLeftOutlined />}>返回登录</Button></Link>
      </header>

      {loading ? <section className={styles.senderStatusCard}><Spin /><span>正在读取发件邮箱状态</span></section> : status?.configured ? (
        <section className={styles.senderConnectedCard}>
          <CheckCircleFilled />
          <div><strong>当前发件邮箱已连接</strong><span>{providers.find((item) => item.key === status.provider)?.name || status.provider} · {status.senderHint}</span></div>
          <small>重新完成下方授权会安全替换当前连接。</small>
        </section>
      ) : (
        <section className={styles.senderStatusCard}><MailOutlined /><div><strong>尚未连接发件邮箱</strong><span>完成一次授权后，邮箱登录与结果通知会自动使用该连接。</span></div></section>
      )}

      <section className={styles.senderSetupCard}>
        <div className={styles.senderSectionTitle}><span>1</span><div><strong>选择邮箱</strong><small>四种邮箱共用同一条邮件投递链路。</small></div></div>
        <div className={styles.senderProviderGrid} role="radiogroup" aria-label="发件邮箱供应商">
          {providers.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={provider === item.key}
              className={provider === item.key ? styles.senderProviderSelected : styles.senderProvider}
              key={item.key}
              onClick={() => { setProvider(item.key); setError(""); setMessage(""); }}
            >
              <span className={styles.senderProviderMark}>{item.key === "163" ? "163" : item.name.slice(0, 1)}</span>
              <strong>{item.name}</strong>
              <small>{item.method}</small>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.senderSetupCard}>
        <div className={styles.senderSectionTitle}><span>2</span><div><strong>完成授权</strong><small>{selected.description}</small></div></div>
        <form className={styles.senderSetupForm} onSubmit={submit} autoComplete="off">
          <input type="hidden" name="provider" value={provider} />
          {!usesOAuth ? <>
            <label><span>发件邮箱地址</span><Input name="email" type="email" required size="large" prefix={<MailOutlined />} placeholder={provider === "qq" ? "name@qq.com" : "name@163.com"} autoComplete="username" /></label>
            <label><span>SMTP 授权码</span><Input.Password name="appPassword" required size="large" prefix={<SafetyCertificateOutlined />} placeholder="不是邮箱登录密码" autoComplete="new-password" /></label>
          </> : (
            <div className={styles.senderOAuthNotice}><CloudOutlined /><div><strong>将在供应商页面完成登录与授权</strong><span>工作台不会接触你的 Gmail / Outlook 登录密码，也不会申请读取邮件权限。</span></div></div>
          )}
          <label><span>部署级 Setup Token</span><Input.Password name="setupToken" required size="large" prefix={<LockOutlined />} placeholder="仅用于确认你有权修改本机发件配置" autoComplete="new-password" /></label>
          {error ? <div className={styles.formError} role="alert"><strong>暂时不能完成授权</strong><span>{error}</span></div> : null}
          {message ? <div className={styles.senderSuccess} role="status"><CheckCircleFilled /><span>{message}</span></div> : null}
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            {usesOAuth ? `前往${provider === "gmail" ? " Google" : " Microsoft"} 授权` : "验证并连接发件邮箱"}
          </Button>
        </form>
      </section>

      <section className={styles.senderSecurityNote}>
        <LockOutlined />
        <div><strong>安全边界</strong><span>授权码与 OAuth Refresh Token 使用 AES-256-GCM 加密后存入数据库；浏览器不写 localStorage、sessionStorage、URL 或应用日志。更换加密密钥前必须先重新授权。</span></div>
      </section>
    </main>
  );
}
