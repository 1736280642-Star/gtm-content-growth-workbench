import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WechatVisualPlanRecord } from "./wechat-visual-contracts";

export interface WechatVisualState {
  schemaVersion: 1;
  plans: Record<string, WechatVisualPlanRecord>;
  currentPlanByBatch: Record<string, string>;
  idempotency: Record<string, { requestHash: string; responsePlanId: string; createdAt: string }>;
}

function emptyState(): WechatVisualState {
  return { schemaVersion: 1, plans: {}, currentPlanByBatch: {}, idempotency: {} };
}

function statePath() {
  return path.resolve(process.cwd(), process.env.V5_WECHAT_VISUAL_STATE_PATH?.trim() || "data/v5-wechat-visual-plans.json");
}

export function wechatVisualCandidateDirectory() {
  return path.resolve(process.cwd(), process.env.V5_WECHAT_VISUAL_STORAGE_PATH?.trim() || "data/v5-wechat-visual-candidates");
}

function normalizeState(value: Partial<WechatVisualState>): WechatVisualState {
  return {
    schemaVersion: 1,
    plans: value.plans && typeof value.plans === "object" ? value.plans : {},
    currentPlanByBatch: value.currentPlanByBatch && typeof value.currentPlanByBatch === "object" ? value.currentPlanByBatch : {},
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {}
  };
}

export async function readWechatVisualState() {
  try {
    return normalizeState(JSON.parse(await readFile(statePath(), "utf8")) as Partial<WechatVisualState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state: WechatVisualState) {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

let writeQueue: Promise<void> = Promise.resolve();

export function updateWechatVisualState<T>(mutator: (state: WechatVisualState) => T | Promise<T>) {
  const operation = writeQueue.then(async () => {
    const state = await readWechatVisualState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function writeWechatVisualCandidate(candidateId: string, data: Buffer) {
  if (!/^wechat-visual-candidate-[0-9a-f-]{36}$/i.test(candidateId)) throw new Error("候选图片标识格式无效。");
  const directory = wechatVisualCandidateDirectory();
  await mkdir(directory, { recursive: true });
  const storageKey = candidateId;
  await writeFile(path.join(directory, storageKey), data, { flag: "wx" });
  return { storageKey, contentHash: createHash("sha256").update(data).digest("hex") };
}

export async function readWechatVisualCandidate(storageKey: string, expectedHash: string) {
  if (!/^wechat-visual-candidate-[0-9a-f-]{36}$/i.test(storageKey)) throw new Error("候选图片存储引用格式无效。");
  const data = await readFile(path.join(wechatVisualCandidateDirectory(), storageKey));
  const contentHash = createHash("sha256").update(data).digest("hex");
  if (contentHash !== expectedHash) throw new Error("候选图片完整性校验失败。");
  return data;
}
