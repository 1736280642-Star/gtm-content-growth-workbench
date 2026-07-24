import {
  hashProductionValue,
  ProductionDomainError,
  type CTAPlan,
  type ChannelRuleSnapshot,
  type ContentTaskSnapshot,
  type PromotionCtaVariant,
  type PromotionProfileVersion,
  type ResolvedCtaVariant,
  uniqueSorted
} from "./content-production-contracts";

interface PromotionCandidate {
  profile: PromotionProfileVersion;
  variant: PromotionCtaVariant;
  targetEntityId: string;
  rank: readonly number[];
}

export interface ResolvePromotionInput {
  task: ContentTaskSnapshot;
  channelRule: ChannelRuleSnapshot;
  profiles: PromotionProfileVersion[];
  approvedClaimIds: string[];
  now?: string;
}

function isActiveAt(profile: PromotionProfileVersion, now: Date) {
  if (profile.status !== "active" || !profile.approvedAt || !profile.approvedBy) return false;
  if (profile.validFrom && new Date(profile.validFrom).getTime() > now.getTime()) return false;
  if (profile.validUntil && new Date(profile.validUntil).getTime() < now.getTime()) return false;
  return true;
}

function articleScope(task: ContentTaskSnapshot) {
  if (task.targetEntityIds.length > 1) return "multi_product" as const;
  return "single_product" as const;
}

function assertPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProductionDomainError("promotion_url_invalid", "推广配置包含无效 URL。", [value]);
  }
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol !== "https:" || url.username || url.password || privateHost) {
    throw new ProductionDomainError("promotion_url_invalid", "CTA 只能使用不含凭证的公开 HTTPS URL。", [value]);
  }
}

function compareRank(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function sameRank(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchTargetEntity(task: ContentTaskSnapshot, profile: PromotionProfileVersion) {
  const exact = task.targetEntityIds.filter((entityId) => profile.targetEntityIds.includes(entityId));
  if (exact.length) {
    return task.primaryEntityId && exact.includes(task.primaryEntityId) ? task.primaryEntityId : exact[0];
  }
  const groupMatch = (task.productGroupIds || []).some((groupId) => profile.applicableProductGroups.includes(groupId));
  if (!groupMatch) return;
  return task.primaryEntityId || task.targetEntityIds[0];
}

function buildCandidate(
  task: ContentTaskSnapshot,
  profile: PromotionProfileVersion,
  variant: PromotionCtaVariant
): PromotionCandidate | undefined {
  const targetEntityId = matchTargetEntity(task, profile);
  if (!targetEntityId) return;
  const exactEntity = profile.targetEntityIds.includes(targetEntityId) ? 1 : 0;
  const exactChannel = variant.channel === task.channel ? 1 : 0;
  const exactIntent = profile.ctaIntent === task.ctaIntent ? 1 : 0;
  const exactContentType = profile.applicableContentTypes.includes(task.contentType) ? 1 : 0;
  const primaryEntity = task.primaryEntityId === targetEntityId ? 1 : 0;
  return {
    profile,
    variant,
    targetEntityId,
    rank: [exactEntity, exactChannel, exactIntent, exactContentType, primaryEntity, profile.priority]
  };
}

function emptyPlan(task: ContentTaskSnapshot, channelRule: ChannelRuleSnapshot, reasons: string[]): CTAPlan {
  const plan = {
    promotionProfileVersionIds: [],
    targetEntityIds: [...task.targetEntityIds],
    selectedVariants: [],
    renderMode: channelRule.ctaRenderMode,
    maxCtaCount: channelRule.maxCtaCount,
    selectionReasons: reasons
  };
  return { ...plan, planHash: hashProductionValue(plan) };
}

export function resolvePromotionPlan(input: ResolvePromotionInput): CTAPlan {
  const { task, channelRule } = input;
  if (task.ctaIntent === "none") {
    if (task.promotionRequired) {
      throw new ProductionDomainError("rule_conflict", "任务要求推广，但内容类型 CTA 意图为 none。", [task.taskId]);
    }
    return emptyPlan(task, channelRule, ["cta_intent_none"]);
  }
  if (channelRule.maxCtaCount === 0) {
    if (task.promotionRequired) {
      throw new ProductionDomainError("rule_conflict", "任务要求推广，但渠道规则不允许 CTA。", [channelRule.channelRuleVersionId]);
    }
    return emptyPlan(task, channelRule, ["channel_disallows_cta"]);
  }

  const now = new Date(input.now || new Date().toISOString());
  const scope = articleScope(task);
  const approvedClaims = new Set(input.approvedClaimIds);
  const candidates: PromotionCandidate[] = [];

  for (const profile of input.profiles) {
    if (!isActiveAt(profile, now)) continue;
    if (profile.excludedEntityIds.some((entityId) => task.targetEntityIds.includes(entityId))) continue;
    if (profile.articleScope !== scope && profile.articleScope !== "brand" && !(profile.articleScope === "comparison" && task.targetEntityIds.length > 1)) continue;
    if (task.targetEntityIds.length > 1 && !profile.allowMultiProduct) continue;
    if (profile.requiresPrimaryEntity && (!task.primaryEntityId || !profile.targetEntityIds.includes(task.primaryEntityId))) continue;
    if (profile.promotionGoal && profile.promotionGoal !== task.promotionGoal) continue;
    if (profile.ctaIntent !== "any" && profile.ctaIntent !== task.ctaIntent) continue;
    if (profile.applicableContentTypes.length && !profile.applicableContentTypes.includes(task.contentType)) continue;
    if (profile.applicableTitleCategories.length && (!task.titleCategory || !profile.applicableTitleCategories.includes(task.titleCategory))) continue;

    for (const variant of profile.variants) {
      if (variant.status !== "active" || (variant.channel !== "*" && variant.channel !== task.channel)) continue;
      const allowedModes = variant.allowedRenderModes.filter((mode) => channelRule.allowedCtaRenderModes.includes(mode));
      if (!allowedModes.includes(channelRule.ctaRenderMode)) continue;
      const candidate = buildCandidate(task, profile, variant);
      if (!candidate) continue;
      assertPublicHttpsUrl(variant.publicUrl);
      const requiredClaims = uniqueSorted([...variant.identityClaimIds, ...variant.serviceClaimIds]);
      const missingClaims = requiredClaims.filter((claimId) => !approvedClaims.has(claimId));
      if (missingClaims.length) {
        throw new ProductionDomainError("promotion_claim_missing", "CTA 身份或服务主张缺少已批准证据。", missingClaims);
      }
      candidates.push(candidate);
    }
  }

  if (!candidates.length) {
    if (task.promotionRequired) {
      throw new ProductionDomainError("promotion_required_missing", "推广任务没有匹配的 active CTA 配置。", [task.taskId, task.channel, task.ctaIntent]);
    }
    return emptyPlan(task, channelRule, ["no_applicable_active_promotion"]);
  }

  const entityOrder = [task.primaryEntityId, ...task.targetEntityIds].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  const winners: PromotionCandidate[] = [];
  for (const entityId of entityOrder) {
    const entityCandidates = candidates.filter((candidate) => candidate.targetEntityId === entityId).sort((left, right) => {
      return compareRank(left.rank, right.rank)
        || left.profile.promotionProfileVersionId.localeCompare(right.profile.promotionProfileVersionId)
        || left.variant.ctaVariantId.localeCompare(right.variant.ctaVariantId);
    });
    if (!entityCandidates.length) continue;
    if (entityCandidates[1] && sameRank(entityCandidates[0].rank, entityCandidates[1].rank)) {
      throw new ProductionDomainError("promotion_conflict", "同一产品存在无法确定性裁决的同优先级 CTA。", [
        entityCandidates[0].variant.ctaVariantId,
        entityCandidates[1].variant.ctaVariantId
      ]);
    }
    winners.push(entityCandidates[0]);
  }

  const selected = winners.slice(0, channelRule.maxCtaCount);
  if (!selected.length && task.promotionRequired) {
    throw new ProductionDomainError("promotion_required_missing", "推广任务没有可用 CTA。", [task.taskId]);
  }
  const selectedVariants: ResolvedCtaVariant[] = selected.map((candidate) => ({
    promotionProfileVersionId: candidate.profile.promotionProfileVersionId,
    ctaVariantId: candidate.variant.ctaVariantId,
    targetEntityId: candidate.targetEntityId,
    label: candidate.variant.label,
    publicUrl: candidate.variant.publicUrl,
    identityClaimIds: uniqueSorted(candidate.variant.identityClaimIds),
    serviceClaimIds: uniqueSorted(candidate.variant.serviceClaimIds),
    renderMode: channelRule.ctaRenderMode
  }));
  const plan = {
    promotionProfileVersionIds: uniqueSorted(selected.map((candidate) => candidate.profile.promotionProfileVersionId)),
    targetEntityIds: [...task.targetEntityIds],
    selectedVariants,
    renderMode: channelRule.ctaRenderMode,
    maxCtaCount: channelRule.maxCtaCount,
    selectionReasons: selected.map((candidate) => `entity=${candidate.targetEntityId};profile=${candidate.profile.promotionProfileVersionId};variant=${candidate.variant.ctaVariantId}`)
  };
  return { ...plan, planHash: hashProductionValue(plan) };
}
