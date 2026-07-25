import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "../knowledge-governance-repository";
import { AUTOMATIC_KNOWLEDGE_POLICY_VERSION } from "./automatic-knowledge-production";

const AUTOMATIC_CONTENT_TYPES = [
  "explicit_product_intro",
  "explicit_launch_matrix",
  "implicit_personal_review",
  "implicit_painpoint_education",
  "implicit_tool_guide",
  "implicit_trend_judgment"
];
const AUTOMATIC_CHANNELS = ["wechat"];

function hashSorted(values: string[]) {
  return createHash("sha256").update([...new Set(values)].sort().join("\n")).digest("hex");
}

function stableId(prefix: string, value: string, length = 32) {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export interface AutomaticKnowledgeRefreshContext {
  productId: string;
  productName: string;
  rulePackageVersionId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  knowledgeBaseIds: string[];
  approvedSourceRevisionIds: string[];
  approvedClaimIds: string[];
  blockedClaimIds: string[];
  conflictIds: string[];
  readinessId: string;
  matrixScopeVersion: string;
  approvedAt: string;
  reboundTaskCount: number;
}

export async function prepareAutomaticKnowledgeRefreshRecord(
  productId: string,
  actor: V5GovernanceActor
): Promise<AutomaticKnowledgeRefreshContext> {
  return withV5GovernanceTransaction(async (connection) => {
    const [productRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, display_name, canonical_name FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [productId]
    );
    if (!productRows[0]) throw new V5GovernanceRepositoryError("product_not_found", "Automatic knowledge product is not active.", 404);

    const [claimRows] = await connection.query<RowDataPacket[]>(
      `SELECT pc.id, pc.normalized_claim, pc.original_quote, pc.source_id, pc.source_revision_id, pc.review_status,
              pc.support_mode, pc.conditions, pc.limitations, pc.authority_level, pc.source_locator,
              sr.content_hash, sr.source_updated_at, sa.batch_id, sa.primary_knowledge_base_id
       FROM product_claim pc
       JOIN source_revision sr ON sr.id = pc.source_revision_id
       JOIN source_asset sa ON sa.id = pc.source_id
       WHERE pc.product_id = ? AND pc.review_status IN ('supported','conditional')
         AND sr.parse_status = 'parsed'
         AND sa.status = 'approved_for_claim_extraction'
         AND sa.safety_status IN ('passed','restricted_approved')
         AND sr.id = (
           SELECT latest.id FROM source_revision latest
           WHERE latest.source_id = pc.source_id AND latest.parse_status = 'parsed'
           ORDER BY latest.revision_number DESC LIMIT 1
         )
       ORDER BY pc.id`,
      [productId]
    );
    if (!claimRows.length) {
      throw new V5GovernanceRepositoryError("approved_claim_missing", "No current supported claims are available for automatic refresh.", 409);
    }

    const [blockedRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, normalized_claim, review_status, conflict_group_id
       FROM product_claim
       WHERE product_id = ? AND (
         review_status IN ('disputed','rejected','expired')
         OR (review_status = 'superseded' AND conflict_group_id IS NOT NULL AND supersedes_claim_id IS NOT NULL)
       )
       ORDER BY id`,
      [productId]
    );
    const [conflictRows] = await connection.query<RowDataPacket[]>(
      `SELECT DISTINCT c.id
       FROM claim_conflict c
       JOIN claim_conflict_item i ON i.conflict_id = c.id
       JOIN product_claim pc ON pc.id = i.claim_id
       WHERE c.product_id = ? AND c.status = 'open' AND pc.review_status = 'disputed'
       ORDER BY c.id`,
      [productId]
    );

    const approvedClaimIds = claimRows.map((row) => String(row.id));
    const approvedSourceRevisionIds = [...new Set(claimRows.map((row) => String(row.source_revision_id)))].sort();
    const sourceIds = [...new Set(claimRows.map((row) => String(row.source_id)))].sort();
    const knowledgeBaseIds = [...new Set(claimRows.map((row) => String(row.primary_knowledge_base_id)))].sort();
    const sourceBatchIds = [...new Set(claimRows.map((row) => String(row.batch_id)))].sort();
    const blockedClaimIds = blockedRows.map((row) => String(row.id));
    const conflictIds = conflictRows.map((row) => String(row.id));
    const sourceSnapshotHash = hashSorted(claimRows.map((row) => `${row.source_id}:${row.source_revision_id}:${row.content_hash}`));
    const claimSetHash = hashSorted(approvedClaimIds);
    const proposedSourceSnapshotId = stableId("snapshot-auto-", `${productId}:${sourceSnapshotHash}`, 36);

    await connection.query(
      `INSERT INTO source_snapshot
        (id, product_id, snapshot_hash, source_ids, source_revision_ids, approved_claim_ids, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE approved_claim_ids = VALUES(approved_claim_ids)`,
      [proposedSourceSnapshotId, productId, sourceSnapshotHash, stringifyV5Json(sourceIds), stringifyV5Json(approvedSourceRevisionIds), stringifyV5Json(approvedClaimIds), actor.actorId]
    );
    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM source_snapshot WHERE product_id = ? AND snapshot_hash = ? LIMIT 1",
      [productId, sourceSnapshotHash]
    );
    const sourceSnapshotId = String(snapshotRows[0].id);
    for (const revisionId of approvedSourceRevisionIds) {
      const row = claimRows.find((claim) => String(claim.source_revision_id) === revisionId)!;
      await connection.query(
        `INSERT INTO source_snapshot_item (id, source_snapshot_id, source_id, source_revision_id, content_hash)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash)`,
        [stableId("snapshot-item-", `${sourceSnapshotId}:${revisionId}`, 36), sourceSnapshotId, String(row.source_id), revisionId, String(row.content_hash)]
      );
    }

    const rulePackageId = stableId("rule-package-auto-", productId, 32);
    await connection.query(
      `INSERT INTO product_expression_rule_package (id, product_id, status)
       VALUES (?, ?, 'active') ON DUPLICATE KEY UPDATE status = 'active'`,
      [rulePackageId, productId]
    );
    const [packageRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, active_version_id FROM product_expression_rule_package WHERE product_id = ? LIMIT 1 FOR UPDATE",
      [productId]
    );
    const storedRulePackageId = String(packageRows[0].id);
    const previousRuleVersionId = packageRows[0].active_version_id ? String(packageRows[0].active_version_id) : undefined;
    const rulePackageVersionId = stableId("rule-version-auto-", `${productId}:${sourceSnapshotHash}:${claimSetHash}`, 36);
    const [versionRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, status FROM rule_package_version WHERE id = ? LIMIT 1 FOR UPDATE",
      [rulePackageVersionId]
    );
    const productName = String(productRows[0].display_name || productRows[0].canonical_name || productId);
    const supportedExpressions = claimRows
      .filter((row) => String(row.review_status) === "supported")
      .map((row) => ({ claimId: String(row.id), text: String(row.normalized_claim) }));
    const conditionalExpressions = claimRows
      .filter((row) => String(row.review_status) === "conditional")
      .map((row) => ({
        claimId: String(row.id),
        text: String(row.normalized_claim),
        conditions: parseV5Json<string[]>(row.conditions, []),
        limitations: parseV5Json<string[]>(row.limitations, [])
      }));
    const blockedExpressions = blockedRows.map((row) => ({
      claimId: String(row.id),
      text: String(row.normalized_claim),
      reason: String(row.review_status),
      conflictGroupId: row.conflict_group_id ? String(row.conflict_group_id) : undefined
    }));
    const matrixScope = {
      allowedContentTypes: AUTOMATIC_CONTENT_TYPES,
      conditionalContentTypes: conditionalExpressions.length ? AUTOMATIC_CONTENT_TYPES : [],
      blockedContentTypes: [],
      allowedChannels: AUTOMATIC_CHANNELS,
      requiredEvidenceRoles: ["product_mechanism", "human_boundary", "official_citation"],
      maxMonthlyQuota: 31
    };

    if (previousRuleVersionId && previousRuleVersionId !== rulePackageVersionId) {
      await connection.query(
        "UPDATE rule_package_version SET status = 'superseded', superseded_at = NOW() WHERE id = ? AND status = 'active'",
        [previousRuleVersionId]
      );
    }
    if (!versionRows[0]) {
      await connection.query(
        `INSERT INTO rule_package_version
          (id, rule_package_id, product_id, version, status, pending_roles, based_on_version_id, source_batch_ids,
           linked_knowledge_base_ids, linked_source_ids, linked_claim_ids, product_identity, capabilities, allowed_expressions,
           conditional_expressions, blocked_expressions, evidence_requirements, channel_boundaries, official_citation_rules,
           evidence_gap_ids, conflict_refs, distilled_term_suggestions, question_suggestions, monthly_matrix_scope, change_set,
           claim_set_hash, source_snapshot_hash, created_by, approved_at, approved_by, activated_at, immutable_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
        [
          rulePackageVersionId,
          storedRulePackageId,
          productId,
          `auto-${sourceSnapshotHash.slice(0, 20)}`,
          stringifyV5Json([]),
          previousRuleVersionId || null,
          stringifyV5Json(sourceBatchIds),
          stringifyV5Json(knowledgeBaseIds),
          stringifyV5Json(sourceIds),
          stringifyV5Json(approvedClaimIds),
          stringifyV5Json({ productName, productCategory: "AI product service", productDefinition: "Claims governed by the automatic knowledge policy." }),
          stringifyV5Json([...supportedExpressions, ...conditionalExpressions]),
          stringifyV5Json(supportedExpressions),
          stringifyV5Json(conditionalExpressions),
          stringifyV5Json(blockedExpressions),
          stringifyV5Json({ factTraceRequired: true, verbatimQuoteRequired: true, conditionRequired: true }),
          stringifyV5Json({ allowedChannels: AUTOMATIC_CHANNELS }),
          stringifyV5Json({ verbatimQuote: true, locatorRequired: true }),
          stringifyV5Json([]),
          stringifyV5Json(conflictIds),
          stringifyV5Json([]),
          stringifyV5Json([]),
          stringifyV5Json(matrixScope),
          stringifyV5Json([{ type: "automatic_source_refresh", sourceSnapshotHash }]),
          claimSetHash,
          sourceSnapshotHash,
          actor.actorId,
          actor.actorId
        ]
      );
      for (const row of claimRows) {
        await connection.query(
          "INSERT INTO rule_package_claim (id, rule_package_version_id, claim_id, usage_type) VALUES (?, ?, ?, 'evidence')",
          [`rule-claim-${randomUUID()}`, rulePackageVersionId, String(row.id)]
        );
      }
      for (const revisionId of approvedSourceRevisionIds) {
        const row = claimRows.find((claim) => String(claim.source_revision_id) === revisionId)!;
        await connection.query(
          "INSERT INTO rule_package_source_revision (id, rule_package_version_id, source_revision_id, source_id) VALUES (?, ?, ?, ?)",
          [`rule-revision-${randomUUID()}`, rulePackageVersionId, revisionId, String(row.source_id)]
        );
      }
    } else if (String(versionRows[0].status) !== "active") {
      await connection.query(
        "UPDATE rule_package_version SET status = 'active', approved_at = COALESCE(approved_at, NOW()), approved_by = ?, activated_at = NOW(), immutable_at = COALESCE(immutable_at, NOW()) WHERE id = ?",
        [actor.actorId, rulePackageVersionId]
      );
    }
    await connection.query(
      "UPDATE product_expression_rule_package SET status = 'active', active_version_id = ? WHERE id = ?",
      [rulePackageVersionId, storedRulePackageId]
    );

    const proposedReadinessId = stableId("ready-auto-", rulePackageVersionId, 36);
    await connection.query(
      `INSERT INTO monthly_production_readiness
        (id, product_id, rule_package_version_id, source_snapshot_id, source_snapshot_hash, monthly_production_ready,
         allowed_content_types, conditional_content_types, blocked_content_types, allowed_channels, required_evidence_roles,
         evidence_gap_ids, max_monthly_quota, reason_codes, status, evaluated_at, evaluator_version, approved_at, approved_by, version)
       VALUES (?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?, 31, ?, 'approved', NOW(), ?, NOW(), ?, 1)
       ON DUPLICATE KEY UPDATE source_snapshot_id = VALUES(source_snapshot_id), source_snapshot_hash = VALUES(source_snapshot_hash),
         monthly_production_ready = TRUE, allowed_content_types = VALUES(allowed_content_types),
         conditional_content_types = VALUES(conditional_content_types), blocked_content_types = VALUES(blocked_content_types),
         allowed_channels = VALUES(allowed_channels), required_evidence_roles = VALUES(required_evidence_roles),
         evidence_gap_ids = VALUES(evidence_gap_ids), max_monthly_quota = VALUES(max_monthly_quota), reason_codes = VALUES(reason_codes),
         status = 'approved', evaluated_at = NOW(), evaluator_version = VALUES(evaluator_version), approved_at = NOW(),
         approved_by = VALUES(approved_by), version = version + 1`,
      [
        proposedReadinessId,
        productId,
        rulePackageVersionId,
        sourceSnapshotId,
        sourceSnapshotHash,
        stringifyV5Json(AUTOMATIC_CONTENT_TYPES),
        stringifyV5Json(conditionalExpressions.length ? AUTOMATIC_CONTENT_TYPES : []),
        stringifyV5Json([]),
        stringifyV5Json(AUTOMATIC_CHANNELS),
        stringifyV5Json(matrixScope.requiredEvidenceRoles),
        stringifyV5Json([]),
        stringifyV5Json(conditionalExpressions.length ? ["conditional_claims_require_limitations"] : []),
        AUTOMATIC_KNOWLEDGE_POLICY_VERSION,
        actor.actorId
      ]
    );
    const [readinessRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM monthly_production_readiness WHERE product_id = ? AND rule_package_version_id = ? LIMIT 1",
      [productId, rulePackageVersionId]
    );
    const readinessId = String(readinessRows[0].id);

    const [rebound] = await connection.query(
      `UPDATE content_matrix_item
       SET rule_package_version_id = ?, final_evidence_pack_id = NULL, evidence_gate_status = 'pending_config',
           status = 'approved', version = version + 1
       WHERE product_id = ? AND (rule_package_version_id IS NULL OR rule_package_version_id <> ?)
         AND status IN ('approved','ready_for_generation','evidence_gap','exception')`,
      [rulePackageVersionId, productId, rulePackageVersionId]
    );
    const reboundTaskCount = "affectedRows" in rebound ? Number(rebound.affectedRows) : 0;
    const approvedAt = claimRows.map((row) => iso(row.source_updated_at)).sort().at(-1)!;
    const matrixScopeVersion = `auto-${hashSorted([JSON.stringify(matrixScope)]).slice(0, 20)}`;

    await writeV5GovernanceAudit(connection, {
      ...actor,
      eventType: "automatic_knowledge_refresh_prepared",
      objectType: "rule_package_version",
      objectId: rulePackageVersionId,
      relatedSourceIds: sourceIds,
      afterSummary: { sourceSnapshotId, sourceSnapshotHash, approvedClaimCount: approvedClaimIds.length, blockedClaimCount: blockedClaimIds.length, reboundTaskCount },
      correlationId: rulePackageVersionId
    });

    return {
      productId,
      productName,
      rulePackageVersionId,
      sourceSnapshotId,
      sourceSnapshotHash,
      knowledgeBaseIds,
      approvedSourceRevisionIds,
      approvedClaimIds,
      blockedClaimIds,
      conflictIds,
      readinessId,
      matrixScopeVersion,
      approvedAt,
      reboundTaskCount
    };
  });
}

export async function releaseAutomaticKnowledgeTasksRecord(input: {
  productId: string;
  rulePackageVersionId: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [result] = await connection.query(
      `UPDATE content_matrix_item
       SET status = 'ready_for_generation', version = version + 1
       WHERE product_id = ? AND rule_package_version_id = ? AND final_evidence_pack_id IS NULL
         AND status = 'approved'`,
      [input.productId, input.rulePackageVersionId]
    );
    const releasedTaskCount = "affectedRows" in result ? Number(result.affectedRows) : 0;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "automatic_knowledge_tasks_released",
      objectType: "rule_package_version",
      objectId: input.rulePackageVersionId,
      afterSummary: { productId: input.productId, releasedTaskCount },
      correlationId: input.rulePackageVersionId
    });
    return { releasedTaskCount };
  });
}
