import { createHash, randomUUID } from "node:crypto";
import { readWorkbenchState } from "@/lib/workbench-store";
import type { WorkspaceRole } from "@/lib/types";
import type {
  ArticleTypeActivateRequest,
  ArticleTypePatchRequest,
  ArticleTypeProfile,
  ArticleTypeProfileDraftInput,
  ArticleTypeProfileSummary,
  ArticleTypeProfileVersion,
  ArticleTypeSupplementRequest,
  ArticleTypeSupplementResult,
  ArticleTypeWriteRequest,
  QuestionTypeMatchConfirmRequest,
  QuestionTypeMatchRequest,
  QuestionTypeMatchRun,
  QuestionTypeSuggestion
} from "./article-type-contracts";
import { readArticleTypeState, updateArticleTypeState, type ArticleTypeState } from "./article-type-repository";
import { ARTICLE_TYPE_PROMPT_VERSION, createArticleTypeSemanticProvider, type ArticleTypeSemanticProvider } from "./article-type-semantic-provider";

const WRITE_ROLES = new Set<WorkspaceRole>(["content_growth", "workbench_operator", "developer_admin"]);
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ArticleTypeServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = "ArticleTypeServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanStrings(value: unknown, limit = 12) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, limit)
    : [];
}

function requireActor() {
  const actor = readWorkbenchState().workspaceSetting.currentRole;
  if (!WRITE_ROLES.has(actor)) {
    throw new ArticleTypeServiceError(403, "ARTICLE_TYPE_FORBIDDEN", "当前角色无权维护内容类型，请切换到内容增长、工作台运营或开发管理员。" );
  }
  return actor;
}

function requireIdempotencyKey(value: string | null) {
  const key = value?.trim() || "";
  if (key.length < 8 || key.length > 200) {
    throw new ArticleTypeServiceError(400, "INVALID_IDEMPOTENCY_KEY", "写请求必须携带 8 到 200 字符的 x-idempotency-key。" );
  }
  return key;
}

function requireAuditReason(value: string) {
  const reason = value?.trim() || "";
  if (!reason || reason.length > 200) throw new ArticleTypeServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的操作原因。" );
  return reason;
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compilePromptConstraint(input: Omit<ArticleTypeProfileVersion, "promptConstraintSnapshot" | "promptConstraintSnapshotHash">) {
  const snapshot = JSON.stringify({
    name: input.name,
    semanticDescription: input.semanticDescription,
    suitableQuestionDescription: input.suitableQuestionDescription,
    unsuitableQuestionDescription: input.unsuitableQuestionDescription,
    targetAudience: input.targetAudience,
    contentGoal: input.contentGoal,
    structureModules: input.structureModules,
    requiredSections: input.requiredSections,
    cta: input.cta,
    lengthRange: input.lengthRange,
    styleTraits: input.styleTraits,
    caseUsage: input.caseUsage,
    evidencePreferences: input.evidencePreferences,
    channelHints: input.channelHints
  });
  return { snapshot, hash: createHash("sha256").update(snapshot).digest("hex") };
}

function normalizeDraftInput(input: ArticleTypeProfileDraftInput, base?: ArticleTypeProfileVersion) {
  const name = String(input.name || base?.name || "").trim();
  const semanticDescription = String(input.semanticDescription || base?.semanticDescription || "").trim();
  const suitableQuestionDescription = String(input.suitableQuestionDescription || base?.suitableQuestionDescription || "").trim();
  const contentGoal = String(input.contentGoal || base?.contentGoal || "").trim();
  const min = Number(input.lengthRange?.min ?? base?.lengthRange.min ?? 1200);
  const max = Number(input.lengthRange?.max ?? base?.lengthRange.max ?? 2400);
  const issues: string[] = [];
  if (!name || name.length > 60) issues.push("内容类型名称必须为 1 到 60 个字符。" );
  if (!semanticDescription && !suitableQuestionDescription && !contentGoal) issues.push("请填写一句话定义、适配问题或内容目标中的至少一项。" );
  if (semanticDescription.length > 500 || suitableQuestionDescription.length > 800) issues.push("类型用途描述过长，请分别控制在 500 和 800 个字符以内。" );
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 300 || max > 10000 || min > max) issues.push("篇幅必须是 300 到 10000 字且最小值不大于最大值。" );
  if (issues.length) throw new ArticleTypeServiceError(422, "ARTICLE_TYPE_VALIDATION_FAILED", "内容类型未通过校验。", issues);

  const normalized = {
    name,
    semanticDescription,
    suitableQuestionDescription,
    unsuitableQuestionDescription: String(input.unsuitableQuestionDescription ?? base?.unsuitableQuestionDescription ?? "").trim(),
    targetAudience: cleanStrings(input.targetAudience ?? base?.targetAudience),
    contentGoal,
    structureModules: cleanStrings(input.structureModules ?? base?.structureModules),
    requiredSections: cleanStrings(input.requiredSections ?? base?.requiredSections),
    cta: String(input.cta ?? base?.cta ?? "").trim(),
    lengthRange: { min, max, unit: "字" as const },
    styleTraits: cleanStrings(input.styleTraits ?? base?.styleTraits),
    caseUsage: String(input.caseUsage ?? base?.caseUsage ?? "").trim(),
    evidencePreferences: cleanStrings(input.evidencePreferences ?? base?.evidencePreferences),
    channelHints: cleanStrings(input.channelHints ?? base?.channelHints),
    exampleQuestions: cleanStrings(input.exampleQuestions ?? base?.exampleQuestions, 20),
    aiSupplementRunId: input.aiSupplementRunId
  };
  const fieldSources = { ...(base?.fieldSources || {}), ...(input.fieldSources || {}) };
  for (const field of Object.keys(normalized).filter((key) => key !== "aiSupplementRunId")) {
    if (!fieldSources[field]) {
      fieldSources[field] = Object.prototype.hasOwnProperty.call(input, field) ? "user_input" : "template_inherited";
    }
  }
  return { ...normalized, fieldSources };
}

function createVersion(input: {
  profileId: string;
  version: number;
  actor: string;
  draft: ReturnType<typeof normalizeDraftInput>;
  now: string;
}): ArticleTypeProfileVersion {
  const partial = {
    profileVersionId: `${input.profileId}-v${input.version}-${randomUUID().slice(0, 8)}`,
    profileId: input.profileId,
    version: input.version,
    ...input.draft,
    status: "draft" as const,
    createdBy: input.actor,
    createdAt: input.now
  };
  const compiled = compilePromptConstraint(partial);
  return { ...partial, promptConstraintSnapshot: compiled.snapshot, promptConstraintSnapshotHash: compiled.hash };
}

function summarizeProfile(state: ArticleTypeState, profile: ArticleTypeProfile): ArticleTypeProfileSummary {
  const currentVersion = state.versions[profile.currentVersionId];
  if (!currentVersion) throw new ArticleTypeServiceError(500, "ARTICLE_TYPE_VERSION_MISSING", `内容类型 ${profile.profileId} 的当前版本不存在。` );
  return { ...profile, currentVersion, activeVersion: profile.activeVersionId ? state.versions[profile.activeVersionId] : undefined };
}

export async function listArticleTypeProfiles(options?: { status?: string; search?: string }) {
  const state = await readArticleTypeState();
  const search = options?.search?.trim().toLocaleLowerCase() || "";
  return Object.values(state.profiles)
    .map((profile) => summarizeProfile(state, profile))
    .filter((profile) => !options?.status || options.status === "all" || profile.status === options.status)
    .filter((profile) => !search || `${profile.currentVersion.name} ${profile.currentVersion.semanticDescription} ${profile.currentVersion.suitableQuestionDescription}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getArticleTypeProfile(profileId: string) {
  const state = await readArticleTypeState();
  const profile = state.profiles[profileId];
  if (!profile) throw new ArticleTypeServiceError(404, "ARTICLE_TYPE_NOT_FOUND", "内容类型不存在。" );
  return summarizeProfile(state, profile);
}

export async function getActiveArticleTypeVersions() {
  const state = await readArticleTypeState();
  return Object.values(state.profiles)
    .filter((profile) => profile.status === "active" && profile.activeVersionId)
    .map((profile) => state.versions[profile.activeVersionId!])
    .filter(Boolean);
}

export async function getArticleTypeVersionsByIds(profileVersionIds: string[]) {
  const state = await readArticleTypeState();
  return profileVersionIds.map((id) => state.versions[id]).filter(Boolean);
}

function idempotentMutation<T>(input: {
  state: ArticleTypeState;
  storageKey: string;
  hash: string;
  mutate: () => T;
}): T {
  const existing = input.state.idempotency[input.storageKey];
  if (existing) {
    if (existing.requestHash !== input.hash) throw new ArticleTypeServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求，请刷新后重试。" );
    return existing.response as T;
  }
  const response = input.mutate();
  input.state.idempotency[input.storageKey] = { requestHash: input.hash, response, createdAt: new Date().toISOString() };
  return response;
}

export async function createArticleTypeProfile(request: ArticleTypeWriteRequest, idempotencyHeader: string | null) {
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  if (request.expectedVersion !== 0) throw new ArticleTypeServiceError(409, "ARTICLE_TYPE_VERSION_CONFLICT", "新建内容类型的 expectedVersion 必须为 0。" );
  const hash = requestHash(request);
  return updateArticleTypeState((state) => idempotentMutation({
    state,
    storageKey: `create:${key}`,
    hash,
    mutate: () => {
      const source = request.copyFromProfileId ? state.profiles[request.copyFromProfileId] : undefined;
      if (request.copyFromProfileId && !source) throw new ArticleTypeServiceError(404, "ARTICLE_TYPE_COPY_SOURCE_NOT_FOUND", "要复制的内容类型不存在。" );
      const base = source ? state.versions[source.activeVersionId || source.currentVersionId] : undefined;
      const draft = normalizeDraftInput(request.input, base);
      const now = new Date().toISOString();
      const profileId = `article-type-${randomUUID()}`;
      const version = createVersion({ profileId, version: 1, actor, draft, now });
      const profile: ArticleTypeProfile = {
        profileId,
        revision: 1,
        origin: source ? "template_copy" : "workspace_custom",
        status: "draft",
        currentVersionId: version.profileVersionId,
        monthlyUsageCount: 0,
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor
      };
      state.profiles[profileId] = profile;
      state.versions[version.profileVersionId] = version;
      state.auditLog.unshift({ auditId: randomUUID(), event: "profile_created", objectId: profileId, actor, auditReason, createdAt: now, summary: { copiedFrom: request.copyFromProfileId } });
      return summarizeProfile(state, profile);
    }
  }));
}

export async function patchArticleTypeProfile(profileId: string, request: ArticleTypePatchRequest, idempotencyHeader: string | null) {
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const hash = requestHash({ profileId, request });
  return updateArticleTypeState((state) => idempotentMutation({
    state,
    storageKey: `patch:${profileId}:${key}`,
    hash,
    mutate: () => {
      const profile = state.profiles[profileId];
      if (!profile) throw new ArticleTypeServiceError(404, "ARTICLE_TYPE_NOT_FOUND", "内容类型不存在。" );
      if (profile.revision !== request.expectedVersion) throw new ArticleTypeServiceError(409, "ARTICLE_TYPE_VERSION_CONFLICT", `内容类型已更新到修订 ${profile.revision}，请刷新后重试。` );
      const now = new Date().toISOString();
      if (request.action === "disable") {
        profile.revision += 1;
        profile.status = "disabled";
        profile.updatedAt = now;
        profile.updatedBy = actor;
        state.auditLog.unshift({ auditId: randomUUID(), event: "profile_disabled", objectId: profileId, actor, auditReason, createdAt: now });
        return summarizeProfile(state, profile);
      }
      const base = state.versions[profile.activeVersionId || profile.currentVersionId];
      const version = createVersion({ profileId, version: Math.max(...Object.values(state.versions).filter((item) => item.profileId === profileId).map((item) => item.version), 0) + 1, actor, draft: normalizeDraftInput(request.input, base), now });
      profile.revision += 1;
      profile.status = profile.activeVersionId ? "active" : "draft";
      profile.currentVersionId = version.profileVersionId;
      profile.updatedAt = now;
      profile.updatedBy = actor;
      state.versions[version.profileVersionId] = version;
      state.auditLog.unshift({ auditId: randomUUID(), event: "profile_version_created", objectId: version.profileVersionId, actor, auditReason, createdAt: now });
      return summarizeProfile(state, profile);
    }
  }));
}

export async function activateArticleTypeProfile(profileId: string, request: ArticleTypeActivateRequest, idempotencyHeader: string | null) {
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const hash = requestHash({ profileId, request });
  return updateArticleTypeState((state) => idempotentMutation({
    state,
    storageKey: `activate:${profileId}:${key}`,
    hash,
    mutate: () => {
      const profile = state.profiles[profileId];
      const version = state.versions[request.profileVersionId];
      if (!profile || !version || version.profileId !== profileId) throw new ArticleTypeServiceError(404, "ARTICLE_TYPE_VERSION_NOT_FOUND", "要发布的内容类型版本不存在。" );
      if (profile.revision !== request.expectedVersion) throw new ArticleTypeServiceError(409, "ARTICLE_TYPE_VERSION_CONFLICT", `内容类型已更新到修订 ${profile.revision}，请刷新后重试。` );
      const now = new Date().toISOString();
      if (profile.activeVersionId && state.versions[profile.activeVersionId]) state.versions[profile.activeVersionId].status = "superseded";
      version.status = "active";
      profile.activeVersionId = version.profileVersionId;
      profile.currentVersionId = version.profileVersionId;
      profile.status = "active";
      profile.revision += 1;
      profile.updatedAt = now;
      profile.updatedBy = actor;
      state.auditLog.unshift({ auditId: randomUUID(), event: "profile_activated", objectId: version.profileVersionId, actor, auditReason, createdAt: now });
      return summarizeProfile(state, profile);
    }
  }));
}

async function findIdempotentResponse<T>(storageKey: string, hash: string): Promise<T | undefined> {
  const state = await readArticleTypeState();
  const existing = state.idempotency[storageKey];
  if (!existing) return undefined;
  if (existing.requestHash !== hash) throw new ArticleTypeServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求，请刷新后重试。" );
  return existing.response as T;
}

export async function supplementArticleTypeProfile(
  profileId: string,
  request: ArticleTypeSupplementRequest,
  idempotencyHeader: string | null,
  provider: ArticleTypeSemanticProvider = createArticleTypeSemanticProvider()
): Promise<ArticleTypeSupplementResult> {
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const hash = requestHash({ profileId, request });
  const storageKey = `supplement:${profileId}:${key}`;
  const replay = await findIdempotentResponse<ArticleTypeSupplementResult>(storageKey, hash);
  if (replay) return replay;
  const state = await readArticleTypeState();
  const profile = state.profiles[profileId];
  const version = state.versions[request.profileVersionId];
  if (!profile || !version || version.profileId !== profileId) throw new ArticleTypeServiceError(404, "ARTICLE_TYPE_VERSION_NOT_FOUND", "内容类型草稿不存在。" );
  if (profile.revision !== request.expectedVersion) throw new ArticleTypeServiceError(409, "ARTICLE_TYPE_VERSION_CONFLICT", "内容类型已更新，请刷新后重试。" );
  const providerResult = await provider.supplementProfile({ profile: version, activeProfiles: await getActiveArticleTypeVersions() });
  const result: ArticleTypeSupplementResult = {
    runId: `supplement-${randomUUID()}`,
    status: providerResult.status,
    provider: providerResult.provider,
    promptVersion: ARTICLE_TYPE_PROMPT_VERSION,
    suggestions: providerResult.data?.suggestions || [],
    overlaps: providerResult.data?.overlaps || [],
    missingInformation: providerResult.data?.missingInformation || [],
    message: providerResult.message
  };
  return updateArticleTypeState((latest) => idempotentMutation({
    state: latest,
    storageKey,
    hash,
    mutate: () => {
      latest.auditLog.unshift({ auditId: randomUUID(), event: "profile_supplemented", objectId: request.profileVersionId, actor, auditReason, createdAt: new Date().toISOString(), summary: { status: result.status, suggestionCount: result.suggestions.length } });
      return result;
    }
  }));
}

export async function supplementArticleTypeDraft(
  request: ArticleTypeWriteRequest,
  idempotencyHeader: string | null,
  provider: ArticleTypeSemanticProvider = createArticleTypeSemanticProvider()
): Promise<ArticleTypeSupplementResult> {
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const draft = normalizeDraftInput(request.input);
  const hash = requestHash({ request: { ...request, input: draft } });
  const storageKey = `supplement-draft:${key}`;
  const replay = await findIdempotentResponse<ArticleTypeSupplementResult>(storageKey, hash);
  if (replay) return replay;
  const providerResult = await provider.supplementProfile({ profile: draft, activeProfiles: await getActiveArticleTypeVersions() });
  const result: ArticleTypeSupplementResult = {
    runId: `supplement-${randomUUID()}`,
    status: providerResult.status,
    provider: providerResult.provider,
    promptVersion: ARTICLE_TYPE_PROMPT_VERSION,
    suggestions: providerResult.data?.suggestions || [],
    overlaps: providerResult.data?.overlaps || [],
    missingInformation: providerResult.data?.missingInformation || [],
    message: providerResult.message
  };
  return updateArticleTypeState((state) => idempotentMutation({
    state,
    storageKey,
    hash,
    mutate: () => {
      state.auditLog.unshift({ auditId: randomUUID(), event: "profile_supplemented", objectId: result.runId, actor, auditReason, createdAt: new Date().toISOString(), summary: { status: result.status, draftOnly: true } });
      return result;
    }
  }));
}

export async function runQuestionTypeMatch(
  month: string,
  request: QuestionTypeMatchRequest,
  idempotencyHeader: string | null,
  provider: ArticleTypeSemanticProvider = createArticleTypeSemanticProvider()
) {
  if (!MONTH_PATTERN.test(month)) throw new ArticleTypeServiceError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM。" );
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const uniqueQuestionIds = Array.from(new Set(request.questionVersionIds || []));
  if (!uniqueQuestionIds.length || uniqueQuestionIds.length > 30) throw new ArticleTypeServiceError(422, "INVALID_MATCH_QUESTIONS", "请选择 1 到 30 个目标问题。" );
  const workbench = readWorkbenchState();
  const questions = uniqueQuestionIds.map((questionVersionId) => {
    const item = workbench.distilledTerms.find((term) => term.id === questionVersionId);
    if (!item) throw new ArticleTypeServiceError(422, "QUESTION_VERSION_NOT_FOUND", `目标问题 ${questionVersionId} 不存在。` );
    return { questionVersionId, question: item.term, productId: item.product };
  });
  const hash = requestHash({ month, request: { ...request, questionVersionIds: uniqueQuestionIds } });
  const storageKey = `match:${month}:${key}`;
  const replay = await findIdempotentResponse<QuestionTypeMatchRun>(storageKey, hash);
  if (replay) return replay;
  const state = await readArticleTypeState();
  const previousRevision = (state.monthRunIds[month] || []).map((id) => state.matchRuns[id]?.revision || 0).reduce((max, value) => Math.max(max, value), 0);
  if (request.expectedVersion !== previousRevision) throw new ArticleTypeServiceError(409, "TYPE_MATCH_VERSION_CONFLICT", `内容类型匹配已更新到修订 ${previousRevision}，请刷新后重试。` );
  const providerResult = await provider.matchQuestions({ questions, activeProfiles: await getActiveArticleTypeVersions() });
  const now = new Date().toISOString();
  const matchRunId = `type-match-${month}-${randomUUID()}`;
  const suggestions: QuestionTypeSuggestion[] = (providerResult.data?.suggestions || []).map((item) => ({
    ...item,
    suggestionId: `type-suggestion-${randomUUID()}`,
    selectionStatus: item.fitLevel === "high" ? "accepted" : "suggested",
    selectionSource: "ai_recommended"
  }));
  const run: QuestionTypeMatchRun = {
    matchRunId,
    month,
    revision: previousRevision + 1,
    status: providerResult.status === "pending_config" ? "pending_config" : providerResult.status === "failed" ? "failed" : "draft",
    questionVersionIds: uniqueQuestionIds,
    provider: providerResult.provider,
    providerModel: providerResult.model,
    promptVersion: ARTICLE_TYPE_PROMPT_VERSION,
    suggestions,
    createdAt: now,
    createdBy: actor,
    auditReason
  };
  return updateArticleTypeState((latest) => idempotentMutation({
    state: latest,
    storageKey,
    hash,
    mutate: () => {
      latest.matchRuns[matchRunId] = run;
      latest.monthRunIds[month] = [matchRunId, ...(latest.monthRunIds[month] || [])].slice(0, 20);
      latest.auditLog.unshift({ auditId: randomUUID(), event: "type_match_run", objectId: matchRunId, actor, auditReason, createdAt: now, summary: { status: run.status, suggestionCount: suggestions.length } });
      return run;
    }
  }));
}

export async function confirmQuestionTypeMatch(month: string, request: QuestionTypeMatchConfirmRequest, idempotencyHeader: string | null) {
  if (!MONTH_PATTERN.test(month)) throw new ArticleTypeServiceError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM。" );
  const actor = requireActor();
  const auditReason = requireAuditReason(request.auditReason);
  const key = requireIdempotencyKey(idempotencyHeader);
  const hash = requestHash({ month, request });
  const questionById = new Map(readWorkbenchState().distilledTerms.map((item) => [item.id, item.term]));
  return updateArticleTypeState((state) => idempotentMutation({
    state,
    storageKey: `confirm-match:${month}:${key}`,
    hash,
    mutate: () => {
      const run = state.matchRuns[request.matchRunId];
      if (!run || run.month !== month) throw new ArticleTypeServiceError(404, "TYPE_MATCH_RUN_NOT_FOUND", "内容类型匹配草稿不存在。" );
      if (run.revision !== request.expectedVersion) throw new ArticleTypeServiceError(409, "TYPE_MATCH_VERSION_CONFLICT", `匹配草稿已更新到修订 ${run.revision}，请刷新后重试。` );
      const versionById = new Map(Object.values(state.versions).map((version) => [version.profileVersionId, version]));
      for (const selection of request.selections || []) {
        if (!run.questionVersionIds.includes(selection.questionVersionId)) throw new ArticleTypeServiceError(422, "TYPE_MATCH_QUESTION_MISMATCH", "确认结果包含不属于本次匹配的问题。" );
        const version = versionById.get(selection.articleTypeProfileVersionId);
        if (!version || version.status !== "active") throw new ArticleTypeServiceError(422, "ARTICLE_TYPE_VERSION_INACTIVE", "只能确认已启用的内容类型版本。" );
        const existing = run.suggestions.find((item) => item.questionVersionId === selection.questionVersionId && item.articleTypeProfileVersionId === selection.articleTypeProfileVersionId);
        if (existing) {
          existing.selectionStatus = selection.selectionStatus;
          existing.selectionSource = selection.selectionStatus === "manual_added" ? "user_selected" : existing.selectionSource;
        } else {
          const question = run.suggestions.find((item) => item.questionVersionId === selection.questionVersionId)?.question
            || questionById.get(selection.questionVersionId)
            || selection.questionVersionId;
          run.suggestions.push({
            suggestionId: `type-suggestion-${randomUUID()}`,
            questionVersionId: selection.questionVersionId,
            question,
            articleTypeProfileVersionId: version.profileVersionId,
            articleTypeName: version.name,
            fitLevel: "possible",
            semanticScore: 0,
            reason: "用户手动加入内容策略。",
            matchedFacets: [],
            missingInformation: [],
            conflictProfileVersionIds: [],
            selectionStatus: "manual_added",
            selectionSource: "user_selected"
          });
        }
      }
      if (!run.suggestions.some((item) => item.selectionStatus === "accepted" || item.selectionStatus === "manual_added")) {
        throw new ArticleTypeServiceError(422, "TYPE_MATCH_SELECTION_REQUIRED", "每次匹配至少确认一个内容类型。" );
      }
      const now = new Date().toISOString();
      run.status = "confirmed";
      run.revision += 1;
      run.confirmedAt = now;
      run.confirmedBy = actor;
      state.auditLog.unshift({ auditId: randomUUID(), event: "type_match_confirmed", objectId: run.matchRunId, actor, auditReason, createdAt: now, summary: { accepted: run.suggestions.filter((item) => item.selectionStatus === "accepted" || item.selectionStatus === "manual_added").length } });
      return run;
    }
  }));
}

export async function getLatestQuestionTypeMatchRun(month: string) {
  const state = await readArticleTypeState();
  const id = state.monthRunIds[month]?.[0];
  return id ? state.matchRuns[id] : undefined;
}

export async function getQuestionTypeMatchRun(matchRunId: string) {
  return (await readArticleTypeState()).matchRuns[matchRunId];
}

export function parseArticleTypeWriteRequest(value: unknown): ArticleTypeWriteRequest {
  if (!isRecord(value) || !isRecord(value.input)) throw new ArticleTypeServiceError(400, "INVALID_REQUEST", "请求必须包含内容类型 input。" );
  return { expectedVersion: Number(value.expectedVersion), auditReason: String(value.auditReason || ""), input: value.input as unknown as ArticleTypeProfileDraftInput, copyFromProfileId: value.copyFromProfileId ? String(value.copyFromProfileId) : undefined };
}

export function parseArticleTypePatchRequest(value: unknown): ArticleTypePatchRequest {
  const parsed = parseArticleTypeWriteRequest(value);
  return { ...parsed, action: isRecord(value) && value.action === "disable" ? "disable" : "new_version" };
}

export function parseArticleTypeActivateRequest(value: unknown): ArticleTypeActivateRequest {
  if (!isRecord(value)) throw new ArticleTypeServiceError(400, "INVALID_REQUEST", "发布请求格式不正确。" );
  return { expectedVersion: Number(value.expectedVersion), profileVersionId: String(value.profileVersionId || ""), auditReason: String(value.auditReason || "") };
}

export function parseArticleTypeSupplementRequest(value: unknown): ArticleTypeSupplementRequest {
  return parseArticleTypeActivateRequest(value);
}

export function parseQuestionTypeMatchRequest(value: unknown): QuestionTypeMatchRequest {
  if (!isRecord(value)) throw new ArticleTypeServiceError(400, "INVALID_REQUEST", "匹配请求格式不正确。" );
  return { expectedVersion: Number(value.expectedVersion), questionVersionIds: cleanStrings(value.questionVersionIds, 30), auditReason: String(value.auditReason || "") };
}

export function parseQuestionTypeMatchConfirmRequest(value: unknown): QuestionTypeMatchConfirmRequest {
  if (!isRecord(value) || !Array.isArray(value.selections)) throw new ArticleTypeServiceError(400, "INVALID_REQUEST", "匹配确认请求格式不正确。" );
  return {
    expectedVersion: Number(value.expectedVersion),
    matchRunId: String(value.matchRunId || ""),
    auditReason: String(value.auditReason || ""),
    selections: value.selections.flatMap((item) => {
      if (!isRecord(item)) return [];
      const selectionStatus = item.selectionStatus === "rejected" || item.selectionStatus === "manual_added" ? item.selectionStatus : "accepted";
      return [{ questionVersionId: String(item.questionVersionId || ""), articleTypeProfileVersionId: String(item.articleTypeProfileVersionId || ""), selectionStatus }];
    })
  };
}
