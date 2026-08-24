/**
 * 演示模式内存存储。
 *
 * 语义：可交互但冷启动重置。同一进程内（warm serverless 实例）的写入会被
 * 保留，实例冷启动后从 fixtures 种子重放，回到"已跑通"的初始成功态。
 *
 * 使用 globalThis 挂载，避免同一进程内重复加载模块时产生多个互不相通的 store。
 */

interface DemoGlobal {
  __jotoDemoStore?: Map<string, unknown>;
}

function store(): Map<string, unknown> {
  const globalObject = globalThis as unknown as DemoGlobal;
  if (!globalObject.__jotoDemoStore) {
    globalObject.__jotoDemoStore = new Map<string, unknown>();
  }
  return globalObject.__jotoDemoStore;
}

export function demoRead<T>(key: string, seed: () => T): T {
  const map = store();
  if (!map.has(key)) map.set(key, seed());
  return map.get(key) as T;
}

export function demoWrite<T>(key: string, value: T): T {
  store().set(key, value);
  return value;
}

export function demoReset(key?: string): void {
  if (key) store().delete(key);
  else store().clear();
}

/** 演示模式内存收件箱（邮件 outbox）。 */
export const DEMO_OUTBOX_KEY = "demo:email-outbox";
