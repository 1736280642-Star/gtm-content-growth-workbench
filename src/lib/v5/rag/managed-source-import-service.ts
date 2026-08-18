import { createHash } from "node:crypto";
import { V5GovernanceRepositoryError, type V5GovernanceActor } from "../knowledge-governance-repository";
import { assertActiveProductRegistryRecord } from "../product-registry-repository";
import { confirmProductIdentityFromSourceRecord } from "../product-registry-repository";
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
import { cleanParsedWebMarkdown } from "./automatic-knowledge-production";
import { registerOfficialWebsiteSourcesAndEnsureAudits } from "../website-coverage-repository";

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

export function inferOfficialUrlFromConfirmedSources(input: Pick<ManagedSourceImportInput, "authorityLevel" | "sources">) {
  if (input.authorityLevel !== "A2") return undefined;
  const candidates = input.sources.flatMap((source) => {
    if (!source.canonicalUrl) return [];
    try {
      const parsed = new URL(source.canonicalUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) return [];
      const host = parsed.hostname.toLowerCase();
      if (["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(host)) return [];
      parsed.hash = "";
      return [{ url: parsed.toString(), host }];
    } catch {
      return [];
    }
  });
  if (!candidates.length || new Set(candidates.map((item) => item.host)).size !== 1) return undefined;
  return [...new Set(candidates.map((item) => item.url))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
}

function oneUnambiguousValue(values: Array<string | undefined>) {
  const normalized = [...new Map(values
    .map((value) => value?.replace(/\s+/g, " ").trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => [value.toLocaleLowerCase(), value])).values()];
  return normalized.length === 1 ? normalized[0] : undefined;
}

export function inferProductIdentityFromConfirmedSources(
  input: Pick<ManagedSourceImportInput, "authorityLevel" | "sources">
) {
  if (input.authorityLevel !== "A2") return {};
  const brandName = oneUnambiguousValue(input.sources.map((source) => {
    const parts = source.title.split(/\s*[|｜]\s*/).map((part) => part.trim()).filter(Boolean);
    const candidate = parts.length > 1 ? parts.at(-1) : undefined;
    return candidate && candidate.length <= 80 ? candidate : undefined;
  }));
  const entityCandidates = input.sources.flatMap((source) => {
    const labeled = [...source.markdown.matchAll(/(?:公司|运营主体|开发者|Company)\s*[:：]\s*([^\n|]{2,120})/gi)]
      .map((match) => match[1]);
    const legalNames = source.markdown.match(/[\u4e00-\u9fff（）()·]{2,60}(?:有限责任公司|有限公司)|\b[A-Z][A-Za-z0-9&.,' -]{1,80}\s(?:Inc\.?|Ltd\.?|LLC|Corporation|Corp\.?)\b/g) || [];
    return [...labeled, ...legalNames]
      .map((value) => value.replace(/^[·•\-—\s]+|[·•\-—\s]+$/g, "").trim())
      .filter((value) => /有限责任公司|有限公司|\b(?:Inc\.?|Ltd\.?|LLC|Corporation|Corp\.?)\b/i.test(value));
  });
  return {
    brandName,
    officialEntity: oneUnambiguousValue(entityCandidates),
    officialUrl: inferOfficialUrlFromConfirmedSources(input)
  };
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
    const parsed = normalizedMarkdown(source.markdown);
    const markdown = source.canonicalUrl
      ? cleanParsedWebMarkdown(parsed, { productName: input.productId }).markdown
      : parsed;
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
  const parsedMarkdown = normalizedMarkdown(source.markdown);
  const markdown = source.canonicalUrl
    ? cleanParsedWebMarkdown(parsedMarkdown, { productName: product.displayName }).markdown
    : parsedMarkdown;
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
  const inferredIdentity = inferProductIdentityFromConfirmedSources(input);
  const hasIdentityCandidate = Object.values(inferredIdentity).some(Boolean);
  const identityWrite = hasIdentityCandidate
    ? await confirmProductIdentityFromSourceRecord({
        productId: input.productId,
        ...inferredIdentity,
        sourceIds: candidates.map((candidate) => candidate.sourceId),
        actor: { ...input.actor, auditReason: `${input.actor.auditReason}；从已确认 A2 来源补全产品身份空缺` }
      })
    : undefined;
  const websiteAudit = await registerOfficialWebsiteSourcesAndEnsureAudits({
    productId: input.productId,
    candidates: candidates.flatMap((candidate) => candidate.canonicalUrl ? [{
      productId: candidate.productId,
      sourceId: candidate.sourceId,
      sourceRevisionId: buildManagedSourceRevisionId(candidate.sourceId, candidate.contentHash),
      canonicalUrl: candidate.canonicalUrl,
      contentHash: candidate.contentHash,
      authorityLevel: candidate.authorityLevel
    }] : []),
    actor: { ...input.actor, auditReason: `${input.actor.auditReason}；登记正式官网来源并自动启动 GEO 基线审计` }
  });
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
    brandName: product.brandName || identityWrite?.brandName,
    officialEntity: product.officialEntity || identityWrite?.officialEntity,
    officialUrl: product.officialUrl || identityWrite?.officialUrl,
    productIdentityUpdated: identityWrite?.updated === true,
    officialUrlUpdated: identityWrite?.updated === true && !product.officialUrl && Boolean(identityWrite.officialUrl),
    websiteAudit: {
      officialSourceCount: websiteAudit.officialSourceCount,
      auditRunIds: websiteAudit.auditRunIds,
      knowledgeReadiness: websiteAudit.profile?.knowledgeReadiness,
      publicGeoReadiness: websiteAudit.profile?.publicGeoReadiness,
      coverageProfileVersion: websiteAudit.profile?.profileVersion
    },
    pipelineStatus: infrastructure.status === "ready" ? "queued" as const : "pending_config" as const,
    missingConfiguration: infrastructure.status === "ready"
      ? []
      : [...infrastructure.mysql.missingConfig, ...infrastructure.opensearch.missingConfig, ...infrastructure.embedding.missingConfig]
  };
}
