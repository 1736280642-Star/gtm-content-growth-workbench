import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, hashV5GovernancePayload, parseV5Json, writeV5GovernanceAudit } from "./knowledge-governance-repository";
import type { HostedResultSnapshot } from "./hosted-history-contracts";

/** Caller holds the source record lock. Archive and state transition commit together. */
export async function archiveHostedResult(connection: PoolConnection, snapshot: HostedResultSnapshot, actorId: string) {
  await writeV5GovernanceAudit(connection, {
    actorId, actorType: "system", actorRole: "workbench_operator",
    auditReason: "保留托管步骤当时的用户可见结果，供只读历史查阅",
    eventType: "hosted_step_result_archived", objectType: "hosted_promotion_order", objectId: snapshot.orderId,
    relatedSourceIds: [snapshot.sourceId], correlationId: hashV5GovernancePayload(snapshot.resultId), afterSummary: snapshot
  });
}
export async function listHostedResultSnapshots(orderId: string): Promise<HostedResultSnapshot[]> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT after_summary FROM governance_audit_event
     WHERE object_type = 'hosted_promotion_order' AND object_id = ? AND event_type = 'hosted_step_result_archived'
     ORDER BY created_at DESC, id DESC`, [orderId]);
  return rows.map(row => parseV5Json<HostedResultSnapshot | null>(row.after_summary, null))
    .filter((item): item is HostedResultSnapshot => Boolean(item && item.orderId === orderId && item.resultId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
