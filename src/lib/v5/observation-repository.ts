import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MonthlyReview, NextMonthProposal } from "./monthly-review-contracts";
import type {
  CaptureComparison,
  CapturedAnswer,
  FrontendCaptureArtifact,
  FrontendCaptureTask,
  ObservationGap,
  ObservationReview
} from "./observation-contracts";
import type { SiteAuditDiff, SiteAuditFinding, SiteAuditRun, SiteRemediationTask } from "./site-audit-contracts";

export interface ObservationAuditEvent {
  id: string;
  event: string;
  objectType: string;
  objectId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  sourceIds: string[];
  beforeVersion: number;
  afterVersion: number;
  createdAt: string;
}

interface ObservationIdempotencyRecord {
  requestHash: string;
  response: unknown;
  createdAt: string;
}

export interface V5ObservationState {
  schemaVersion: 1;
  tasks: Record<string, FrontendCaptureTask>;
  artifacts: Record<string, FrontendCaptureArtifact>;
  answers: Record<string, CapturedAnswer>;
  gaps: Record<string, ObservationGap>;
  reviews: Record<string, ObservationReview>;
  comparisons: Record<string, CaptureComparison>;
  monthlyReviews: Record<string, MonthlyReview>;
  proposals: Record<string, NextMonthProposal>;
  siteAuditRuns: Record<string, SiteAuditRun>;
  siteAuditFindings: Record<string, SiteAuditFinding>;
  siteRemediationTasks: Record<string, SiteRemediationTask>;
  siteAuditDiffs: Record<string, SiteAuditDiff>;
  auditLog: ObservationAuditEvent[];
  idempotency: Record<string, ObservationIdempotencyRecord>;
}

export function createEmptyObservationState(): V5ObservationState {
  return {
    schemaVersion: 1,
    tasks: {},
    artifacts: {},
    answers: {},
    gaps: {},
    reviews: {},
    comparisons: {},
    monthlyReviews: {},
    proposals: {},
    siteAuditRuns: {},
    siteAuditFindings: {},
    siteRemediationTasks: {},
    siteAuditDiffs: {},
    auditLog: [],
    idempotency: {}
  };
}

function resolveStatePath() {
  return path.resolve(process.cwd(), process.env.V5_OBSERVATION_STATE_PATH?.trim() || "data/v5-observation-review.json");
}

function resolveArtifactRoot() {
  return path.resolve(process.cwd(), process.env.V5_CAPTURE_ARTIFACT_ROOT?.trim() || "artifacts/v5-frontend-capture");
}

function normalizeState(value: Partial<V5ObservationState> | undefined): V5ObservationState {
  const empty = createEmptyObservationState();
  const record = <T>(candidate: unknown, fallback: Record<string, T>) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, T>) : fallback;
  return {
    schemaVersion: 1,
    tasks: record(value?.tasks, empty.tasks),
    artifacts: record(value?.artifacts, empty.artifacts),
    answers: record(value?.answers, empty.answers),
    gaps: record(value?.gaps, empty.gaps),
    reviews: record(value?.reviews, empty.reviews),
    comparisons: record(value?.comparisons, empty.comparisons),
    monthlyReviews: record(value?.monthlyReviews, empty.monthlyReviews),
    proposals: record(value?.proposals, empty.proposals),
    siteAuditRuns: record(value?.siteAuditRuns, empty.siteAuditRuns),
    siteAuditFindings: record(value?.siteAuditFindings, empty.siteAuditFindings),
    siteRemediationTasks: record(value?.siteRemediationTasks, empty.siteRemediationTasks),
    siteAuditDiffs: record(value?.siteAuditDiffs, empty.siteAuditDiffs),
    auditLog: Array.isArray(value?.auditLog) ? value.auditLog : [],
    idempotency: record(value?.idempotency, empty.idempotency)
  };
}

export async function readV5ObservationState(): Promise<V5ObservationState> {
  try {
    return normalizeState(JSON.parse(await readFile(resolveStatePath(), "utf8")) as Partial<V5ObservationState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createEmptyObservationState();
    throw error;
  }
}

async function writeState(state: V5ObservationState) {
  const statePath = resolveStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

let writeQueue: Promise<void> = Promise.resolve();

export function updateV5ObservationState<T>(mutator: (state: V5ObservationState) => Promise<T> | T): Promise<T> {
  const operation = writeQueue.then(async () => {
    const state = await readV5ObservationState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "dataBase64")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function hashObservationPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export async function persistImmutableCaptureArtifact(input: {
  taskId: string;
  captureSessionId: string;
  adapterVersion: string;
  browserVersion: string;
  manifest: unknown;
  screenshotBase64: string;
  screenshotMimeType: string;
}): Promise<FrontendCaptureArtifact> {
  const screenshot = Buffer.from(input.screenshotBase64, "base64");
  const screenshotSha256 = createHash("sha256").update(screenshot).digest("hex");
  const manifestSha256 = hashObservationPayload({ manifest: input.manifest, screenshotSha256 });
  const sha256 = createHash("sha256").update(`${manifestSha256}:${screenshotSha256}`).digest("hex");
  const taskDirectory = path.join(resolveArtifactRoot(), input.taskId);
  const screenshotArtifactId = `capture-screenshot-${screenshotSha256}`;
  const extension = input.screenshotMimeType === "image/jpeg" ? "jpg" : "png";
  await mkdir(taskDirectory, { recursive: true });

  const manifestPath = path.join(taskDirectory, `${sha256}.json`);
  const screenshotPath = path.join(taskDirectory, `${screenshotSha256}.${extension}`);
  const canonicalManifest = canonicalize(input.manifest) as Record<string, unknown>;
  const manifestBody = `${JSON.stringify({ ...canonicalManifest, screenshotArtifactId, screenshotSha256 }, null, 2)}\n`;

  try {
    await writeFile(manifestPath, manifestBody, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(manifestPath, "utf8");
    if (existing !== manifestBody) throw new Error("CAPTURE_ARTIFACT_IMMUTABILITY_CONFLICT");
  }
  try {
    await writeFile(screenshotPath, screenshot, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(screenshotPath);
    if (!existing.equals(screenshot)) throw new Error("CAPTURE_SCREENSHOT_IMMUTABILITY_CONFLICT");
  }

  return {
    id: `capture-artifact-${sha256}`,
    taskId: input.taskId,
    captureSessionId: input.captureSessionId,
    sha256,
    manifestSha256,
    screenshotArtifactId,
    screenshotSha256,
    screenshotByteLength: screenshot.byteLength,
    adapterVersion: input.adapterVersion,
    browserVersion: input.browserVersion,
    storageClass: "controlled_local",
    immutable: true,
    createdAt: new Date().toISOString()
  };
}

export function appendObservationAudit(
  state: V5ObservationState,
  input: Omit<ObservationAuditEvent, "id" | "createdAt">
) {
  state.auditLog.unshift({ id: randomUUID(), createdAt: new Date().toISOString(), ...input });
}

export function getIdempotentResponse<T>(state: V5ObservationState, scope: string, key: string, requestHash: string): T | undefined {
  const record = state.idempotency[`${scope}:${key}`];
  if (!record) return undefined;
  if (record.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
  return record.response as T;
}

export function setIdempotentResponse(state: V5ObservationState, scope: string, key: string, requestHash: string, response: unknown) {
  state.idempotency[`${scope}:${key}`] = { requestHash, response, createdAt: new Date().toISOString() };
}
