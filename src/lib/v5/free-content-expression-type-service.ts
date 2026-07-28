import { createHash, randomUUID } from "node:crypto";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type {
  AudienceLensKey,
  CreateFreeExpressionInput,
  FreeContentExpressionTypeDraftInput,
  FreeContentExpressionTypeSummary,
  FreeContentExpressionTypeVersion,
  TitleStrategyKey
} from "./free-production-contracts";
import { FREE_PRODUCTION_CHANNELS } from "./free-production-contracts";
import { readFreeContentExpressionTypeState, updateFreeContentExpressionTypeState, type FreeContentExpressionTypeState } from "./free-content-expression-type-repository";

export class FreeContentExpressionTypeServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: string[]) {
    super(message);
    this.name = "FreeContentExpressionTypeServiceError";
  }
}

function currentActor() {
  return WORKSPACE_ACTOR.actorId;
}

function requireKey(value: string | null) {
  const key = value?.trim() || "";
  if (key.length < 8 || key.length > 200) throw new FreeContentExpressionTypeServiceError(400, "INVALID_IDEMPOTENCY_KEY", "写请求必须携带 8 到 200 字符的 x-idempotency-key。");
  return key;
}

function reason(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 200) throw new FreeContentExpressionTypeServiceError(422, "INVALID_AUDIT_REASON", "请填写 200 个字符以内的操作原因。");
  return result;
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function summarize(state: FreeContentExpressionTypeState, typeId: string): FreeContentExpressionTypeSummary {
  const profile = state.types[typeId];
  if (!profile) throw new FreeContentExpressionTypeServiceError(404, "FREE_CONTENT_TYPE_NOT_FOUND", "自由内容表达不存在。");
  const currentVersion = state.versions[profile.currentVersionId];
  if (!currentVersion) throw new FreeContentExpressionTypeServiceError(500, "FREE_CONTENT_TYPE_VERSION_MISSING", "自由内容表达的当前版本不存在。");
  return { ...profile, currentVersion, activeVersion: profile.activeVersionId ? state.versions[profile.activeVersionId] : undefined };
}

function idempotent<T>(state: FreeContentExpressionTypeState, key: string, payload: unknown, mutation: () => T): T {
  const requestHash = hash(payload);
  const existing = state.idempotency[key];
  if (existing) {
    if (existing.requestHash !== requestHash) throw new FreeContentExpressionTypeServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同请求，请刷新后重试。");
    return existing.response as T;
  }
  const response = mutation();
  state.idempotency[key] = { requestHash, response, createdAt: new Date().toISOString() };
  return response;
}

function inferAudience(description: string, fallback: AudienceLensKey): AudienceLensKey {
  if (/安全|合规|审计|隐私/.test(description)) return "security_compliance";
  if (/采购|决策|选型/.test(description)) return "procurement";
  if (/一线|操作|使用者/.test(description)) return "frontline_user";
  if (/IT|数字化|集成|部署|权限/i.test(description)) return "it_digital";
  if (/管理者|高管|组织/.test(description)) return "executive";
  return fallback;
}

function inferTitleStrategy(description: string, base: FreeContentExpressionTypeVersion): TitleStrategyKey {
  const preferred: TitleStrategyKey = /发布|合作|上线|活动/.test(description) ? "value_release" : /角色|一线|负责人/.test(description) ? "role_resonance" : /趋势|行业|判断/.test(description) ? "industry_question" : "pain_suspense";
  return base.allowedTitleStrategyKeys.includes(preferred) ? preferred : base.defaultTitleStrategyKey;
}

export async function listFreeContentExpressionTypes() {
  const state = await readFreeContentExpressionTypeState();
  return Object.keys(state.types).map((id) => summarize(state, id)).sort((a, b) => Number(b.currentVersion.systemManaged) - Number(a.currentVersion.systemManaged) || b.usageCount - a.usageCount || b.updatedAt.localeCompare(a.updatedAt));
}

export async function getFreeContentExpressionType(typeId: string) { return summarize(await readFreeContentExpressionTypeState(), typeId); }

export async function getActiveFreeContentExpressionTypeVersion(versionId: string) {
  const state = await readFreeContentExpressionTypeState();
  const version = state.versions[versionId];
  if (!version || version.status !== "active") throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_NOT_ACTIVE", "所选自由内容表达版本未启用。", ["选择已启用表达或新建表达后重试。"]);
  return version;
}

export async function markFreeExpressionUsed(typeId: string) {
  return updateFreeContentExpressionTypeState((state) => { if (state.types[typeId]) state.types[typeId].usageCount += 1; });
}

export async function createFreeContentExpressionType(input: { expectedVersion: number; auditReason: string; input: CreateFreeExpressionInput }, header: string | null) {
  const actor = currentActor();
  const auditReason = reason(input.auditReason);
  const key = requireKey(header);
  if (input.expectedVersion !== 0) throw new FreeContentExpressionTypeServiceError(409, "FREE_CONTENT_TYPE_VERSION_CONFLICT", "新建表达的 expectedVersion 必须为 0。");
  const name = String(input.input?.name || "").trim();
  const description = String(input.input?.description || "").trim();
  if (name.length < 2 || name.length > 30) throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_VALIDATION_FAILED", "表达名称必须为 2 到 30 个字符。");
  if (!description || description.length > 1000) throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_VALIDATION_FAILED", "表达说明必须为 1 到 1000 个字符。");
  if (!input.input.productId || !input.input.knowledgeSnapshotIds?.length) throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_VALIDATION_FAILED", "请选择生产池产品和至少一个可用知识范围。");
  if (!FREE_PRODUCTION_CHANNELS.includes(input.input.channel)) throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_CHANNEL_INVALID", "目标渠道只允许官网、知乎和公众号。");
  return updateFreeContentExpressionTypeState((state) => idempotent(state, key, input, () => {
    const baseProfile = state.types[input.input.baseTypeId];
    const base = baseProfile?.activeVersionId ? state.versions[baseProfile.activeVersionId] : undefined;
    if (!base || !base.systemManaged) throw new FreeContentExpressionTypeServiceError(422, "FREE_CONTENT_TYPE_BASE_INVALID", "新表达必须继承五类系统基础表达之一。");
    const now = new Date().toISOString();
    const typeId = `free-type-${randomUUID()}`;
    const versionId = `${typeId}-v1`;
    const partial = {
      ...base,
      freeContentExpressionTypeVersionId: versionId,
      typeId,
      version: 1,
      name,
      description,
      productId: input.input.productId,
      knowledgeSelectionPolicy: "selected_product_snapshots" as const,
      knowledgeSnapshotIds: Array.from(new Set(input.input.knowledgeSnapshotIds)),
      applicableChannels: [input.input.channel],
      channelBinding: { ...base.channelBinding, channel: input.input.channel, publishingConnectionId: input.input.publishingConnectionId },
      visualSuggestionMode: input.input.visualSuggestionMode,
      audienceLensPolicy: inferAudience(description, base.audienceLensPolicy),
      defaultTitleStrategyKey: inferTitleStrategy(description, base),
      systemManaged: false,
      sourceRuleDocumentId: `${base.sourceRuleDocumentId}:workspace-expression`,
      sourceRuleVersion: `${base.sourceRuleVersion}.custom.1`,
      status: "active" as const,
      createdBy: actor,
      createdAt: now,
      activatedAt: now
    };
    const version = { ...partial, snapshotHash: hash(partial) } satisfies FreeContentExpressionTypeVersion;
    state.versions[versionId] = version;
    state.types[typeId] = { typeId, presetKey: base.presetKey, status: "active", currentVersionId: versionId, activeVersionId: versionId, version: 1, usageCount: 0, createdBy: actor, createdAt: now, updatedBy: actor, updatedAt: now };
    state.audits.push({ auditId: randomUUID(), action: "free_content_expression_created", objectId: typeId, actor, auditReason, createdAt: now, summary: { baseTypeId: base.typeId, presetKey: base.presetKey, channel: input.input.channel } });
    return summarize(state, typeId);
  }));
}

export async function createFreeContentExpressionTypeVersion(typeId: string, input: { expectedVersion: number; auditReason: string; input: FreeContentExpressionTypeDraftInput }, header: string | null) {
  const actor = currentActor();
  const auditReason = reason(input.auditReason);
  const key = requireKey(header);
  return updateFreeContentExpressionTypeState((state) => idempotent(state, key, { typeId, ...input }, () => {
    const profile = state.types[typeId];
    if (!profile) throw new FreeContentExpressionTypeServiceError(404, "FREE_CONTENT_TYPE_NOT_FOUND", "自由内容表达不存在。");
    if (profile.version !== input.expectedVersion) throw new FreeContentExpressionTypeServiceError(409, "FREE_CONTENT_TYPE_VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试。");
    const current = state.versions[profile.currentVersionId];
    if (current.systemManaged) throw new FreeContentExpressionTypeServiceError(422, "SYSTEM_EXPRESSION_IMMUTABLE", "系统表达不能原地修改。", ["请基于该系统表达新建工作区表达。"]);
    const now = new Date().toISOString();
    const versionNumber = current.version + 1;
    const versionId = `${typeId}-v${versionNumber}-${randomUUID().slice(0, 8)}`;
    const partial = { ...current, name: String(input.input.name || current.name).trim(), description: String(input.input.description || current.description).trim(), visualSuggestionMode: input.input.visualSuggestionMode || current.visualSuggestionMode, freeContentExpressionTypeVersionId: versionId, version: versionNumber, status: "draft" as const, createdBy: actor, createdAt: now, activatedAt: undefined };
    state.versions[versionId] = { ...partial, snapshotHash: hash(partial) };
    profile.currentVersionId = versionId;
    profile.status = "draft";
    profile.version += 1;
    profile.updatedAt = now;
    profile.updatedBy = actor;
    state.audits.push({ auditId: randomUUID(), action: "free_content_expression_version_created", objectId: typeId, actor, auditReason, createdAt: now });
    return summarize(state, typeId);
  }));
}

export async function activateFreeContentExpressionType(typeId: string, input: { expectedVersion: number; auditReason: string }, header: string | null) {
  const actor = currentActor(); const auditReason = reason(input.auditReason); const key = requireKey(header);
  return updateFreeContentExpressionTypeState((state) => idempotent(state, key, { typeId, ...input }, () => {
    const profile = state.types[typeId]; if (!profile) throw new FreeContentExpressionTypeServiceError(404, "FREE_CONTENT_TYPE_NOT_FOUND", "自由内容表达不存在。");
    if (profile.version !== input.expectedVersion) throw new FreeContentExpressionTypeServiceError(409, "FREE_CONTENT_TYPE_VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试。");
    const now = new Date().toISOString(); if (profile.activeVersionId && profile.activeVersionId !== profile.currentVersionId) state.versions[profile.activeVersionId].status = "archived";
    state.versions[profile.currentVersionId].status = "active"; state.versions[profile.currentVersionId].activatedAt = now; profile.activeVersionId = profile.currentVersionId; profile.status = "active"; profile.version += 1; profile.updatedAt = now; profile.updatedBy = actor;
    state.audits.push({ auditId: randomUUID(), action: "free_content_expression_activated", objectId: typeId, actor, auditReason, createdAt: now }); return summarize(state, typeId);
  }));
}

export async function archiveFreeContentExpressionType(typeId: string, input: { expectedVersion: number; auditReason: string }, header: string | null) {
  const actor = currentActor(); const auditReason = reason(input.auditReason); const key = requireKey(header);
  return updateFreeContentExpressionTypeState((state) => idempotent(state, key, { typeId, ...input }, () => {
    const profile = state.types[typeId]; if (!profile) throw new FreeContentExpressionTypeServiceError(404, "FREE_CONTENT_TYPE_NOT_FOUND", "自由内容表达不存在。");
    if (profile.version !== input.expectedVersion) throw new FreeContentExpressionTypeServiceError(409, "FREE_CONTENT_TYPE_VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试。");
    if (state.versions[profile.currentVersionId].systemManaged) throw new FreeContentExpressionTypeServiceError(422, "SYSTEM_EXPRESSION_IMMUTABLE", "系统表达不能停用。");
    const now = new Date().toISOString(); profile.status = "archived"; profile.version += 1; profile.updatedAt = now; profile.updatedBy = actor; state.audits.push({ auditId: randomUUID(), action: "free_content_expression_archived", objectId: typeId, actor, auditReason, createdAt: now }); return summarize(state, typeId);
  }));
}
