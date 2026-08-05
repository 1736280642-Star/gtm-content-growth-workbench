import { createHash } from "node:crypto";
import { V5GovernanceRepositoryError, type V5GovernanceActor } from "../knowledge-governance-repository";
import { assertActiveProductRegistryRecord } from "../product-registry-repository";
import type { ProductRegistryItem } from "../product-registry-contracts";
import type { RagSourceImportCandidate } from "./source-registry";
import { getRagInfrastructureStatus } from "./infrastructure";
import {
  buildManagedNormalizedTextRef,
  buildManagedRawAssetRef,
  buildManagedSourceRevisionId
} from "./managed-content-reference";
import {
  MANAGED_SOURCE_AUTHORITY_LEVELS,
  type ManagedKnowledgeProductId,
  type ManagedSourceAuthorityLevel
} from "./managed-source-contracts";
import { writeRagSourceImport } from "./source-import-repository";
import { prepareRagSourceImport } from "./source-import-service";

export const MANAGED_SOURCE_IMPORT_VERSION = "workbench-managed-source@1";

export interface ManagedSourceInput {
  sourceKey: string;
  title: string;
  markdown: string;
  canonicalUrl?: string;
  rawContent?: Buffer;
  mimeType?: string;
  originalFileName?: string;
}

export interface ManagedSourceImportInput {
  knowledgeBaseName: string;
  productId: ManagedKnowledgeProductId;
  authorityLevel: ManagedSourceAuthorityLevel;
  publicUseConfirmed: boolean;
  sources: ManagedSourceInput[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}

function stableId(prefix: string, value: string, length = 24) {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function normalizedMarkdown(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").trim();
}

function assertInput(input: ManagedSourceImportInput) {
  if (!input.productId.trim() || input.productId.length > 64) {
    throw new V5GovernanceRepositoryError("invalid_product", "所选产品标识无效。", 400);
  }
  if (!input.knowledgeBaseName.trim() || input.knowledgeBaseName.trim().length > 100) throw new V5GovernanceRepositoryError("invalid_knowledge_base_name", "知识库名称需为 1-100 个字符。", 400);
  if (!MANAGED_SOURCE_AUTHORITY_LEVELS.includes(input.authorityLevel)) throw new V5GovernanceRepositoryError("invalid_authority_level", "来源权威等级无效。", 400);
  if (!input.publicUseConfirmed) throw new V5GovernanceRepositoryError("public_use_not_confirmed", "自动治理和索引前必须确认资料可用于公开内容生产。", 400);
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128) throw new V5GovernanceRepositoryError("invalid_idempotency_key", "缺少有效的 idempotencyKey。", 400);
  if (!input.sources.length) throw new V5GovernanceRepositoryError("empty_sources", "至少需要一个已解析来源。", 400);
  for (const source of input.sources) {
    const markdown = normalizedMarkdown(source.markdown);
    const body = markdown.replace(/^#{1,6}\s+.*$/gm, "").trim();
    if (!source.sourceKey.trim() || !source.title.trim() || body.length < 8) {
      throw new V5GovernanceRepositoryError("source_text_too_short", `来源 ${source.title || source.sourceKey} 没有足够的可用正文。`, 400);
    }
  }
}

function buildCandidate(
  input: ManagedSourceImportInput,
  source: ManagedSourceInput,
  product: ProductRegistryItem
): RagSourceImportCandidate {
  const knowledgeBaseName = input.knowledgeBaseName.trim();
  // A product owns one default managed knowledge base. Its name may change without splitting future imports.
  const knowledgeBaseId = stableId("kb-product-", input.productId, 32);
  const canonicalSourceKey = source.canonicalUrl?.trim().toLowerCase() || source.sourceKey.trim().toLowerCase();
  const sourceId = stableId("src-managed-", `${knowledgeBaseId}:${canonicalSourceKey}`, 32);
  const markdown = normalizedMarkdown(source.markdown);
  const contentHash = createHash("sha256").update(markdown).digest("hex");
  const sourceRevisionId = buildManagedSourceRevisionId(sourceId, contentHash);
  const normalizedTextRef = buildManagedNormalizedTextRef(sourceRevisionId);
  const rawAssetRef = buildManagedRawAssetRef(sourceRevisionId);
  const sourceUpdatedAt = new Date().toISOString();

  return {
    registryId: `workbench-managed:${knowledgeBaseId}`,
    sourceId,
    productId: product.productId,
    productName: product.displayName,
    knowledgeBaseId,
    knowledgeBaseName,
    relativePath: (source.originalFileName || source.canonicalUrl || source.sourceKey).slice(0, 500),
    absolutePath: rawAssetRef,
    title: source.title.trim().slice(0, 500),
    canonicalUrl: source.canonicalUrl,
    contentHash,
    contentLength: markdown.length,
    sourceUpdatedAt,
    normalizedTextRef,
    rawAssetRef,
    managedContent: {
      normalizedText: markdown,
      rawContent: source.rawContent,
      mimeType: source.mimeType || "text/markdown",
      originalFileName: source.originalFileName
    },
    disposition: "production_candidate",
    namespace: "production_public",
    documentType: source.canonicalUrl ? "workbench_managed_url" : "workbench_managed_document",
    authorityLevel: input.authorityLevel,
    lifecycleStatus: "current",
    visibility: "public",
    allowedEvidenceRoles: ["product_definition", "product_capability", "scenario", "limitation", "official_citation"],
    forbiddenUsage: ["unqualified_performance", "unqualified_price", "customer_result"],
    governanceMode: "automatic_policy",
    reason: "A workbench user confirmed the product scope and public production eligibility."
  };
}

export async function importManagedSources(input: ManagedSourceImportInput) {
  assertInput(input);
  const product = await assertActiveProductRegistryRecord(input.productId);
  const candidates = input.sources.map((source) => buildCandidate(input, source, product));
  const plan = prepareRagSourceImport(candidates);
  const stored = await writeRagSourceImport({ plan, idempotencyKey: input.idempotencyKey, actor: input.actor, deferAutomaticClaims: true });
  const infrastructure = getRagInfrastructureStatus();
  return {
    knowledgeBaseId: candidates[0].knowledgeBaseId,
    productId: input.productId,
    sourceIds: candidates.map((candidate) => candidate.sourceId),
    batchIds: stored.batchIds,
    importId: stored.importId,
    createdSources: stored.createdSources,
    createdRevisions: stored.createdRevisions,
    generatedClaims: stored.generatedClaims,
    pipelineStatus: infrastructure.status === "ready" ? "queued" as const : "pending_config" as const,
    missingConfiguration: infrastructure.status === "ready"
      ? []
      : [...infrastructure.mysql.missingConfig, ...infrastructure.opensearch.missingConfig, ...infrastructure.embedding.missingConfig]
  };
}
