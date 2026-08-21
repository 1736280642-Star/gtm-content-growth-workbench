"use client";

import { LoadingOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../../hosted-mode.module.css";

export default function HostedLoginVerifyPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("登录链接缺少一次性令牌，请重新获取。");
      return;
    }
    void fetch("/api/v5/hosted/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.message || "登录链接无效、已使用或已过期。"));
      window.location.replace(String(payload.redirectTo || "/"));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "登录验证失败，请重新获取链接。"));
  }, []);

  return <main className={styles.identityPage}><section className={styles.identityCard}>
    {error ? <><h1>无法完成登录</h1><p>{error}</p><Link href="/hosted/login"><Button type="primary" size="large">重新获取登录链接</Button></Link></>
      : <><LoadingOutlined spin className={styles.identityIcon} /><h1>正在安全登录</h1><p>一次性链接验证完成后会自动进入你的工作区。</p></>}
  </section></main>;
}
