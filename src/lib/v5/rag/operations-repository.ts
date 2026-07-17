import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, parseV5Json, stringifyV5Json, type V5GovernanceActor } from "../knowledge-governance-repository";
import { routeRagBadcase } from "./evaluation-service";

export async function readEvaluationRun(id: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM rag_evaluation_run WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) return undefined;
  return { evaluationRunId: String(rows[0].id), indexSnapshotId: String(rows[0].index_snapshot_id), baselineSnapshotId: rows[0].baseline_snapshot_id ? String(rows[0].baseline_snapshot_id) : undefined, status: String(rows[0].status), summary: parseV5Json(rows[0].summary, {}), passed: Boolean(rows[0].passed), startedAt: rows[0].started_at, completedAt: rows[0].completed_at };
}

export async function createBadcase(input: { productId: string; badcaseType: string; retrievalRequestId?: string; evidencePreviewId?: string; finalEvidencePackId?: string; chunkId?: string; claimId?: string; description: string; actor: V5GovernanceActor }) {
  const route = routeRagBadcase(input.badcaseType); const id = `badcase-${randomUUID()}`;
  await getV5GovernancePool().query("INSERT INTO rag_badcase (id, product_id, stage, badcase_type, retrieval_request_id, evidence_preview_id, final_evidence_pack_id, chunk_id, claim_id, description, status, owner_role, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)", [id, input.productId, route.stage, input.badcaseType, input.retrievalRequestId || null, input.evidencePreviewId || null, input.finalEvidencePackId || null, input.chunkId || null, input.claimId || null, input.description, route.ownerRole, input.actor.actorId]);
  return { badcaseId: id, ...route, status: "open" };
}

export async function updateBadcase(input: { badcaseId: string; status: string; resolution: Record<string, unknown>; actor: V5GovernanceActor }) {
  await getV5GovernancePool().query("UPDATE rag_badcase SET status = ?, resolution = ?, resolved_at = IF(? IN ('resolved','superseded'), NOW(), resolved_at) WHERE id = ?", [input.status, stringifyV5Json(input.resolution), input.status, input.badcaseId]);
  return { badcaseId: input.badcaseId, status: input.status };
}

export async function createEvidenceFeedback(input: { retrievalRequestId: string; evidencePreviewId?: string; finalEvidencePackId?: string; chunkId: string; claimId: string; feedbackType: string; actor: V5GovernanceActor }) {
  const id = `feedback-${randomUUID()}`;
  await getV5GovernancePool().query("INSERT INTO rag_human_evidence_feedback (id, retrieval_request_id, evidence_preview_id, final_evidence_pack_id, chunk_id, claim_id, feedback_type, actor_id, actor_role, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, input.retrievalRequestId, input.evidencePreviewId || null, input.finalEvidencePackId || null, input.chunkId, input.claimId, input.feedbackType, input.actor.actorId, input.actor.actorRole, input.actor.auditReason]);
  return { feedbackId: id };
}
