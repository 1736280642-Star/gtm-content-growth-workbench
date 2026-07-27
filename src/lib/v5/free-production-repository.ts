import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FreeProductionAuditEvent, FreeProductionBatch, FreeProductionTask } from "./free-production-contracts";

export interface FreeProductionState {
  schemaVersion: 1;
  batches: Record<string, FreeProductionBatch>;
  tasks: Record<string, FreeProductionTask>;
  audits: FreeProductionAuditEvent[];
  idempotency: Record<string, { requestHash: string; response: unknown; createdAt: string }>;
}

function emptyState(): FreeProductionState {
  return { schemaVersion: 1, batches: {}, tasks: {}, audits: [], idempotency: {} };
}

function resolveStatePath() {
  return path.resolve(process.cwd(), process.env.V5_FREE_PRODUCTION_STATE_PATH?.trim() || "data/v5-free-production.json");
}

function normalizeState(value: Partial<FreeProductionState>): FreeProductionState {
  return {
    schemaVersion: 1,
    batches: value.batches && typeof value.batches === "object" ? value.batches : {},
    tasks: value.tasks && typeof value.tasks === "object" ? value.tasks : {},
    audits: Array.isArray(value.audits) ? value.audits : [],
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {}
  };
}

export async function readFreeProductionState() {
  try {
    return normalizeState(JSON.parse(await readFile(resolveStatePath(), "utf8")) as Partial<FreeProductionState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state: FreeProductionState) {
  const statePath = resolveStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

let writeQueue: Promise<void> = Promise.resolve();

export function updateFreeProductionState<T>(mutator: (state: FreeProductionState) => T | Promise<T>) {
  const operation = writeQueue.then(async () => {
    const state = await readFreeProductionState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
