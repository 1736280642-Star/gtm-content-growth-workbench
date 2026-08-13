import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaLibraryAssetRecord, MediaLibraryAuditEvent } from "./media-library-contracts";

export interface MediaLibraryState {
  schemaVersion: 1;
  assets: Record<string, MediaLibraryAssetRecord>;
  audits: MediaLibraryAuditEvent[];
  idempotency: Record<string, { requestHash: string; response: unknown; createdAt: string }>;
}

function emptyState(): MediaLibraryState {
  return { schemaVersion: 1, assets: {}, audits: [], idempotency: {} };
}

function statePath() {
  return path.resolve(process.cwd(), process.env.V5_MEDIA_LIBRARY_STATE_PATH?.trim() || "data/v5-media-library.json");
}

export function mediaLibraryStorageDirectory() {
  return path.resolve(process.cwd(), process.env.V5_MEDIA_LIBRARY_STORAGE_PATH?.trim() || "data/v5-media-library-assets");
}

function normalizeState(value: Partial<MediaLibraryState>): MediaLibraryState {
  return {
    schemaVersion: 1,
    assets: value.assets && typeof value.assets === "object" ? value.assets : {},
    audits: Array.isArray(value.audits) ? value.audits : [],
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {}
  };
}

export async function readMediaLibraryState() {
  try {
    return normalizeState(JSON.parse(await readFile(statePath(), "utf8")) as Partial<MediaLibraryState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state: MediaLibraryState) {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

let writeQueue: Promise<void> = Promise.resolve();

export function updateMediaLibraryState<T>(mutator: (state: MediaLibraryState) => T | Promise<T>) {
  const operation = writeQueue.then(async () => {
    const state = await readMediaLibraryState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

