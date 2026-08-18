import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, parseV5Json, stringifyV5Json, type V5GovernanceActor } from "../knowledge-governance-repository";
import type { RagEvaluationSummary, RagKnowledgeChunk, RagRetrievalRequest } from "./contracts";
import { evaluateRagMetrics } from "./evaluation-service";
import { HttpRagOpenSearchAdapter } from "./opensearch-adapter";
import { readRagIndexSnapshotRecord, readRagManifestRecord } from "./rag-repository";

interface EvaluationClaim {
  claimId: string;
  normalizedClaim: string;
  originalQuote: string;
  reviewStatus: string;
  conditions: string[];
  limitations: string[];
}

function ratio(passed: number, total: number) {
  return total ? passed / total : 1;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function hasLocator(locator: RagKnowledgeChunk["sourceLocator"]) {
  return Array.isArray(locator.headingPath)
    && (Number.isInteger(locator.paragraphIndex) || (Array.isArray(locator.characterRange) && locator.characterRange.length === 2));
}

export async function evaluateAutomaticRagIndexSnapshot(
  indexSnapshotId: string,
  actor: V5GovernanceActor,
  dependencies: { openSearch?: HttpRagOpenSearchAdapter } = {}
): Promise<RagEvaluationSummary> {
  const snapshot = await readRagIndexSnapshotRecord(indexSnapshotId);
  if (!snapshot || snapshot.status !== "validating") throw new Error("Automatic evaluation requires a validating IndexSnapshot.");
  const manifest = await readRagManifestRecord(snapshot.manifestId);
  if (!manifest || manifest.status !== "approved") throw new Error("Automatic evaluation requires an approved Manifest.");
  const pool = getV5GovernancePool();
  const [approvedRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, normalized_claim, original_quote, review_status, conditions, limitations
     FROM product_claim WHERE id IN (?) AND product_id = ? ORDER BY id`,
    [manifest.approvedClaimIds, manifest.productId]
  );
  const [blockedRows] = manifest.blockedClaimIds.length
    ? await pool.query<RowDataPacket[]>(
      `SELECT id, normalized_claim, original_quote, review_status, conditions, limitations
       FROM product_claim WHERE id IN (?) AND product_id = ? ORDER BY id`,
      [manifest.blockedClaimIds, manifest.productId]
    )
    : [[] as unknown as RowDataPacket[]];
  const [chunkRows] = await pool.query<RowDataPacket[]>(
    `SELECT primary_claim_id, claim_ids, source_id, source_revision_id, source_locator, conditions, limitations,
            visibility, lifecycle_status, capability_status, conflict_group_ids, original_quote, content
     FROM rag_knowledge_chunk WHERE index_snapshot_id = ? AND status = 'active'`,
    [indexSnapshotId]
  );
  if (approvedRows.length !== manifest.approvedClaimIds.length) throw new Error("Evaluation could not load every approved Claim.");

  const mapClaim = (row: RowDataPacket): EvaluationClaim => ({
    claimId: String(row.id),
    normalizedClaim: String(row.normalized_claim),
    originalQuote: String(row.original_quote),
    reviewStatus: String(row.review_status),
    conditions: parseV5Json(row.conditions, []),
    limitations: parseV5Json(row.limitations, [])
  });
  const approved = approvedRows.map(mapClaim);
  const blocked = blockedRows.map(mapClaim);
  const openSearch = dependencies.openSearch || new HttpRagOpenSearchAdapter();
  const approvedRevisionSet = new Set(manifest.approvedSourceRevisionIds);
  const blockedClaimSet = new Set(manifest.blockedClaimIds);
  const queryResults: Array<{ claim: EvaluationClaim; expected: "approved" | "blocked"; hits: RagKnowledgeChunk[]; passed: boolean; reasons: string[] }> = [];

  for (const [expected, claims] of [["approved", approved], ["blocked", blocked]] as const) {
    for (const claim of claims) {
      const request: RagRetrievalRequest = {
        retrievalRequestId: `evaluation-request-${randomUUID()}`,
        matrixItemId: "automatic-index-evaluation",
        productId: manifest.productId,
        productName: manifest.productId,
        namespace: snapshot.namespace,
        language: snapshot.language,
        title: claim.normalizedClaim,
        channel: "wechat",
        contentType: "automatic_claim_replay",
        platformContentType: "explicit_launch_matrix",
        targetAudience: "index evaluator",
        sourceProblem: claim.originalQuote,
        distilledTermIds: [],
        rulePackageVersionId: manifest.activeRulePackageVersionId,
        permissionScope: ["public"],
        lifecycleStatuses: ["current", "unknown", "beta", "planned"],
        requestedAt: new Date().toISOString()
      };
      const hits = (await openSearch.keywordSearch(snapshot.indexName, request, 10)).map((item) => item.chunk);
      const exactClaimHit = hits.some((chunk) => chunk.claimIds.includes(claim.claimId));
      const forbiddenText = normalized(claim.normalizedClaim);
      const forbiddenTextHit = expected === "blocked" && claim.reviewStatus === "rejected" && forbiddenText.length >= 8 && hits.some((chunk) => {
        const content = normalized(`${chunk.content}\n${chunk.originalQuote}`);
        return content.includes(forbiddenText) || forbiddenText.includes(content);
      });
      const passed = expected === "approved" ? exactClaimHit : !exactClaimHit && !forbiddenTextHit;
      queryResults.push({ claim, expected, hits, passed, reasons: passed ? [] : [expected === "approved" ? "approved_claim_not_recalled" : "blocked_claim_recalled"] });
    }
  }

  const allHits = queryResults.flatMap((item) => item.hits);
  const approvedResults = queryResults.filter((item) => item.expected === "approved");
  const blockedResults = queryResults.filter((item) => item.expected === "blocked");
  const conditionalResults = approvedResults.filter((item) => item.claim.reviewStatus === "conditional");
  const representedClaimIds = new Set(chunkRows.flatMap((row) => parseV5Json<string[]>(row.claim_ids, [])));
  const locatorComplete = chunkRows.filter((row) => hasLocator(parseV5Json(row.source_locator, { headingPath: [] }))).length;
  const officialCitationHits = approvedResults.filter((item) => item.hits.some((chunk) =>
    chunk.claimIds.includes(item.claim.claimId) && chunk.originalQuote === item.claim.originalQuote
  )).length;
  const limitationHits = conditionalResults.filter((item) => item.hits.some((chunk) =>
    chunk.claimIds.includes(item.claim.claimId) && chunk.limitations.length > 0
  )).length;
  const riskCases = approvedResults.map((item) => {
    const expectedConditional = item.claim.reviewStatus === "conditional";
    const observedConditional = item.hits.some((chunk) => chunk.claimIds.includes(item.claim.claimId) && chunk.limitations.length > 0);
    return expectedConditional === observedConditional;
  });
  let duplicateClusterTop5Max = 0;
  for (const item of queryResults) {
    const selected: RagKnowledgeChunk[] = [];
    const seenClusters = new Set<string>();
    for (const hit of item.hits) {
      if (seenClusters.has(hit.duplicateClusterId)) continue;
      seenClusters.add(hit.duplicateClusterId);
      selected.push(hit);
      if (selected.length === 5) break;
    }
    const counts = new Map<string, number>();
    for (const hit of selected) counts.set(hit.duplicateClusterId, (counts.get(hit.duplicateClusterId) || 0) + 1);
    duplicateClusterTop5Max = Math.max(duplicateClusterTop5Max, ...counts.values(), 0);
  }
  const blockedClaimHits = allHits.filter((chunk) => chunk.claimIds.some((id) => blockedClaimSet.has(id))).length;
  const blockingFalseNegatives = blockedResults.filter((item) => !item.passed).length;
  const metrics = {
    unapprovedProductionSources: allHits.filter((chunk) => !approvedRevisionSet.has(chunk.sourceRevisionId)).length,
    crossProductHits: allHits.filter((chunk) => chunk.productId !== manifest.productId).length,
    permissionBoundaryHits: allHits.filter((chunk) => chunk.visibility !== "public").length,
    blockedClaimHits,
    plannedAsCurrentHits: allHits.filter((chunk) => ["planned", "beta"].includes(chunk.capabilityStatus) && chunk.lifecycleStatus === "current").length,
    claimLocatorCompleteness: ratio(locatorComplete, chunkRows.length),
    scopedFactRetention: ratio(approved.filter((claim) => representedClaimIds.has(claim.claimId)).length, approved.length),
    coreClaimRecallAt10: ratio(approvedResults.filter((item) => item.passed).length, approvedResults.length),
    conditionalLimitationRecall: ratio(limitationHits, conditionalResults.length),
    officialCitationHitRate: ratio(officialCitationHits, approvedResults.length),
    duplicateClusterTop5Max,
    previewRiskAccuracy: ratio(riskCases.filter(Boolean).length, riskCases.length),
    finalPackDecisionAccuracy: ratio(queryResults.filter((item) => item.passed).length, queryResults.length),
    blockingFalseNegatives
  };
  const summary = evaluateRagMetrics(metrics);
  const evaluationRunId = `evaluation-${randomUUID()}`;
  await pool.query(
    `INSERT INTO rag_evaluation_run (id, index_snapshot_id, status, summary, passed, started_at, completed_at, created_by)
     VALUES (?, ?, 'completed', ?, ?, NOW(), NOW(), ?)`,
    [evaluationRunId, indexSnapshotId, stringifyV5Json(summary), summary.passed, actor.actorId]
  );
  for (const item of queryResults) {
    const evaluationCaseId = `evaluation-case-${randomUUID()}`;
    await pool.query(
      `INSERT INTO rag_evaluation_case (id, product_id, case_type, request_fixture, expected_result, blocking_metric, status, created_by)
       VALUES (?, ?, ?, ?, ?, TRUE, 'generated', ?)`,
      [evaluationCaseId, manifest.productId, item.expected === "approved" ? "approved_claim_recall" : "blocked_claim_exclusion", stringifyV5Json({ claimId: item.claim.claimId }), stringifyV5Json({ decision: item.expected === "approved" ? "generatable" : "blocked" }), actor.actorId]
    );
    await pool.query(
      `INSERT INTO rag_evaluation_result (id, evaluation_run_id, evaluation_case_id, metric_values, passed, failure_reasons)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`evaluation-result-${randomUUID()}`, evaluationRunId, evaluationCaseId, stringifyV5Json({ hitCount: item.hits.length }), item.passed, stringifyV5Json(item.reasons)]
    );
  }
  return summary;
}
