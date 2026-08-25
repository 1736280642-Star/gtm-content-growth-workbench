import { isDemoMode } from "../demo/config";
import { demoProducts } from "../demo/fixtures/research";
import type { CreateGeoResearchProjectInput } from "./geo-research-contracts";
import {
  createGeoResearchProjectRecord,
  readGeoResearchWorkspace,
  readLatestGeoSourceSnapshot
} from "./geo-research-repository";
import { getGeoResearchProviderReadiness } from "./geo-research-provider";
import type { ProductGeoOverview } from "./geo-research-contracts";
import type { CreateProductRegistryInput, UpdateProductRegistryInput } from "./product-registry-contracts";
import {
  assertActiveProductRegistryRecord,
  createProductRegistryRecord,
  deleteProductKnowledgeBaseRecord,
  listProductRegistryRecords,
  readProductRegistryRecord,
  updateProductRegistryRecord,
  updateProductPromotionRecord
} from "./product-registry-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { readLatestProductStrategyPack } from "./product-strategy-pack-repository";
import { readProductKnowledgeProfile } from "./product-knowledge-profile";
import { compileProductWorkflowSummary } from "./product-workflow-summary";
import { getRagInfrastructureStatus } from "./rag/infrastructure";
import { HttpRagOpenSearchAdapter } from "./rag/opensearch-adapter";

function assertText(value: string | undefined, field: string, maxLength = 255) {
  if (!value?.trim()) {
    throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
  }
  if (value.trim().length > maxLength) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 不能超过 ${maxLength} 个字符。`,
      400,
      `精简 ${field} 后重试。`
    );
  }
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId", 128);
  assertText(actor.actorRole, "actorRole", 128);
  assertText(actor.actorType, "actorType", 32);
  assertText(actor.auditReason, "auditReason", 500);
}

function assertStringList(values: string[] | undefined, field: string, maxItems = 50) {
  if (!values) return;
  if (!Array.isArray(values) || values.length > maxItems || values.some((item) => typeof item !== "string" || !item.trim())) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 必须是至多 ${maxItems} 项的非空字符串数组。`,
      400
    );
  }
}

function assertProductInput(product: CreateProductRegistryInput) {
  assertText(product.canonicalName, "canonicalName");
  if (product.displayName !== undefined) assertText(product.displayName, "displayName");
  if (product.brandName !== undefined) assertText(product.brandName, "brandName");
  if (product.officialEntity !== undefined) assertText(product.officialEntity, "officialEntity");
  if (product.productCategory !== undefined) assertText(product.productCategory, "productCategory", 128);
  if (product.entityRelationship !== undefined) assertText(product.entityRelationship, "entityRelationship", 2000);
  assertStringList(product.aliases, "aliases");
  if (product.officialUrl) {
    let parsed: URL;
    try {
      parsed = new URL(product.officialUrl);
    } catch {
      throw new V5GovernanceServiceError("invalid_contract", "officialUrl 不是有效网址。", 400);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new V5GovernanceServiceError("invalid_contract", "officialUrl 只允许 HTTP 或 HTTPS。", 400);
    }
  }
}

function assertKnowledgeProfileOverride(product: UpdateProductRegistryInput) {
  if (!product.knowledgeProfile) return;
  const categories = ["positioning", "audiences", "capabilities", "scenarios", "boundaries"] as const;
  for (const category of categories) {
    const items = product.knowledgeProfile[category];
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !item.trim())) {
      throw new V5GovernanceServiceError(
        "invalid_product_profile_override",
        `${category} 必须是非空文本数组。`,
        400,
        "删除空白条目后重新保存。"
      );
    }
  }
  if (!Number.isInteger(product.knowledgeProfile.sourceFactCount) || product.knowledgeProfile.sourceFactCount < 0) {
    throw new V5GovernanceServiceError("invalid_product_profile_override", "sourceFactCount 不合法。", 400);
  }
}

function assertProjectInput(project: Omit<CreateGeoResearchProjectInput, "productId">) {
  assertText(project.expressionFocus, "expressionFocus", 4000);
  assertStringList(project.researchMarkets, "researchMarkets", 20);
  assertStringList(project.languages, "languages", 20);
  assertStringList(project.targetChannels, "targetChannels", 30);
  assertStringList(project.forbiddenFocus, "forbiddenFocus", 100);
}

export async function listProducts(input?: { includeInactive?: boolean }) {
  return listProductRegistryRecords(input);
}

export async function getProductWorkflowSummary(productId: string) {
  const product = await getProduct(productId);
  const [workspace, snapshot, latestStrategyPack, productProfile] = await Promise.all([
    readGeoResearchWorkspace(product.productId),
    readLatestGeoSourceSnapshot(product.productId),
    readLatestProductStrategyPack(product.productId),
    readProductKnowledgeProfile(product.productId, product.displayName)
  ]);
  return compileProductWorkflowSummary({
    product,
    profile: productProfile,
    snapshot,
    workspace,
    strategyPack: latestStrategyPack,
    providerReady: getGeoResearchProviderReadiness().status === "ready"
  });
}

export async function listProductsWithGeoOverview(input?: { includeInactive?: boolean }) {
  const products = await listProductRegistryRecords(input);
  const providerReady = getGeoResearchProviderReadiness().status === "ready";
  const compiled = await Promise.all(products.map(async (product) => {
    const [workspace, snapshot, latestStrategyPack, productProfile] = await Promise.all([
      readGeoResearchWorkspace(product.productId),
      readLatestGeoSourceSnapshot(product.productId),
      readLatestProductStrategyPack(product.productId),
      readProductKnowledgeProfile(product.productId, product.displayName)
    ]);
    const blueprint = workspace?.currentBlueprint;
    const hasFormalSourceSnapshot = snapshot?.quality.status === "ready";
    const openRun = workspace?.latestRun
      && !["completed", "failed", "cancelled"].includes(workspace.latestRun.status);
    const nextAction: ProductGeoOverview["nextAction"] = !workspace
      ? "create_project"
      : !hasFormalSourceSnapshot
        ? "add_sources"
        : latestStrategyPack?.status === "pending_strategy_review"
          ? "review_strategy"
          : product.strategyPackId
            ? "monthly_strategy"
            : openRun
              ? "open_run"
              : !providerReady
                ? "configure_provider"
                : "start_research";
    const overview: ProductGeoOverview = {
      productId: product.productId,
      projectStatus: workspace?.project.status,
      latestRunStatus: workspace?.latestRun?.status,
      blueprintStatus: blueprint?.status,
      hasSourceSnapshot: hasFormalSourceSnapshot,
      sourceCount: snapshot?.sourceCount || 0,
      isPromoting: product.isPromoting,
      strategyPackId: product.strategyPackId,
      latestStrategyPackId: latestStrategyPack?.id,
      strategyPackStatus: latestStrategyPack?.status,
      nextAction
    };
    return {
      overview,
      workflowSummary: compileProductWorkflowSummary({
        product,
        profile: productProfile,
        snapshot,
        workspace,
        strategyPack: latestStrategyPack,
        providerReady
      })
    };
  }));
  return {
    products,
    overviews: compiled.map((item) => item.overview),
    workflowSummaries: compiled.map((item) => item.workflowSummary)
  };
}

export async function getProduct(productId: string) {
  if (isDemoMode()) return demoProducts[productId] || demoProducts["workbuddy"];
  assertText(productId, "productId", 64);
  const product = await readProductRegistryRecord(productId);
  if (!product) {
    throw new V5GovernanceServiceError("product_not_found", "产品不存在。", 404);
  }
  return product;
}

export async function getActiveProduct(productId: string) {
  if (isDemoMode()) return demoProducts[productId] || demoProducts["workbuddy"];
  assertText(productId, "productId", 64);
  return assertActiveProductRegistryRecord(productId);
}

export async function deleteProductKnowledgeBase(input: {
  productId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 不合法。", 400);
  }
  if (input.actor.actorType !== "human" || !["product_owner", "business_owner", "developer_admin"].includes(input.actor.actorRole)) {
    throw new V5GovernanceServiceError("permission_denied", "只有产品负责人可以删除产品知识库。", 403);
  }
  const { indexNames = [], ...result } = await deleteProductKnowledgeBaseRecord(input);
  if (!indexNames.length) return result;

  if (getRagInfrastructureStatus().opensearch.status !== "ready") {
    return {
      ...result,
      cleanupWarning: "资料已从工作台主库清除，但检索服务当前不可用，外部索引待服务恢复后清理。"
    };
  }

  const openSearch = new HttpRagOpenSearchAdapter();
  const cleanupResults = await Promise.allSettled(indexNames.map((indexName) => openSearch.deleteIndex(indexName)));
  const failedCount = cleanupResults.filter((cleanup) => cleanup.status === "rejected"
    && !(cleanup.reason instanceof Error && cleanup.reason.message.includes("OpenSearch 404"))).length;
  return failedCount
    ? { ...result, cleanupWarning: `资料已从工作台主库清除，但有 ${failedCount} 个外部检索索引清理失败。` }
    : result;
}

export async function updateProductPromotion(input: {
  productId: string;
  isPromoting: boolean;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertActor(input.actor);
  return updateProductPromotionRecord(input);
}

export async function updateProduct(input: {
  productId: string;
  product: UpdateProductRegistryInput;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human" || !["product_owner", "business_owner", "developer_admin"].includes(input.actor.actorRole)) {
    throw new V5GovernanceServiceError("permission_denied", "只有产品负责人可以修改产品信息。", 403);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  assertProductInput(input.product);
  assertKnowledgeProfileOverride(input.product);
  return updateProductRegistryRecord(input);
}

export async function onboardProductForGeoResearch(input: {
  product: CreateProductRegistryInput;
  research: Omit<CreateGeoResearchProjectInput, "productId">;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.idempotencyKey, "idempotencyKey", 96);
  assertActor(input.actor);
  assertProductInput(input.product);
  assertProjectInput(input.research);

  const productWrite = await createProductRegistryRecord({
    product: input.product,
    idempotencyKey: `${input.idempotencyKey}:product`,
    actor: input.actor
  });
  const projectWrite = await createGeoResearchProjectRecord({
    project: { ...input.research, productId: productWrite.productId },
    idempotencyKey: `${input.idempotencyKey}:research-project`,
    actor: input.actor
  });
  const product = await getProduct(productWrite.productId);
  const workspace = await readGeoResearchWorkspace(product.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError(
      "research_project_not_found",
      "产品已创建，但调研项目读取失败。",
      500,
      "使用同一 idempotencyKey 重试，系统会复用已创建产品。"
    );
  }
  return {
    replayed: productWrite.replayed && projectWrite.replayed,
    product,
    workspace
  };
}
