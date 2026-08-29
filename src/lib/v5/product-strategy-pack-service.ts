import { V5GovernanceServiceError } from "./knowledge-governance-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import {
  applyProductStrategyPack,
  updatePendingProductStrategyContent,
  updateApprovedProductStrategyFixedExpression,
  readCurrentProductStrategyPack,
  readLatestProductStrategyPack,
  readProductStrategyArticleTypeVersions
} from "./product-strategy-pack-repository";
import {
  assertHumanProductStrategyDecision,
  type ProductFixedExpressionRule,
  type ProductGeoStrategyDecision,
  type ProductStrategyHumanEditInput
} from "./product-strategy-pack-contracts";

function assertText(value: string | undefined, field: string, maxLength: number) {
  if (!value?.trim() || value.trim().length > maxLength) {
    throw new V5GovernanceServiceError("invalid_contract", `${field} 必须是 1-${maxLength} 个字符。`, 400);
  }
}

function assertFixedExpression(input: ProductFixedExpressionRule) {
  assertText(input.text, "fixedExpression.text", 500);
  const allowedPositions = new Set(["opening", "body", "ending"]);
  if (!input.positions.length || input.positions.some((item) => !allowedPositions.has(item))) {
    throw new V5GovernanceServiceError("invalid_contract", "固定文案至少选择一个有效出现位置。", 400);
  }
  if (!input.channels.length || input.channels.some((item) => typeof item !== "string" || !item.trim())) {
    throw new V5GovernanceServiceError("invalid_contract", "固定文案至少选择一个适用渠道。", 400);
  }
}

function assertHumanStrategyActor(actor: V5GovernanceActor) {
  try {
    assertHumanProductStrategyDecision(actor);
  } catch (error) {
    const code = error instanceof Error ? error.message : "human_strategy_approval_required";
    if (code === "product_strategy_role_forbidden") {
      throw new V5GovernanceServiceError("forbidden", "当前角色无权确认产品 GEO 策略。", 403);
    }
    throw new V5GovernanceServiceError(
      "human_strategy_approval_required",
      "产品 GEO 策略必须由真实用户确认，Agent、调度器和系统不能代替批准。",
      403
    );
  }
}

export async function getProductGeoStrategyPackView(productId: string) {
  assertText(productId, "productId", 64);
  const [latestStrategyPack, currentStrategyPack] = await Promise.all([
    readLatestProductStrategyPack(productId),
    readCurrentProductStrategyPack(productId)
  ]);
  const [latestArticleTypeVersions, currentArticleTypeVersions] = await Promise.all([
    latestStrategyPack ? readProductStrategyArticleTypeVersions(latestStrategyPack.id) : [],
    currentStrategyPack ? readProductStrategyArticleTypeVersions(currentStrategyPack.id) : []
  ]);
  return { productId, latestStrategyPack, currentStrategyPack, latestArticleTypeVersions, currentArticleTypeVersions };
}

export async function decideProductGeoStrategyPack(input: {
  productId: string;
  strategyPackId: string;
  decision: ProductGeoStrategyDecision;
  expectedVersion: number;
  idempotencyKey: string;
  selectedPortfolioItemIds?: string[];
  fixedExpression?: ProductFixedExpressionRule;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.strategyPackId, "strategyPackId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertText(input.actor.actorId, "actorId", 128);
  assertText(input.actor.actorRole, "actorRole", 128);
  assertText(input.actor.auditReason, "auditReason", 500);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  if (input.selectedPortfolioItemIds && (input.selectedPortfolioItemIds.length > 6
    || input.selectedPortfolioItemIds.some((item) => typeof item !== "string" || !item.trim()))) {
    throw new V5GovernanceServiceError("invalid_contract", "selectedPortfolioItemIds 必须是至多 6 项的非空字符串数组。", 400);
  }
  if (input.fixedExpression) {
    assertFixedExpression(input.fixedExpression);
  }
  assertHumanStrategyActor(input.actor);
  return applyProductStrategyPack(input);
}

export async function editPendingProductGeoStrategyPack(input: {
  productId: string;
  strategyPackId: string;
  expectedVersion: number;
  idempotencyKey: string;
  edit: ProductStrategyHumanEditInput;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.strategyPackId, "strategyPackId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertText(input.actor.auditReason, "auditReason", 500);
  assertText(input.edit.productIdentity, "productIdentity", 500);
  assertText(input.edit.entityRelationship, "entityRelationship", 800);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const fixedExpression = input.edit.fixedExpression.trim();
  const ctaLabel = input.edit.ctaLabel.trim();
  const ctaUrl = input.edit.ctaUrl.trim();
  if (fixedExpression.length > 500 || ctaLabel.length > 160 || ctaUrl.length > 500) {
    throw new V5GovernanceServiceError("invalid_contract", "固定表达或 CTA 内容过长。", 400);
  }
  if (ctaUrl && !/^https?:\/\/[^\s]+$/i.test(ctaUrl)) {
    throw new V5GovernanceServiceError("invalid_contract", "CTA 链接必须是完整的 http(s) 地址。", 400);
  }
  if (ctaUrl && !ctaLabel) {
    throw new V5GovernanceServiceError("invalid_contract", "填写 CTA 链接时必须同时填写 CTA 文字。", 400);
  }
  const edit = {
    productIdentity: input.edit.productIdentity.trim(),
    entityRelationship: input.edit.entityRelationship.trim(),
    fixedExpression,
    ctaLabel,
    ctaUrl
  };
  assertHumanStrategyActor(input.actor);
  return updatePendingProductStrategyContent({ ...input, edit });
}

export async function amendApprovedProductStrategyFixedExpression(input: {
  productId: string;
  strategyPackId: string;
  expectedVersion: number;
  idempotencyKey: string;
  fixedExpression: ProductFixedExpressionRule;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.strategyPackId, "strategyPackId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertText(input.actor.auditReason, "auditReason", 500);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  assertFixedExpression(input.fixedExpression);
  assertHumanStrategyActor(input.actor);
  return updateApprovedProductStrategyFixedExpression(input);
}
