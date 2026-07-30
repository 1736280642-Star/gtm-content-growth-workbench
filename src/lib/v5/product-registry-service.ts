import type { CreateGeoResearchProjectInput } from "./geo-research-contracts";
import {
  createGeoResearchProjectRecord,
  readGeoResearchWorkspace,
  readLatestGeoSourceSnapshot
} from "./geo-research-repository";
import { getGeoResearchProviderReadiness } from "./geo-research-provider";
import type { ProductGeoOverview } from "./geo-research-contracts";
import type { CreateProductRegistryInput } from "./product-registry-contracts";
import {
  assertActiveProductRegistryRecord,
  createProductRegistryRecord,
  listProductRegistryRecords,
  readProductRegistryRecord
} from "./product-registry-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";

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

export async function listProductsWithGeoOverview(input?: { includeInactive?: boolean }) {
  const products = await listProductRegistryRecords(input);
  const providerReady = getGeoResearchProviderReadiness().status === "ready";
  const overviews = await Promise.all(products.map(async (product): Promise<ProductGeoOverview> => {
    const [workspace, snapshot] = await Promise.all([
      readGeoResearchWorkspace(product.productId),
      readLatestGeoSourceSnapshot(product.productId)
    ]);
    const blueprint = workspace?.currentBlueprint;
    const openRun = workspace?.latestRun
      && !["completed", "failed", "cancelled"].includes(workspace.latestRun.status);
    const nextAction: ProductGeoOverview["nextAction"] = !workspace
      ? "create_project"
      : !snapshot
        ? "add_sources"
        : blueprint?.status === "pending_review"
          ? "review_blueprint"
          : blueprint?.status === "approved"
            ? "monthly_strategy"
            : openRun
              ? "open_run"
              : !providerReady
                ? "configure_provider"
                : "start_research";
    return {
      productId: product.productId,
      projectStatus: workspace?.project.status,
      latestRunStatus: workspace?.latestRun?.status,
      blueprintStatus: blueprint?.status,
      hasSourceSnapshot: Boolean(snapshot),
      sourceCount: snapshot?.sourceCount || 0,
      nextAction
    };
  }));
  return { products, overviews };
}

export async function getProduct(productId: string) {
  assertText(productId, "productId", 64);
  const product = await readProductRegistryRecord(productId);
  if (!product) {
    throw new V5GovernanceServiceError("product_not_found", "产品不存在。", 404);
  }
  return product;
}

export async function getActiveProduct(productId: string) {
  assertText(productId, "productId", 64);
  return assertActiveProductRegistryRecord(productId);
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
