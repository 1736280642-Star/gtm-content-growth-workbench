"use client";

import { CheckCircleFilled, ClockCircleOutlined, ReloadOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AiFrontendPlatform } from "@/lib/v5/observation-contracts";
import styles from "@/app/hosted-mode.module.css";

interface CaptureReadiness {
  serviceOnline: boolean;
  availablePlatforms: AiFrontendPlatform[];
}
interface CaptureTask {
  taskId: string;
  platform: AiFrontendPlatform;
  status: string;
  question?: string;
  message?: string;
}

const platforms: Array<{ key: AiFrontendPlatform; label: string; detail: string }> = [
  { key: "chatgpt", label: "ChatGPT", detail: "部署服务器上的中立测试账号" },
  { key: "doubao", label: "豆包", detail: "部署服务器上的中立测试账号" },
  { key: "deepseek", label: "DeepSeek", detail: "部署服务器上的中立测试账号" },
  { key: "qwen", label: "千问", detail: "部署服务器上的中立测试账号" }
];

const statusCopy: Record<string, string> = {
  pending: "正在排队",
  leased: "服务器正在执行",
  completed: "采集已完成",
  failed: "执行失败",
  cancelled: "任务已取消"
};

function unwrap<T>(payload: unknown): T {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return (record.data && typeof record.data === "object" ? record.data : record) as T;
}

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return String(nested.message || record.message || fallback);
}

export function HostedAiCaptureRequestPanel({ productId }: { productId?: string }) {
  const [readiness, setReadiness] = useState<CaptureReadiness>();
  const [platform, setPlatform] = useState<AiFrontendPlatform>();
  const [task, setTask] = useState<CaptureTask>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v5/hosted/ai-capture-setup", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "共享采集服务状态读取失败。"));
      setReadiness(unwrap<CaptureReadiness>(payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "共享采集服务状态读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadReadiness(); }, [loadReadiness]);

  async function submitRequest() {
    if (!productId) return setError("请先完成产品选择和委托创建，再发送 AI 前台测试请求。");
    if (!platform) return setError("请选择一个可用的 AI 测试平台。");
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v5/hosted/ai-front-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, platform, idempotencyKey: `hosted-ai-test-${crypto.randomUUID()}` })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "AI 前台测试请求发送失败。"));
      setTask(unwrap<CaptureTask>(payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 前台测试请求发送失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshTask() {
    if (!task) return;
    setChecking(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/ai-front-test?taskId=${encodeURIComponent(task.taskId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "任务状态读取失败。"));
      setTask((current) => ({ ...current!, ...unwrap<CaptureTask>(payload) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务状态读取失败。");
    } finally {
      setChecking(false);
    }
  }

  if (loading) return <div className={styles.inlineLoading}><Spin size="small" /> 正在检查 24 小时采集服务器</div>;

  return (
    <div className={styles.aiRequestPanel}>
      <div className={`${styles.aiServiceBanner} ${readiness?.serviceOnline ? styles.aiServiceOnline : styles.aiServiceOffline}`}>
        <RobotOutlined />
        <div><strong>{readiness?.serviceOnline ? "部署级采集服务器在线" : "部署级采集服务器暂时离线"}</strong><span>{readiness?.serviceOnline ? "你只需选择平台并发送请求，扩展、账号和浏览器由部署人员维护。" : "请联系部署人员恢复 24 小时 Windows 服务器；普通用户无需检查自己的电脑。"}</span></div>
        <Button type="text" icon={<ReloadOutlined />} onClick={() => void loadReadiness()}>刷新</Button>
      </div>

      <div className={styles.aiPlatformRequestGrid} aria-label="选择 AI 前台测试平台">
        {platforms.map((item) => {
          const available = readiness?.availablePlatforms.includes(item.key) === true;
          const selected = platform === item.key;
          return <button type="button" key={item.key} disabled={!available || Boolean(task)} aria-pressed={selected} className={`${styles.aiPlatformRequestCard} ${selected ? styles.isSelected : ""}`} onClick={() => setPlatform(item.key)}><strong>{item.label}</strong><span>{available ? item.detail : "部署人员尚未配置或账号已离线"}</span><small>{available ? "可发送请求" : "暂不可用"}</small></button>;
        })}
      </div>

      {task ? <div className={styles.aiRequestReceipt} role="status">
        {task.status === "completed" ? <CheckCircleFilled /> : <ClockCircleOutlined />}
        <div><strong>{statusCopy[task.status] || task.status}</strong><span>任务 {task.taskId} · {platforms.find((item) => item.key === task.platform)?.label || task.platform}</span>{task.question ? <small>本次问题：{task.question}</small> : null}</div>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={refreshTask}>查看最新状态</Button>
      </div> : <div className={styles.aiRequestAction}><span>发送后可以关闭页面，任务会留在部署服务器队列中继续执行。</span><Button type="primary" size="large" icon={<SendOutlined />} disabled={!platform || !readiness?.serviceOnline || !productId} loading={submitting} onClick={submitRequest}>发送 AI 前台测试请求</Button></div>}
      {error ? <div className={styles.connectionError} role="alert">{error}</div> : null}
    </div>
  );
}
