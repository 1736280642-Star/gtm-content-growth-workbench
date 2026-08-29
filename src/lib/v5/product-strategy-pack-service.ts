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

function cleanStrategyStrings(values: string[], field: string, maxItems: number, maxLength: number, required = true) {
  const cleaned = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  if ((required && !cleaned.length) || cleaned.length > maxItems || cleaned.some((item) => item.length > maxLength)) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 必须包含 ${required ? `1-${maxItems}` : `0-${maxItems}`} 项，每项不超过 ${maxLength} 个字符。`,
      400
    );
  }
  return cleaned;
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
  assertText(input.edit.promotionPurpose, "promotionPurpose", 1000);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  if (input.edit.articleDirections.length < 2 || input.edit.articleDirections.length > 6) {
    throw new V5GovernanceServiceError("invalid_contract", "内容方向必须保留 2-6 项。", 400);
  }
  const portfolioItemIds = new Set<string>();
  const articleDirections = input.edit.articleDirections.map((item) => {
    assertText(item.portfolioItemId, "articleDirection.portfolioItemId", 64);
    assertText(item.name, "articleDirection.name", 120);
    assertText(item.direction, "articleDirection.direction", 1200);
    if (portfolioItemIds.has(item.portfolioItemId)) {
      throw new V5GovernanceServiceError("invalid_contract", "内容方向存在重复项。", 400);
    }
    portfolioItemIds.add(item.portfolioItemId);
    return { portfolioItemId: item.portfolioItemId.trim(), name: item.name.trim(), direction: item.direction.trim() };
  });
  const edit = {
    promotionPurpose: input.edit.promotionPurpose.trim(),
    targetAudience: cleanStrategyStrings(input.edit.targetAudience, "targetAudience", 20, 100),
    keyMessages: cleanStrategyStrings(input.edit.keyMessages, "keyMessages", 12, 500),
    articleDirections,
    prohibitedClaims: cleanStrategyStrings(input.edit.prohibitedClaims, "prohibitedClaims", 20, 500, false)
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
