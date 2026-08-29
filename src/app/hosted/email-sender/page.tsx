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
import {
  detectHostedEmailProvider,
  hostedEmailProviderDetails,
  type HostedEmailProvider
} from "./provider";

interface SenderStatus {
  configured: boolean;
  provider?: HostedEmailProvider;
  authType?: string;
  status?: string;
  senderHint?: string;
}

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nextAction = typeof record.nextAction === "string" ? record.nextAction : "";
  return `${String(record.message || fallback)}${nextAction ? ` ${nextAction}` : ""}`;
}

export default function HostedEmailSenderPage() {
  const [email, setEmail] = useState("");
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
    const provider = detectHostedEmailProvider(email);
    if (!provider) {
      setError("暂时无法识别这个邮箱服务商。请使用已支持的 QQ、163、阿里云企业邮箱、Gmail 或 Outlook 地址。");
      return;
    }
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

  const provider = detectHostedEmailProvider(email);
  const selected = provider ? hostedEmailProviderDetails[provider] : undefined;
  const usesOAuth = provider === "gmail" || provider === "outlook";

  return (
    <main className={styles.senderSetupPage}>
      <header className={styles.senderSetupHeader}>
        <div>
          <div className={styles.kicker}>PERSONAL EMAIL SENDER</div>
          <h1>连接你的发件邮箱</h1>
          <p>输入发件邮箱后，系统会自动识别 QQ、163、阿里云企业邮箱、Gmail 或 Outlook。授权只保存在服务端，页面不会保存授权码、Token 或邮箱密码。</p>
        </div>
        <Link href="/?role=deployment#deployment-email"><Button icon={<ArrowLeftOutlined />}>返回部署人员面板</Button></Link>
      </header>

      {loading ? <section className={styles.senderStatusCard}><Spin /><span>正在读取发件邮箱状态</span></section> : status?.configured ? (
        <section className={styles.senderConnectedCard}>
          <CheckCircleFilled />
          <div><strong>当前发件邮箱已连接</strong><span>{status.provider ? hostedEmailProviderDetails[status.provider]?.name : "已连接邮箱"} · {status.senderHint}</span></div>
          <small>重新完成下方授权会安全替换当前连接。</small>
        </section>
      ) : (
        <section className={styles.senderStatusCard}><MailOutlined /><div><strong>尚未连接发件邮箱</strong><span>完成一次授权后，邮箱登录与结果通知会自动使用该连接。</span></div></section>
      )}

      <section className={styles.senderSetupCard}>
        <div className={styles.senderSectionTitle}><span>1</span><div><strong>填写发件邮箱</strong><small>系统根据邮箱域名自动选择授权方式，不需要手动选择服务商。</small></div></div>
        <label className={styles.senderEmailField}>
          <span>发件邮箱地址</span>
          <Input
            type="email"
            required
            size="large"
            prefix={<MailOutlined />}
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(""); setMessage(""); }}
            placeholder="name@qq.com"
            autoComplete="username"
            aria-describedby="sender-provider-result"
          />
        </label>
        <div
          id="sender-provider-result"
          className={`${styles.senderProviderResult} ${email.trim() && !selected ? styles.senderProviderUnknown : ""}`}
          role={email.trim() && !selected ? "alert" : "status"}
        >
          {selected ? <>
            <span className={styles.senderProviderMark}>{selected.key === "163" ? "163" : selected.name.slice(0, 1)}</span>
            <div><strong>已识别为 {selected.name}</strong><small>接下来使用 {selected.method}</small></div>
            <CheckCircleFilled />
          </> : <>
            <MailOutlined />
            <div><strong>{email.trim() ? "暂不支持这个邮箱域名" : "等待输入邮箱地址"}</strong><small>{email.trim() ? "目前支持 @qq.com、@163.com、@jotoglobal.com、@gmail.com、@outlook.com、@hotmail.com、@live.com 和 @msn.com。其他企业自定义域名需要先核对 MX 服务商。" : "输入后会在这里显示识别结果和授权方式。"}</small></div>
          </>}
        </div>
      </section>

      <section className={styles.senderSetupCard}>
        <div className={styles.senderSectionTitle}><span>2</span><div><strong>完成授权</strong><small>{selected?.description || "先填写上方邮箱，系统会显示对应的授权步骤。"}</small></div></div>
        {provider && selected ? <form className={styles.senderSetupForm} onSubmit={submit} autoComplete="off">
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="email" value={email.trim()} />
          {!usesOAuth ? <>
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
        </form> : <div className={styles.senderSetupPending}><MailOutlined /><span>识别出受支持的邮箱后，授权表单会自动显示。</span></div>}
      </section>

      <section className={styles.senderCredentialGuide} aria-labelledby="sender-credential-guide-title">
        <div className={styles.senderCredentialGuideTitle}>
          <SafetyCertificateOutlined />
          <div><strong id="sender-credential-guide-title">SMTP 授权码和 Setup Token 从哪里获得</strong><span>它们来自不同地方，都不是邮箱登录密码。</span></div>
        </div>
        <div className={styles.senderCredentialGuideGrid}>
          <article>
            <strong>SMTP 授权码</strong>
            <p>这是 QQ、163 或阿里云企业邮箱为第三方发信工具生成的专用凭据，只允许工作台通过 SMTP 发信。</p>
            <ol>
              <li>登录对应邮箱的网页版设置。</li>
              <li>找到“POP3 / IMAP / SMTP”“客户端授权密码”或“三方客户端安全密码”。</li>
              <li>开启 SMTP，按邮箱安全验证要求生成授权码。</li>
              <li>把授权码填入上方字段，不要填写邮箱登录密码。</li>
            </ol>
          </article>
          <article>
            <strong>部署级 Setup Token</strong>
            <p>这是工作台自己的部署管理口令，不由邮箱供应商提供。它用于防止普通访问者修改整个部署共用的发件邮箱。</p>
            <ol>
              <li>由部署管理员使用密码管理器生成至少 32 位随机值。</li>
              <li>本地 Docker 写入被 Git 忽略的 <code>.env.local</code>，变量名为 <code>HOSTED_EMAIL_SETUP_TOKEN</code>。</li>
              <li>同时配置 32 字节的 <code>HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY</code>，用于加密保存授权信息。</li>
              <li>保存后重新构建 3027；服务器部署也需在部署机更新 .env.local 并重建 Web 容器。</li>
            </ol>
          </article>
        </div>
        <p className={styles.senderCredentialWarning}>不要把授权码、Setup Token、加密密钥放进 Git、聊天、截图或公开文档。页面只在提交时发送这些值。</p>
      </section>

      <section className={styles.senderSecurityNote}>
        <LockOutlined />
        <div><strong>安全边界</strong><span>授权码与 OAuth Refresh Token 使用 AES-256-GCM 加密后存入数据库；浏览器不写 localStorage、sessionStorage、URL 或应用日志。更换加密密钥前必须先重新授权。</span></div>
      </section>
    </main>
  );
}
