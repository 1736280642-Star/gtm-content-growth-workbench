import { createHash } from "node:crypto";
import type { V5ProductClaim, V5SourceAsset, V5SourceRevision } from "../knowledge-governance-contracts";
import type { RagKnowledgeChunk, RagNamespace } from "./contracts";

export interface RagChunkingInput {
  indexSnapshotId: string;
  namespace: RagNamespace;
  productId: string;
  productName: string;
  knowledgeBaseIds: string[];
  rulePackageVersionId: string;
  source: V5SourceAsset;
  revision: V5SourceRevision;
  normalizedMarkdown: string;
  approvedClaims: V5ProductClaim[];
  blockedClaimIds: string[];
  unresolvedConflictIds?: string[];
  chunkerVersion: string;
}

export interface RagChunkingResult {
  chunks: RagKnowledgeChunk[];
  reviewRequired: RagKnowledgeChunk[];
  qualityIssues: Array<{ chunkId: string; codes: string[] }>;
}

interface MarkdownSection { headingPath: string[]; content: string; start: number; end: number }

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableChunkId(...parts: string[]) {
  return `chunk-${hash(parts.join(":" )).slice(0, 32)}`;
}

function sections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headings: string[] = [];
  const output: MarkdownSection[] = [];
  let buffer: string[] = [];
  let start = 0;
  let offset = 0;
  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) output.push({ headingPath: [...headings], content, start, end: start + content.length });
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      flush();
      const level = match[1].length;
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
      start = offset + line.length + 1;
    } else {
      if (!buffer.length) start = offset;
      buffer.push(line);
    }
    offset += line.length + 1;
  }
  flush();
  return output;
}

function claimSection(claim: V5ProductClaim, allSections: MarkdownSection[], markdown: string) {
  const quoteIndex = markdown.indexOf(claim.originalQuote);
  if (quoteIndex >= 0) return allSections.find((section) => quoteIndex >= section.start && quoteIndex <= section.end);
  const heading = claim.sourceLocator.headingPath.join(" / ").toLowerCase();
  return allSections.find((section) => section.headingPath.join(" / ").toLowerCase() === heading);
}

function semanticType(claim: V5ProductClaim) {
  if (claim.supportMode === "negative" || claim.claimType.includes("limitation") || claim.limitations.length) return "limitation_chunk";
  if (claim.claimType.includes("citation") || claim.claimType.includes("policy")) return "official_citation";
  return "claim_chunk";
}

function issueCodes(chunk: RagKnowledgeChunk, claim?: V5ProductClaim) {
  const issues: string[] = [];
  if (!chunk.productId) issues.push("product_missing");
  if (!chunk.sourceLocator.headingPath.length && chunk.sourceLocator.paragraphIndex === undefined && !chunk.sourceLocator.characterRange) issues.push("source_locator_missing");
  if (chunk.semanticType === "claim_chunk" && !chunk.primaryClaimId) issues.push("claim_missing");
  if (claim && ["planned", "beta"].includes(claim.capabilityStatus) && chunk.capabilityStatus === "current") issues.push("lifecycle_status_lost");
  if (/\b\d+(?:\.\d+)?\s*(?:%|ms|秒|分钟|小时|家|万)/i.test(chunk.content) && !chunk.conditions.length) issues.push("metric_without_conditions");
  if (chunk.documentType.includes("article") && chunk.authorityLevel === "B2" && chunk.supportMode !== "background_only") issues.push("background_promoted_to_capability");
  if (chunk.semanticType === "limitation_chunk" && !chunk.claimIds.length) issues.push("orphan_limitation");
  if (chunk.content.length < 40) issues.push("too_short");
  if (chunk.content.length > 2400) issues.push("too_long");
  return issues;
}

export function buildClaimAwareChunks(input: RagChunkingInput): RagChunkingResult {
  const markdown = input.normalizedMarkdown.replace(/\r\n/g, "\n");
  const parsedSections = sections(markdown);
  const chunks: RagKnowledgeChunk[] = [];
  const reviewRequired: RagKnowledgeChunk[] = [];
  const qualityIssues: Array<{ chunkId: string; codes: string[] }> = [];
  const approvedClaims = input.approvedClaims.filter((claim) => !input.blockedClaimIds.includes(claim.claimId));
  const unresolvedConflictIds = new Set(input.unresolvedConflictIds || []);
  const parentBySection = new Map<string, RagKnowledgeChunk>();

  for (const section of parsedSections) {
    const sectionClaims = approvedClaims.filter((claim) => claimSection(claim, parsedSections, markdown) === section);
    if (!sectionClaims.length) continue;
    const key = section.headingPath.join(" / ") || input.source.title || input.revision.titleSnapshot || "正文";
    const parent: RagKnowledgeChunk = {
      chunkId: stableChunkId(input.indexSnapshotId, input.revision.sourceRevisionId, "parent", key), indexSnapshotId: input.indexSnapshotId, namespace: input.namespace,
      productId: input.productId, productName: input.productName, knowledgeBaseIds: input.knowledgeBaseIds,
      sourceId: input.source.sourceId, sourceRevisionId: input.revision.sourceRevisionId, claimIds: sectionClaims.map((claim) => claim.claimId),
      sourceLocator: { headingPath: section.headingPath, characterRange: [section.start, section.end] }, semanticType: "source_parent",
      chunkTitle: key, summary: section.content.slice(0, 240), content: section.content, originalQuote: section.content,
      canonicalUrl: input.source.canonicalUrl, documentType: input.source.documentType, authorityLevel: input.source.authorityLevel,
      lifecycleStatus: input.source.lifecycleStatus, visibility: input.source.visibility, supportMode: "background_only", claimScope: "public_product",
      capabilityStatus: input.source.lifecycleStatus, conditions: [], limitations: [], scenarioTags: [], capabilityTags: [], audienceTags: [], problemTags: [],
      channelTags: [], distilledTermIds: [], questionCandidateIds: [], conflictGroupIds: sectionClaims.flatMap((claim) => claim.conflictGroupId && unresolvedConflictIds.has(claim.conflictGroupId) ? [claim.conflictGroupId] : []),
      rulePackageVersionId: input.rulePackageVersionId, validFrom: input.source.validFrom, validUntil: input.source.validUntil,
      contentHash: hash(section.content), semanticHash: hash(section.content.toLowerCase().replace(/\s+/g, " ")),
      duplicateClusterId: hash(section.content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")).slice(0, 32), status: "active", chunkerVersion: input.chunkerVersion
    };
    parentBySection.set(key, parent);
    chunks.push(parent);
  }

  for (const claim of approvedClaims) {
    const section = claimSection(claim, parsedSections, markdown);
    const title = section?.headingPath.join(" / ") || input.source.title || "Claim";
    const parent = parentBySection.get(title);
    const context = section?.content || claim.originalQuote;
    const contentParts = [claim.originalQuote, ...claim.conditions.map((item) => `适用条件：${item}`), ...claim.limitations.map((item) => `限制：${item}`)];
    if (claim.productVersion) contentParts.push(`适用版本：${claim.productVersion}`);
    const content = contentParts.join("\n");
    const chunk: RagKnowledgeChunk = {
      chunkId: stableChunkId(input.indexSnapshotId, claim.claimId, semanticType(claim)), indexSnapshotId: input.indexSnapshotId, namespace: input.namespace,
      productId: input.productId, productName: input.productName, knowledgeBaseIds: input.knowledgeBaseIds,
      sourceId: claim.sourceId, sourceRevisionId: claim.sourceRevisionId, parentChunkId: parent?.chunkId,
      primaryClaimId: claim.claimId, claimIds: [claim.claimId, ...claim.parentClaimIds], sourceLocator: claim.sourceLocator,
      semanticType: semanticType(claim), chunkTitle: title, summary: claim.normalizedClaim, content,
      originalQuote: claim.originalQuote, canonicalUrl: input.source.canonicalUrl, documentType: input.source.documentType,
      authorityLevel: claim.authorityLevel, lifecycleStatus: input.source.lifecycleStatus, visibility: input.source.visibility,
      supportMode: claim.supportMode, claimScope: claim.claimScope, capabilityStatus: claim.capabilityStatus,
      conditions: claim.conditions, limitations: claim.limitations, scenarioTags: claim.claimType.includes("scenario") ? [claim.normalizedClaim] : [],
      capabilityTags: claim.claimType.includes("capability") ? [claim.normalizedClaim] : [], audienceTags: [], problemTags: [], channelTags: [],
      distilledTermIds: [], questionCandidateIds: [], conflictGroupIds: claim.conflictGroupId && unresolvedConflictIds.has(claim.conflictGroupId) ? [claim.conflictGroupId] : [],
      rulePackageVersionId: input.rulePackageVersionId, validFrom: claim.validFrom || input.source.validFrom, validUntil: claim.validUntil || input.source.validUntil,
      contentHash: hash(content), semanticHash: hash(claim.normalizedClaim.toLowerCase().replace(/\s+/g, " ")),
      duplicateClusterId: hash(`${input.productId}:${claim.normalizedClaim.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")}`).slice(0, 32),
      status: "active", chunkerVersion: input.chunkerVersion
    };
    const issues = issueCodes(chunk, claim);
    if (!section || !context.includes(claim.originalQuote)) issues.push("quote_not_found_in_revision");
    if (issues.length) {
      chunk.status = "review_required";
      reviewRequired.push(chunk);
      qualityIssues.push({ chunkId: chunk.chunkId, codes: Array.from(new Set(issues)) });
    } else {
      chunks.push(chunk);
    }
  }

  return { chunks, reviewRequired, qualityIssues };
}
