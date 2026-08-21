"use client";

import { CheckCircleOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useEffect, useState } from "react";
import styles from "../../hosted-mode.module.css";

function readError(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || "登录邮件发送失败，请稍后重试。");
}

export default function HostedLoginPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) {
      setError("登录链接无效、已使用或已过期，请重新获取。");
    }
  }, []);

  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("请输入有效的邮箱地址。");
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/v5/hosted/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload));
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录邮件发送失败，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={styles.identityPage}>
      <section className={styles.identityCard}>
        <div className={styles.kicker}>SECURE WORKSPACE ACCESS</div>
        {sent ? <>
          <CheckCircleOutlined className={styles.identityIcon} />
          <h1>检查你的邮箱</h1>
          <p>登录链接已发送到 <strong>{email}</strong>。链接15分钟内有效且只能使用一次。</p>
          <div className={styles.authorizationCallout}>打开邮件后会自动回到当前工作台，不需要设置密码。</div>
          <Button size="large" onClick={() => setSent(false)}>重新发送</Button>
        </> : <>
          <LockOutlined className={styles.identityIcon} />
          <h1>登录 GEO 托管工作台</h1>
          <p>使用工作邮箱登录。系统只把邮箱用于工作区身份、关键确认和发布结果通知。</p>
          <label className={styles.identityField}><span>工作邮箱</span><Input size="large" prefix={<MailOutlined />} value={email} onChange={(event) => setEmail(event.target.value)} onPressEnter={submit} placeholder="name@company.com" /></label>
          {error ? <div className={styles.formError}><strong>暂时不能登录</strong><span>{error}</span></div> : null}
          <Button type="primary" size="large" block loading={sending} onClick={submit}>发送登录链接</Button>
          <small>不使用共享密码；登录会话保存在 HttpOnly Cookie 中。</small>
        </>}
      </section>
    </main>
  );
}
