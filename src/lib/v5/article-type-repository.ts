import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArticleTypeProfile,
  ArticleTypeProfileVersion,
  QuestionTypeMatchRun
} from "./article-type-contracts";

export interface ArticleTypeAuditEvent {
  auditId: string;
  event: "profile_created" | "profile_version_created" | "profile_activated" | "profile_disabled" | "profile_supplemented" | "type_match_run" | "type_match_confirmed";
  objectId: string;
  actor: string;
  auditReason: string;
  createdAt: string;
  summary?: Record<string, unknown>;
}

export interface ArticleTypeIdempotencyRecord {
  requestHash: string;
  response: unknown;
  createdAt: string;
}

export interface ArticleTypeState {
  schemaVersion: 1;
  profiles: Record<string, ArticleTypeProfile>;
  versions: Record<string, ArticleTypeProfileVersion>;
  matchRuns: Record<string, QuestionTypeMatchRun>;
  monthRunIds: Record<string, string[]>;
  auditLog: ArticleTypeAuditEvent[];
  idempotency: Record<string, ArticleTypeIdempotencyRecord>;
}

interface ArticleTypeTemplateSeed {
  templateId: string;
  name: string;
  semanticDescription: string;
  suitableQuestionDescription: string;
  targetAudience: string[];
  contentGoal: string;
  structureModules: string[];
  cta: string;
  lengthRange: { min: number; max: number; unit: "字" };
  styleTraits: string[];
  evidencePreferences: string[];
}

function resolveStatePath() {
  return path.resolve(process.cwd(), process.env.V5_ARTICLE_TYPE_STATE_PATH?.trim() || "data/v5-article-types.json");
}

async function createSeedState(): Promise<ArticleTypeState> {
  const raw = await readFile(path.resolve(process.cwd(), "data/v5-article-type-templates.json"), "utf8");
  const templates = JSON.parse(raw) as ArticleTypeTemplateSeed[];
  const now = new Date().toISOString();
  const profiles: Record<string, ArticleTypeProfile> = {};
  const versions: Record<string, ArticleTypeProfileVersion> = {};

  for (const template of templates) {
    const profileId = `system-template-${template.templateId}`;
    const profileVersionId = `${profileId}-v1`;
    const promptConstraintSnapshot = JSON.stringify({
      semanticDescription: template.semanticDescription,
      suitableQuestionDescription: template.suitableQuestionDescription,
      targetAudience: template.targetAudience,
      contentGoal: template.contentGoal,
      structureModules: template.structureModules,
      cta: template.cta,
      lengthRange: template.lengthRange,
      styleTraits: template.styleTraits,
      evidencePreferences: template.evidencePreferences
    });
    const promptConstraintSnapshotHash = createHash("sha256").update(promptConstraintSnapshot).digest("hex");
    versions[profileVersionId] = {
      profileVersionId,
      profileId,
      version: 1,
      name: template.name,
      semanticDescription: template.semanticDescription,
      suitableQuestionDescription: template.suitableQuestionDescription,
      unsuitableQuestionDescription: "",
      targetAudience: template.targetAudience,
      contentGoal: template.contentGoal,
      structureModules: template.structureModules,
      requiredSections: [],
      cta: template.cta,
      lengthRange: template.lengthRange,
      styleTraits: template.styleTraits,
      caseUsage: "仅使用知识库中已核验且允许公开的案例。",
      evidencePreferences: template.evidencePreferences,
      channelHints: [],
      exampleQuestions: [],
      promptConstraintSnapshot,
      promptConstraintSnapshotHash,
      fieldSources: Object.fromEntries([
        "name", "semanticDescription", "suitableQuestionDescription", "targetAudience", "contentGoal", "structureModules", "cta", "lengthRange", "styleTraits", "evidencePreferences"
      ].map((field) => [field, "template_inherited"])),
      status: "active",
      createdBy: "system_template",
      createdAt: now
    };
    profiles[profileId] = {
      profileId,
      revision: 1,
      origin: "system_template",
      status: "active",
      currentVersionId: profileVersionId,
      activeVersionId: profileVersionId,
      monthlyUsageCount: 0,
      createdAt: now,
      createdBy: "system_template",
      updatedAt: now,
      updatedBy: "system_template"
    };
  }

  return { schemaVersion: 1, profiles, versions, matchRuns: {}, monthRunIds: {}, auditLog: [], idempotency: {} };
}

function normalizeState(value: Partial<ArticleTypeState>, seed: ArticleTypeState): ArticleTypeState {
  return {
    schemaVersion: 1,
    profiles: value.profiles && typeof value.profiles === "object" ? value.profiles : seed.profiles,
    versions: value.versions && typeof value.versions === "object" ? value.versions : seed.versions,
    matchRuns: value.matchRuns && typeof value.matchRuns === "object" ? value.matchRuns : {},
    monthRunIds: value.monthRunIds && typeof value.monthRunIds === "object" ? value.monthRunIds : {},
    auditLog: Array.isArray(value.auditLog) ? value.auditLog : [],
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {}
  };
}

export async function readArticleTypeState(): Promise<ArticleTypeState> {
  const seed = await createSeedState();
  try {
    const raw = await readFile(resolveStatePath(), "utf8");
    return normalizeState(JSON.parse(raw) as Partial<ArticleTypeState>, seed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return seed;
    throw error;
  }
}

async function writeArticleTypeState(state: ArticleTypeState) {
  const statePath = resolveStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

let articleTypeWriteQueue: Promise<void> = Promise.resolve();

export function updateArticleTypeState<T>(mutator: (state: ArticleTypeState) => Promise<T> | T): Promise<T> {
  const operation = articleTypeWriteQueue.then(async () => {
    const state = await readArticleTypeState();
    const result = await mutator(state);
    await writeArticleTypeState(state);
    return result;
  });
  articleTypeWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
