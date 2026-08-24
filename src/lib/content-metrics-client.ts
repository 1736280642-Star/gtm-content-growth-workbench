import { isDemoMode } from "./demo/config";
import type { V5ConfigurationStatusItem } from "./v5/article-expression-contracts";
import type { ContentMonitorPlatform } from "./v5/content-monitor-contracts";

const platformLabels: Record<ContentMonitorPlatform, string> = {
  wechat: "微信公众号",
  csdn: "CSDN",
  juejin: "掘金",
  zhihu: "知乎"
};

export function getContentMetricsRunnerUrl() {
  return String(process.env.CONTENT_METRICS_RUNNER_URL || "").trim().replace(/\/$/, "");
}

export function isTrustedContentMetricsRunnerUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]", "content-metrics-runner"].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function fetchContentMetricsRunner(path: string, init?: RequestInit) {
  const runnerUrl = getContentMetricsRunnerUrl();
  const token = String(process.env.CONTENT_METRICS_RUNNER_TOKEN || "").trim();
  if (!runnerUrl || !token) throw new Error("内容指标采集器尚未配置。");
  if (!isTrustedContentMetricsRunnerUrl(runnerUrl)) throw new Error("内容指标采集器只能使用本机地址或 Docker 私有服务名 content-metrics-runner。");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${runnerUrl}${path}`, { ...init, headers, signal: init?.signal || AbortSignal.timeout(90_000) });
}

interface RunnerAuthorizationStatus {
  platform: ContentMonitorPlatform;
  status: "ready" | "pending_config" | "unverified" | "auth_required";
  authenticated: boolean;
  checkedAt?: string;
  message: string;
  missingConfig?: string[];
}

function pendingItems(message: string): V5ConfigurationStatusItem[] {
  return (["wechat", "csdn", "juejin", "zhihu"] as ContentMonitorPlatform[]).map((platform) => ({
    key: `content_metrics_${platform}`,
    label: `${platformLabels[platform]}内容指标`,
    purpose: "获取已发布内容的浏览量、点赞数和收藏数",
    category: "content_metrics_connection",
    status: "pending_config",
    nextAction: message
  }));
}

export async function getContentMetricsConfigurationStatus(): Promise<V5ConfigurationStatusItem[]> {
  if (isDemoMode()) {
    return (["wechat", "csdn", "juejin", "zhihu"] as ContentMonitorPlatform[]).map((platform) => ({
      key: `content_metrics_${platform}`,
      label: `${platformLabels[platform]}内容指标`,
      purpose: "获取已发布内容的浏览量、点赞数和收藏数",
      category: "content_metrics_connection",
      status: "ready",
      lastCheckedAt: new Date().toISOString(),
      nextAction: "授权有效，系统每 6 小时自动更新。"
    }));
  }
  const runnerUrl = getContentMetricsRunnerUrl();
  const token = String(process.env.CONTENT_METRICS_RUNNER_TOKEN || "").trim();
  if (!runnerUrl || !token) return pendingItems("配置 CONTENT_METRICS_RUNNER_URL 与 CONTENT_METRICS_RUNNER_TOKEN 后重新检查。");
  if (!isTrustedContentMetricsRunnerUrl(runnerUrl)) return pendingItems("采集器地址必须是本机地址或 Docker 私有服务名 content-metrics-runner。");
  try {
    const response = await fetchContentMetricsRunner("/auth/status", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => ({})) as { platforms?: RunnerAuthorizationStatus[] };
    if (!response.ok || !Array.isArray(payload.platforms)) throw new Error(`采集器返回 HTTP ${response.status}`);
    const byPlatform = new Map(payload.platforms.map((item) => [item.platform, item]));
    return (["wechat", "csdn", "juejin", "zhihu"] as ContentMonitorPlatform[]).map((platform) => {
      const item = byPlatform.get(platform);
      const ready = item?.status === "ready" && item.authenticated;
      const failed = item?.status === "auth_required";
      return {
        key: `content_metrics_${platform}`,
        label: `${platformLabels[platform]}内容指标`,
        purpose: "获取已发布内容的浏览量、点赞数和收藏数",
        category: "content_metrics_connection",
        status: ready ? "ready" : failed ? "failed" : "pending_config",
        lastCheckedAt: item?.checkedAt,
        nextAction: ready
          ? `${item?.message || "授权有效。"} 系统每 6 小时自动更新。`
          : item?.status === "unverified"
            ? `${item.message} 补充 ${item.missingConfig?.join(", ") || "授权检查地址"} 后重新检查。`
            : item?.message || "检查平台授权配置。"
      };
    });
  } catch (error) {
    return pendingItems(`内容指标采集器不可达：${error instanceof Error ? error.message : "连接失败"}`);
  }
}
