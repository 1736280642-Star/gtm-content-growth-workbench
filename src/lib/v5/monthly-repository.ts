import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BatchQueueItem,
  ExceptionItem,
  ScheduleDraftItem,
  StrategyTermHit,
  V5MonthlyPlanRecord
} from "./monthly-workspace-contracts";

export interface V5MonthlyAuditEvent {
  id: string;
  event: "monthly_plan_saved";
  month: string;
  actor: string;
  version: number;
  createdAt: string;
}

export interface V5IdempotencyRecord {
  requestHash: string;
  response: V5MonthlyPlanRecord;
  createdAt: string;
}

export interface V5MonthlyState {
  schemaVersion: 1;
  plans: Record<string, V5MonthlyPlanRecord>;
  strategyRows: Record<string, StrategyTermHit[]>;
  batchQueueItems: Record<string, BatchQueueItem[]>;
  exceptionItems: Record<string, ExceptionItem[]>;
  scheduleDraftItems: Record<string, ScheduleDraftItem[]>;
  auditLog: V5MonthlyAuditEvent[];
  idempotency: Record<string, V5IdempotencyRecord>;
}

function createEmptyState(): V5MonthlyState {
  return {
    schemaVersion: 1,
    plans: {},
    strategyRows: {},
    batchQueueItems: {},
    exceptionItems: {},
    scheduleDraftItems: {},
    auditLog: [],
    idempotency: {}
  };
}

function resolveStatePath() {
  const configuredPath = process.env.V5_MONTHLY_STATE_PATH?.trim();
  return path.resolve(process.cwd(), configuredPath || "data/v5-monthly-workbench.json");
}

function normalizeState(value: Partial<V5MonthlyState> | undefined): V5MonthlyState {
  const empty = createEmptyState();

  return {
    schemaVersion: 1,
    plans: value?.plans && typeof value.plans === "object" ? value.plans : empty.plans,
    strategyRows: value?.strategyRows && typeof value.strategyRows === "object" ? value.strategyRows : empty.strategyRows,
    batchQueueItems: value?.batchQueueItems && typeof value.batchQueueItems === "object" ? value.batchQueueItems : empty.batchQueueItems,
    exceptionItems: value?.exceptionItems && typeof value.exceptionItems === "object" ? value.exceptionItems : empty.exceptionItems,
    scheduleDraftItems: value?.scheduleDraftItems && typeof value.scheduleDraftItems === "object" ? value.scheduleDraftItems : empty.scheduleDraftItems,
    auditLog: Array.isArray(value?.auditLog) ? value.auditLog : empty.auditLog,
    idempotency: value?.idempotency && typeof value.idempotency === "object" ? value.idempotency : empty.idempotency
  };
}

export async function readV5MonthlyState(): Promise<V5MonthlyState> {
  try {
    const raw = await readFile(resolveStatePath(), "utf8");
    return normalizeState(JSON.parse(raw) as Partial<V5MonthlyState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyState();
    }

    throw error;
  }
}

async function writeV5MonthlyState(state: V5MonthlyState) {
  const statePath = resolveStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

let writeQueue: Promise<void> = Promise.resolve();

export function updateV5MonthlyState<T>(mutator: (state: V5MonthlyState) => Promise<T> | T): Promise<T> {
  const operation = writeQueue.then(async () => {
    const state = await readV5MonthlyState();
    const result = await mutator(state);
    await writeV5MonthlyState(state);
    return result;
  });

  writeQueue = operation.then(
    () => undefined,
    () => undefined
  );

  return operation;
}
