/**
 * Vercel 演示模式开关。
 *
 * 在演示模式下：
 *  - 存储切换到内存 DemoStore（冷启动从打包的 fixtures 重放）；
 *  - 邮件切换到内存 Outbox，不触发真实投递；
 *  - 托管登录支持固定验证码 000000 与一键演示登录；
 *  - 所有外部 API 供应商在 provider 边界短路为仿真成功数据。
 *
 * 本目录只承载演示适配层，不得引入业务领域逻辑；mock UI 数据与产品名
 * 仅允许出现在 fixtures 中，不得写进 src/lib/v5 领域代码。
 */

export const DEMO_MODE_ENV = "DEMO_MODE";

export function isDemoMode(): boolean {
  return String(process.env.DEMO_MODE ?? "").trim().toLowerCase() === "true";
}

/** 演示环境固定验证码。 */
export const DEMO_LOGIN_CODE = "000000";

/** 演示环境固定月份（用于月度计划 / 复盘的"已跑通"快照）。 */
export const DEMO_MONTH = "2026-08";

/** 仿真外部 API 的轻微延迟，贴近真实体验。 */
export function demoLatencyMs(baseMs = 120, jitterMs = 140): number {
  return Math.max(0, Math.round(baseMs + Math.random() * jitterMs));
}

export function demoId(prefix: string): string {
  return `${prefix}-demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
