import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { V5ArticleExpressionProfile, V5ArticleExpressionProfileVersion } from "./article-expression-contracts";
import type {
  V5KnowledgeActionItem,
  V5KnowledgeBaseWorkspace,
  V5KnowledgeMaterialView,
  V5KnowledgeUnderstandingItem
} from "./knowledge-workspace-contracts";
import type {
  V5AuditRecord,
  V5ContentCoverageRow,
  V5MonthlyQuestionLock,
  V5QuestionDecisionException,
  V5QuestionSet,
  V5QuestionVersion,
  V5SemanticKeyword
} from "./question-contracts";

export interface V5FoundationIdempotencyRecord {
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  response: unknown;
  createdAt: string;
}

export interface V5FoundationState {
  schemaVersion: 1;
  version: number;
  questions: V5QuestionSet[];
  questionVersions: V5QuestionVersion[];
  keywords: V5SemanticKeyword[];
  decisionExceptions: V5QuestionDecisionException[];
  monthlyQuestionLocks: V5MonthlyQuestionLock[];
  contentCoverage: V5ContentCoverageRow[];
  knowledgeBases: V5KnowledgeBaseWorkspace[];
  knowledgeMaterials: V5KnowledgeMaterialView[];
  knowledgeUnderstanding: V5KnowledgeUnderstandingItem[];
  knowledgeActionItems: V5KnowledgeActionItem[];
  articleExpressionProfiles: V5ArticleExpressionProfile[];
  articleExpressionProfileVersions: V5ArticleExpressionProfileVersion[];
  audits: V5AuditRecord[];
  idempotency: V5FoundationIdempotencyRecord[];
}

export class V5FoundationRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly nextAction?: string
  ) {
    super(message);
    this.name = "V5FoundationRepositoryError";
  }
}

function statePath() {
  return resolve(process.cwd(), process.env.V5_FOUNDATION_STATE_PATH || "data/v5-foundation-state.json");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyState(): V5FoundationState {
  return {
    schemaVersion: 1,
    version: 0,
    questions: [],
    questionVersions: [],
    keywords: [],
    decisionExceptions: [],
    monthlyQuestionLocks: [],
    contentCoverage: [],
    knowledgeBases: [],
    knowledgeMaterials: [],
    knowledgeUnderstanding: [],
    knowledgeActionItems: [],
    articleExpressionProfiles: [],
    articleExpressionProfileVersions: [],
    audits: [],
    idempotency: []
  };
}

export function hashV5FoundationPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createV5FoundationId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function readV5FoundationState(): V5FoundationState {
  const path = statePath();
  if (!existsSync(path)) return emptyState();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<V5FoundationState>;
  return {
    ...emptyState(),
    ...parsed,
    schemaVersion: 1,
    version: Number.isInteger(parsed.version) ? Number(parsed.version) : 0
  };
}

function writeV5FoundationState(state: V5FoundationState) {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function readV5FoundationSnapshot() {
  return clone(readV5FoundationState());
}

export function mutateV5FoundationState<T>(input: {
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  mutate: (state: V5FoundationState) => T;
}): { data: T; replayed: boolean; stateVersion: number } {
  const state = readV5FoundationState();
  const existing = state.idempotency.find(
    (item) => item.operation === input.operation && item.idempotencyKey === input.idempotencyKey
  );
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      throw new V5FoundationRepositoryError(
        "idempotency_conflict",
        "同一幂等键被用于不同请求。",
        409,
        "为本次业务动作生成新的 idempotencyKey 后重试。"
      );
    }
    return { data: clone(existing.response as T), replayed: true, stateVersion: state.version };
  }

  const data = input.mutate(state);
  state.version += 1;
  state.idempotency = [
    ...state.idempotency.slice(-499),
    {
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      response: clone(data),
      createdAt: new Date().toISOString()
    }
  ];
  writeV5FoundationState(state);
  return { data: clone(data), replayed: false, stateVersion: state.version };
}

export function appendV5FoundationAudit(
  state: V5FoundationState,
  input: Omit<V5AuditRecord, "auditId" | "createdAt">
) {
  const audit: V5AuditRecord = {
    ...input,
    auditId: createV5FoundationId("audit"),
    createdAt: new Date().toISOString()
  };
  state.audits = [audit, ...state.audits].slice(0, 1000);
  return audit;
}
