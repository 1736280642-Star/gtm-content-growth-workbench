import type { RuntimeCapability } from "../runtime-config";
import { getRuntimeConfigStatus } from "../runtime-config";
import type {
  V5ArticleExpressionProfileVersion,
  V5ArticleExpressionProfileView,
  V5ConfigurationStatusItem
} from "./article-expression-contracts";
import {
  appendV5FoundationAudit,
  createV5FoundationId,
  hashV5FoundationPayload,
  mutateV5FoundationState,
  readV5FoundationSnapshot
} from "./foundation-repository";
import {
  assertV5ExpectedVersion,
  assertV5FoundationEnvelope,
  assertV5FoundationText,
  V5FoundationServiceError
} from "./foundation-service";
import type { V5WriteEnvelope } from "./knowledge-governance-service";

const expressionRoles = ["workbench_operator", "developer_admin"] as const;
const mandatoryForbiddenStyles = ["绝对排名", "泛化承诺", "无证据数据"];
const evidencePromisePattern = /合作伙伴|客户案例|成功率|提升\s*\d|降低\s*\d|唯一|第一|保证|承诺/;

function profileViews(): V5ArticleExpressionProfileView[] {
  const state = readV5FoundationSnapshot();
  return state.articleExpressionProfiles.flatMap((profile) => {
    const version = state.articleExpressionProfileVersions.find((item) => item.profileVersionId === profile.currentVersionId);
    return version ? [{ ...profile, currentVersion: version }] : [];
  });
}

function mapConfigurationCapability(capability: RuntimeCapability): V5ConfigurationStatusItem | undefined {
  const models = new Set(["qwen", "deepseek", "doubao", "qwen_embedding", "doubao_embedding"]);
  const publish = new Set(["wechatsync_bridge", "wechat_mp_draft", "csdn_draft", "juejin_draft", "zhihu_draft"]);
  const observation = new Set(["knowledge_url_crawler", "xcrawl_fetch", "knowledge_proxy_fetch"]);
  const category = models.has(capability.key)
    ? "model"
    : publish.has(capability.key) ? "publish_connection" : observation.has(capability.key) ? "observation_connection" : undefined;
  if (!category) return undefined;
  return {
    key: capability.key,
    label: capability.label,
    purpose: capability.purpose,
    category,
    status: capability.status,
    nextAction: capability.status === "ready" ? "可运行配置检查。" : "补充本机配置后重新检查。"
  };
}

export function getV5ConfigurationStatus() {
  const items = getRuntimeConfigStatus().capabilities.flatMap((item) => mapConfigurationCapability(item) || []);
  return { ok: true as const, status: "success" as const, data: { items } };
}

export function listV5ArticleExpressionProfiles() {
  const state = readV5FoundationSnapshot();
  return { ok: true as const, status: "success" as const, data: { profiles: profileViews(), stateVersion: state.version } };
}

export type ProfileVersionInput = Omit<V5ArticleExpressionProfileVersion,
  "profileVersionId" | "profileId" | "versionNumber" | "status" | "evidenceWarning" | "createdAt" | "createdBy"
>;

function validateVersion(input: ProfileVersionInput | undefined): asserts input is ProfileVersionInput {
  if (!input || typeof input !== "object") {
    throw new V5FoundationServiceError("invalid_contract", "缺少表达预设版本。", 400, "补充表达预设后重试。");
  }
  assertV5FoundationText(input.targetAudience, "目标读者", 120);
  assertV5FoundationText(input.cta, "CTA", 160);
  if (typeof input.notes !== "string") {
    throw new V5FoundationServiceError("invalid_contract", "补充说明必须是文本。", 400);
  }
  if (!Array.isArray(input.tones) || !input.tones.every((item) => typeof item === "string")) {
    throw new V5FoundationServiceError("invalid_contract", "语气风格必须是文本列表。", 400);
  }
  if (!Array.isArray(input.requiredTopics) || !input.requiredTopics.every((item) => typeof item === "string")) {
    throw new V5FoundationServiceError("invalid_contract", "必含内容必须是文本列表。", 400);
  }
  if (!Array.isArray(input.forbiddenStyles) || !input.forbiddenStyles.every((item) => typeof item === "string")) {
    throw new V5FoundationServiceError("invalid_contract", "禁用表达必须是文本列表。", 400);
  }
  if (!Array.isArray(input.structureModules) || input.structureModules.length < 2 || input.structureModules.length > 12) {
    throw new V5FoundationServiceError("invalid_contract", "结构模块需要 2-12 个。", 400);
  }
  for (const structureModule of input.structureModules) {
    if (!structureModule || typeof structureModule !== "object" || typeof structureModule.moduleId !== "string" || typeof structureModule.label !== "string"
      || typeof structureModule.guidance !== "string" || typeof structureModule.required !== "boolean") {
      throw new V5FoundationServiceError("invalid_contract", "结构模块字段不完整。", 400, "检查模块名称、写作提示和必填状态后重试。");
    }
    assertV5FoundationText(structureModule.moduleId, "结构模块 ID", 120);
    assertV5FoundationText(structureModule.label, "结构模块名称", 80);
    assertV5FoundationText(structureModule.guidance, "结构模块提示", 300);
  }
  if (!Number.isInteger(input.minLength) || !Number.isInteger(input.maxLength) || input.minLength < 300 || input.maxLength < input.minLength || input.maxLength > 10000) {
    throw new V5FoundationServiceError("invalid_contract", "篇幅范围必须是 300-10000 的有效整数区间。", 400);
  }
}

function buildVersion(input: ProfileVersionInput, profileId: string, versionNumber: number, actorId: string): V5ArticleExpressionProfileVersion {
  validateVersion(input);
  const forbiddenStyles = Array.from(new Set([...mandatoryForbiddenStyles, ...input.forbiddenStyles]));
  return {
    ...input,
    notes: input.notes.slice(0, 200),
    forbiddenStyles,
    profileVersionId: createV5FoundationId("expression-version"),
    profileId,
    versionNumber,
    status: "draft",
    evidenceWarning: evidencePromisePattern.test(input.notes),
    createdAt: new Date().toISOString(),
    createdBy: actorId
  };
}

export function createV5ArticleExpressionProfile(input: V5WriteEnvelope & {
  name: string;
  applicableArticleTypes: string[];
  applicableChannels: string[];
  version: ProfileVersionInput;
}) {
  assertV5FoundationEnvelope(input, [...expressionRoles]);
  assertV5FoundationText(input.name, "预设名称", 80);
  const stored = mutateV5FoundationState({
    operation: "create_article_expression_profile",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ name: input.name, applicableArticleTypes: input.applicableArticleTypes, applicableChannels: input.applicableChannels, version: input.version }),
    mutate(state) {
      assertV5ExpectedVersion(state.version, input.expectedVersion);
      const now = new Date().toISOString();
      const profileId = createV5FoundationId("expression-profile");
      const version = buildVersion(input.version, profileId, 1, input.actor.actorId);
      const profile = {
        profileId,
        name: input.name.trim(),
        applicableArticleTypes: input.applicableArticleTypes,
        applicableChannels: input.applicableChannels,
        currentVersionId: version.profileVersionId,
        defaultProfile: false,
        rowVersion: 1,
        createdAt: now,
        updatedAt: now
      };
      state.articleExpressionProfiles.push(profile);
      state.articleExpressionProfileVersions.push(version);
      appendV5FoundationAudit(state, {
        action: "article_expression_profile_created",
        objectType: "ArticleExpressionProfile",
        objectId: profileId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { profile: { ...profile, currentVersion: version } };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function updateV5ArticleExpressionProfile(input: V5WriteEnvelope & {
  profileId: string;
  name?: string;
  applicableArticleTypes?: string[];
  applicableChannels?: string[];
  version: ProfileVersionInput;
}) {
  assertV5FoundationEnvelope(input, [...expressionRoles]);
  const stored = mutateV5FoundationState({
    operation: "update_article_expression_profile",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ profileId: input.profileId, name: input.name, applicableArticleTypes: input.applicableArticleTypes, applicableChannels: input.applicableChannels, version: input.version }),
    mutate(state) {
      const profile = state.articleExpressionProfiles.find((item) => item.profileId === input.profileId);
      if (!profile) throw new V5FoundationServiceError("not_found", "文章表达预设不存在。", 404);
      assertV5ExpectedVersion(profile.rowVersion, input.expectedVersion);
      const latestNumber = Math.max(...state.articleExpressionProfileVersions.filter((item) => item.profileId === profile.profileId).map((item) => item.versionNumber));
      const version = buildVersion(input.version, profile.profileId, latestNumber + 1, input.actor.actorId);
      state.articleExpressionProfileVersions.push(version);
      profile.currentVersionId = version.profileVersionId;
      profile.name = input.name?.trim() || profile.name;
      profile.applicableArticleTypes = input.applicableArticleTypes || profile.applicableArticleTypes;
      profile.applicableChannels = input.applicableChannels || profile.applicableChannels;
      profile.rowVersion += 1;
      profile.updatedAt = new Date().toISOString();
      appendV5FoundationAudit(state, {
        action: "article_expression_profile_version_created",
        objectType: "ArticleExpressionProfile",
        objectId: profile.profileId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { profile: { ...profile, currentVersion: version } };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "draft_saved", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function publishV5ArticleExpressionProfile(input: V5WriteEnvelope & { profileId: string; profileVersionId: string }) {
  assertV5FoundationEnvelope(input, [...expressionRoles]);
  if (input.actor.actorType !== "human") {
    throw new V5FoundationServiceError("permission_denied", "文章表达预设只能由人工发布。", 403);
  }
  const stored = mutateV5FoundationState({
    operation: "publish_article_expression_profile",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ profileId: input.profileId, profileVersionId: input.profileVersionId }),
    mutate(state) {
      const profile = state.articleExpressionProfiles.find((item) => item.profileId === input.profileId);
      const version = state.articleExpressionProfileVersions.find((item) => item.profileVersionId === input.profileVersionId && item.profileId === input.profileId);
      if (!profile || !version) throw new V5FoundationServiceError("not_found", "预设或版本不存在。", 404);
      assertV5ExpectedVersion(profile.rowVersion, input.expectedVersion);
      if (version.evidenceWarning) {
        throw new V5FoundationServiceError("evidence_required", "补充说明包含需要证据支持的承诺，不能直接发布。", 409, "删除无证据承诺，或先补充可追溯资料。 ");
      }
      for (const item of state.articleExpressionProfileVersions.filter((item) => item.profileId === profile.profileId && item.status === "active")) {
        item.status = "archived";
      }
      version.status = "active";
      profile.currentVersionId = version.profileVersionId;
      profile.rowVersion += 1;
      profile.updatedAt = new Date().toISOString();
      appendV5FoundationAudit(state, {
        action: "article_expression_profile_published",
        objectType: "ArticleExpressionProfileVersion",
        objectId: version.profileVersionId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { profile: { ...profile, currentVersion: version } };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "published", data: { ...stored.data, stateVersion: stored.stateVersion } };
}
