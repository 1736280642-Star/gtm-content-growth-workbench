"use client";

import { CheckOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AiFrontendConnection } from "@/lib/v5/observation-contracts";
import styles from "@/app/hosted-mode.module.css";

const platformLabels: Record<AiFrontendConnection["platform"], string> = {
  chatgpt: "ChatGPT",
  doubao: "豆包",
  deepseek: "DeepSeek",
  qwen: "千问"
};

const isolationLabels: Record<AiFrontendConnection["isolationPolicy"]["mode"], string> = {
  dedicated_account: "专用中立 AI 账号",
  dedicated_profile: "旧版专用浏览器档案",
  temporary_chat: "临时对话",
  memory_off: "已关闭记忆",
  new_conversation_only: "仅新对话"
};

interface AiTestResult {
  taskId: string;
  question: string;
  connectionId: string;
  wakeMessage: { type: "JOTO_CAPTURE_POLL"; taskId: string; connectionId: string };
}

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || (record.error as Record<string, unknown> | undefined)?.message || fallback);
}

async function wakeExtension(message: AiTestResult["wakeMessage"]): Promise<"woken" | "polling"> {
  const extensionId = process.env.NEXT_PUBLIC_V5_CAPTURE_EXTENSION_ID?.trim();
  const chromeApi = (globalThis as unknown as {
    chrome?: { runtime?: { lastError?: unknown; sendMessage?: (id: string, value: unknown, callback: (response?: { ok?: boolean }) => void) => void } };
  }).chrome;
  if (!extensionId || !chromeApi?.runtime?.sendMessage) return "polling";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: "woken" | "polling") => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish("polling"), 2_000);
    chromeApi.runtime!.sendMessage!(extensionId, message, (response) => {
      window.clearTimeout(timeout);
      finish(chromeApi.runtime?.lastError || response?.ok !== true ? "polling" : "woken");
    });
  });
}

export function HostedAiFrontendTestPanel({ productId }: { productId?: string }) {
  const [connections, setConnections] = useState<AiFrontendConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<(AiTestResult & { delivery: "woken" | "polling" })>();

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v5/ai-frontend-connections", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "AI 账号连接读取失败。"));
      const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      setConnections(Array.isArray(data.connections) ? data.connections : []);
    } catch (cause) {
      setConnections([]);
      setError(cause instanceof Error ? cause.message : "AI 账号连接读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  async function startTest(connection: AiFrontendConnection) {
    if (!productId) return setError("请先选择一个已有产品；新增产品完成资料治理后才能生成正式测试问题。");
    if (connection.status === "needs_login") return setError(`${platformLabels[connection.platform]} 登录已失效，请先重新绑定。`);
    setRunningId(connection.connectionId);
    setError(undefined);
    setResult(undefined);
    try {
      const idempotencyKey = `hosted-ai-test-${crypto.randomUUID()}`;
      const response = await fetch("/api/v5/hosted/ai-front-test", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ productId, connectionId: connection.connectionId, idempotencyKey })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "AI 前台测试启动失败。"));
      const data = (payload?.data && typeof payload.data === "object" ? payload.data : payload) as AiTestResult;
      setResult({ ...data, delivery: await wakeExtension(data.wakeMessage) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 前台测试启动失败。");
    } finally {
      setRunningId(undefined);
    }
  }

  if (loading) return <div className={styles.inlineLoading}><Spin size="small" /> 正在读取已绑定 AI 账号</div>;

  return (
    <>
      <div className={styles.connectionToolbar}><span>点击账号即发送测试问题，无需提前打开 AI 网站。</span><Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => loadConnections()}>刷新</Button></div>
      {connections.length ? <div className={styles.aiConnectionGrid}>{connections.map((connection) => {
        const neutral = connection.isolationPolicy.benchmarkCohort === "neutral_benchmark";
        const running = runningId === connection.connectionId;
        return <button className={`${styles.aiConnectionCard} ${connection.status === "needs_login" ? styles.needsAttention : ""}`} type="button" key={connection.connectionId} disabled={Boolean(runningId)} onClick={() => startTest(connection)}>
          <span className={styles.aiConnectionIcon}>{running ? <Spin size="small" /> : <RobotOutlined />}</span>
          <span className={styles.aiConnectionCopy}><strong>{platformLabels[connection.platform]} · {connection.accountAlias}</strong><span>{neutral ? "中立基线" : "个性化用户样本"} · {isolationLabels[connection.isolationPolicy.mode]}</span><small>{connection.status === "ready" ? "隔离已验证，点击即发送" : connection.status === "needs_login" ? "登录已失效，需要重新绑定" : connection.status === "offline" ? "伴侣离线，点击后进入待执行队列" : "首次执行将验证记忆隔离"}</small></span>
          <span className={styles.aiConnectionAction}>{running ? "正在启动" : "发送测试"}</span>
        </button>;
      })}</div> : <div className={styles.connectionEmpty}><span>还没有可用的 AI 前台账号。连接只保存别名，不读取或上传 Cookie。</span><Link href="/settings?tab=capture-devices">前往绑定账号</Link></div>}
      {!productId ? <div className={styles.connectionHint}>请先选择一个已有产品。</div> : null}
      {error ? <div className={styles.connectionError} role="alert">{error}</div> : null}
      {result ? <div className={styles.connectionSuccess} role="status"><CheckOutlined /><span><strong>测试问题已发送</strong>{result.delivery === "woken" ? "浏览器伴侣已接手，将在后台完成采集。" : "任务已进入队列，伴侣恢复后会自动执行。"}</span><Link href="/ai-front-test">查看任务</Link></div> : null}
    </>
  );
}
