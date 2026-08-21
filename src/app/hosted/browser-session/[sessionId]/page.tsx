"use client";

import { CheckCircleOutlined, CloudServerOutlined, LoadingOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "../../../hosted-mode.module.css";

type SessionView = { orderId: string; channel: string; status: string; failureMessage?: string };

export default function HostedBrowserSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params.sessionId || "");
  const [session, setSession] = useState<SessionView>();
  const [interactiveUrl, setInteractiveUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    const refresh = () => fetch(`/api/v5/hosted/authorization-sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload.message || "授权会话读取失败。"));
        setSession(payload.session as SessionView);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "授权会话读取失败。"));
    void refresh();
    const source = new EventSource(`/api/v5/hosted/authorization-sessions/${encodeURIComponent(sessionId)}/events`);
    source.addEventListener("window_opened", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { payload?: { interactiveUrl?: string } };
        const url = new URL(String(data.payload?.interactiveUrl || ""));
        if (url.protocol === "https:") setInteractiveUrl(url.toString());
      } catch { /* A local executor may open its own visible browser window. */ }
      void refresh();
    });
    for (const name of ["waiting_for_login", "manual_takeover_required", "account_detected", "failed", "terminal"]) {
      source.addEventListener(name, () => void refresh());
    }
    source.onerror = () => source.close();
    return () => source.close();
  }, [sessionId]);

  const finished = ["account_detected", "confirmed"].includes(session?.status || "");
  return <main className={styles.identityPage}><section className={styles.identityCard}>
    {finished ? <CheckCircleOutlined className={styles.identityIcon} /> : session ? <CloudServerOutlined className={styles.identityIcon} /> : <LoadingOutlined spin className={styles.identityIcon} />}
    <h1>{finished ? "账号识别完成" : "云端安全浏览器"}</h1>
    <p>{error || session?.failureMessage || (interactiveUrl ? "安全交互会话已经就绪，请在新窗口完成平台登录。" : "正在分配当前工作区的隔离浏览器。若执行节点部署在本地，会直接打开一个独立浏览器窗口。")}</p>
    {interactiveUrl ? <a href={interactiveUrl} target="_blank" rel="noreferrer"><Button type="primary" size="large">打开安全登录窗口</Button></a> : null}
    {session?.orderId ? <Link href={`/hosted/connections?orderId=${encodeURIComponent(session.orderId)}`}><Button size="large">返回连接向导</Button></Link> : null}
    <small>系统不会在此页面展示或保存平台 Cookie、密码与 Token。</small>
  </section></main>;
}
