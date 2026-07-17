import { createHash } from "node:crypto";
import type { RagSourceImportCandidate, RagSourceDisposition } from "./source-registry";

export const RAG_SOURCE_IMPORT_VERSION = "rag-source-import@1";

export type RagSourceImportWriteStatus = "review_required" | "isolated";

export interface RagSourceImportPreparedCandidate extends RagSourceImportCandidate {
  writeStatus: RagSourceImportWriteStatus;
  safetyStatus: "pending" | "isolated";
  qualityFlags: string[];
  isolatedReason?: string;
}
export interface RagSourceImportExecutionPlan {
  planHash: string;
  importVersion: string;
  candidates: RagSourceImportPreparedCandidate[];
  skipped: Array<{ sourceId: string; relativePath: string; disposition: RagSourceDisposition; reason: string }>;
  summary: {
    discovered: number;
    writable: number;
    reviewRequired: number;
    isolated: number;
    skipped: number;
    sourceRevisionCandidates: number;
    byProduct: Record<string, number>;
  };
}

function normalizeCandidate(candidate: RagSourceImportCandidate): RagSourceImportPreparedCandidate | undefined {
  if (candidate.disposition === "excluded_text") return undefined;
  const isolated = candidate.disposition !== "production_candidate";
  return {
    ...candidate,
    writeStatus: isolated ? "isolated" : "review_required",
    safetyStatus: isolated ? "isolated" : "pending",
    qualityFlags: [
      `registry:${candidate.registryId}`,
      `namespace:${candidate.namespace}`,
      `disposition:${candidate.disposition}`,
      "human_governance_required"
    ],
    isolatedReason: isolated ? candidate.reason : undefined
  };
}

function canonicalPlanValue(candidates: RagSourceImportPreparedCandidate[]) {
  return candidates
    .map((candidate) => ({
      sourceId: candidate.sourceId,
      productId: candidate.productId,
      knowledgeBaseId: candidate.knowledgeBaseId,
      relativePath: candidate.relativePath,
      contentHash: candidate.contentHash,
      disposition: candidate.disposition,
      writeStatus: candidate.writeStatus
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function prepareRagSourceImport(candidates: RagSourceImportCandidate[]): RagSourceImportExecutionPlan {
  const prepared = candidates.map(normalizeCandidate).filter((item): item is RagSourceImportPreparedCandidate => Boolean(item));
  const skipped = candidates
    .filter((candidate) => candidate.disposition === "excluded_text")
    .map((candidate) => ({
      sourceId: candidate.sourceId,
      relativePath: candidate.relativePath,
      disposition: candidate.disposition,
      reason: candidate.reason
    }));
  const planHash = createHash("sha256")
    .update(JSON.stringify({ importVersion: RAG_SOURCE_IMPORT_VERSION, candidates: canonicalPlanValue(prepared) }))
    .digest("hex");
  const byProduct = Object.fromEntries(
    Array.from(new Set(prepared.map((candidate) => candidate.productId)))
      .sort()
      .map((productId) => [productId, prepared.filter((candidate) => candidate.productId === productId).length])
  );
  return {
    planHash,
    importVersion: RAG_SOURCE_IMPORT_VERSION,
    candidates: prepared,
    skipped,
    summary: {
      discovered: candidates.length,
      writable: prepared.length,
      reviewRequired: prepared.filter((candidate) => candidate.writeStatus === "review_required").length,
      isolated: prepared.filter((candidate) => candidate.writeStatus === "isolated").length,
      skipped: skipped.length,
      sourceRevisionCandidates: prepared.filter((candidate) => Boolean(candidate.normalizedTextRef)).length,
      byProduct
    }
  };
}
