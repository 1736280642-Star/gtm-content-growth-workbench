import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { SiteAuditDiff, SiteAuditFinding, SiteAuditRun, SiteAuditWorkspace, SiteRemediationTask } from "./site-audit-contracts";
import type { V5MutationActor } from "./observation-contracts";
import { getV5GovernancePool, hashV5GovernancePayload, parseV5Json, stringifyV5Json, V5GovernanceRepositoryError, withV5GovernanceTransaction, writeV5GovernanceAudit } from "./knowledge-governance-repository";
import { SITE_AUDIT_EXECUTOR_VERSION, SITE_AUDIT_RULESET_VERSION, type SiteAuditRunnerResult } from "./site-audit-runner";

const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : undefined;
export function toMysqlDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new V5GovernanceRepositoryError("invalid_site_audit_datetime", "官网审计产生了无效时间，已阻止写入。", 500);
  return date.toISOString().slice(0, 19).replace("T", " ");
}
const actor = (input: { actor: V5MutationActor; reason: string }) => ({ actorId: input.actor.actorId, actorRole: input.actor.actorRole, actorType: input.actor.actorType === "runner" ? "system" as const : input.actor.actorType, auditReason: input.reason });

function mapRun(row: RowDataPacket): SiteAuditRun {
  return {
    id: String(row.id), version: Number(row.version), productId: row.product_id ? String(row.product_id) : undefined,
    scopeUrl: String(row.scope_url), sitemapUrl: row.sitemap_url ? String(row.sitemap_url) : undefined,
    scopeMode: String(row.scope_mode || "site") as SiteAuditRun["scopeMode"],
    status: String(row.status) as SiteAuditRun["status"], auditedUrlCount: Number(row.audited_url_count), failedUrlCount: Number(row.failed_url_count),
    coreReadinessScore: row.core_readiness_score === null ? undefined : Number(row.core_readiness_score),
    technicalReadinessScore: row.technical_readiness_score === null || row.technical_readiness_score === undefined ? undefined : Number(row.technical_readiness_score),
    contentCitabilityScore: row.content_citability_score === null || row.content_citability_score === undefined ? undefined : Number(row.content_citability_score),
    platformComplianceScore: row.platform_compliance_score === null || row.platform_compliance_score === undefined ? undefined : Number(row.platform_compliance_score),
    startedAt: iso(row.started_at), completedAt: iso(row.completed_at), executorVersion: row.executor_version ? String(row.executor_version) : undefined,
    rulesetVersion: String(row.ruleset_version), failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
    source: String(row.source) as SiteAuditRun["source"], createdAt: iso(row.created_at)!, createdBy: String(row.created_by)
  };
}

function mapFinding(row: RowDataPacket): SiteAuditFinding {
  return {
    id: String(row.id), runId: String(row.run_id), version: Number(row.version), url: String(row.url), category: String(row.category) as SiteAuditFinding["category"],
    severity: String(row.severity) as SiteAuditFinding["severity"], code: String(row.code), title: String(row.title), detectionEvidence: String(row.detection_evidence),
    evidenceSource: "page_audit_deterministic", userImpact: String(row.user_impact), recommendedRemediation: String(row.recommended_remediation),
    remediationGuidance: parseV5Json<SiteAuditFinding["remediationGuidance"]>(row.remediation_guidance, undefined),
    claimIds: parseV5Json<string[]>(row.claim_ids, []), publishedContentIds: parseV5Json<string[]>(row.published_content_ids, []),
    status: String(row.status) as SiteAuditFinding["status"], firstSeenAt: iso(row.first_seen_at)!, lastSeenAt: iso(row.last_seen_at)!
  };
}

function mapRemediation(row: RowDataPacket): SiteRemediationTask {
  return { id: String(row.id), findingId: String(row.finding_id), version: Number(row.version), assignee: row.assignee ? String(row.assignee) : undefined,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : undefined, note: String(row.note), status: String(row.status) as SiteRemediationTask["status"],
    createdAt: iso(row.created_at)!, createdBy: String(row.created_by) };
}

function mapDiff(row: RowDataPacket): SiteAuditDiff {
  return { id: String(row.id), baselineRunId: String(row.baseline_run_id), comparisonRunId: String(row.comparison_run_id),
    newFindingIds: parseV5Json<string[]>(row.new_finding_ids, []), persistentFindingIds: parseV5Json<string[]>(row.persistent_finding_ids, []),
    resolvedFindingIds: parseV5Json<string[]>(row.resolved_finding_ids, []), recurringFindingIds: parseV5Json<string[]>(row.recurring_finding_ids, []), createdAt: iso(row.created_at)! };
}

export async function resolveFormalSiteAuditProductId(scopeUrl: string, requestedProductId?: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT id, official_url FROM product_entity WHERE status = 'active' AND official_url IS NOT NULL"
  );
  if (requestedProductId) {
    if (!rows.some((row) => String(row.id) === requestedProductId)) throw new V5GovernanceRepositoryError("site_audit_product_not_found", "关联产品不存在、未启用或没有正式官网。", 422);
    return requestedProductId;
  }
  const scopeHost = new URL(scopeUrl).hostname.toLowerCase().replace(/^www\./, "");
  const matched = rows.find((row) => {
    try { return new URL(String(row.official_url)).hostname.toLowerCase().replace(/^www\./, "") === scopeHost; }
    catch { return false; }
  });
  return matched ? String(matched.id) : undefined;
}

export async function readFormalSiteAuditWorkspace(): Promise<SiteAuditWorkspace> {
  const pool = getV5GovernancePool();
  const [[runs], [findings], [remediations], [diffs]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run ORDER BY created_at DESC LIMIT 50"),
    pool.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding ORDER BY last_seen_at DESC LIMIT 1000"),
    pool.query<RowDataPacket[]>("SELECT * FROM geo_site_remediation_task ORDER BY created_at DESC LIMIT 500"),
    pool.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_diff ORDER BY created_at DESC LIMIT 50")
  ]);
  const mappedRuns = runs.map(mapRun);
  const latest = mappedRuns.find((item) => item.status === "completed");
  let experimentalSignals: SiteAuditWorkspace["experimentalSignals"] = [];
  if (latest) {
    const [pageRows] = await pool.query<RowDataPacket[]>("SELECT evidence FROM geo_site_audit_page WHERE run_id = ? ORDER BY fetched_at DESC LIMIT 1", [latest.id]);
    const evidence = parseV5Json<Record<string, unknown>>(pageRows[0]?.evidence, {});
    experimentalSignals = Array.isArray(evidence.experimentalSignals)
      ? evidence.experimentalSignals.filter((item): item is SiteAuditWorkspace["experimentalSignals"][number] => Boolean(item) && typeof item === "object" && ["present", "missing", "unknown"].includes(String((item as Record<string, unknown>).status)))
      : [];
  }
  return { source: mappedRuns.length ? "formal_database" : "empty", runs: mappedRuns, findings: findings.map(mapFinding), remediationTasks: remediations.map(mapRemediation), diffs: diffs.map(mapDiff), score: latest?.coreReadinessScore ?? null, experimentalSignals };
}

export async function createFormalSiteAuditRun(input: {
  productId?: string; scopeUrl: string; sitemapUrl?: string; scopeMode?: "single_page" | "site"; idempotencyKey: string;
  actor: V5MutationActor; reason: string;
}) {
  const requestHash = hashV5GovernancePayload({ productId: input.productId, scopeUrl: input.scopeUrl, sitemapUrl: input.sitemapUrl, scopeMode: input.scopeMode || "site" });
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE idempotency_key = ? FOR UPDATE", [input.idempotencyKey]);
    if (existing[0]) {
      if (String(existing[0].request_hash) !== requestHash) throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同的官网审计请求。", 409);
      return mapRun(existing[0]);
    }
    const id = `site-audit-run-${randomUUID()}`;
    await connection.query(
      `INSERT INTO geo_site_audit_run
       (id, product_id, scope_url, sitemap_url, scope_mode, status, source, ruleset_version, idempotency_key, request_hash, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 'site_audit_runner', ?, ?, ?, 1, ?, NOW())`,
      [id, input.productId || null, input.scopeUrl, input.sitemapUrl || null, input.scopeMode || "site", SITE_AUDIT_RULESET_VERSION, input.idempotencyKey, requestHash, input.actor.actorId]
    );
    await writeV5GovernanceAudit(connection, { ...actor(input), eventType: "geo_site_audit_queued", objectType: "geo_site_audit_run", objectId: id, relatedSourceIds: [input.scopeUrl], afterSummary: { status: "queued", rulesetVersion: SITE_AUDIT_RULESET_VERSION }, correlationId: id });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id = ?", [id]);
    return mapRun(saved[0]);
  });
}

export async function leaseNextSiteAuditRun(input: { workerId: string; leaseSeconds: number }) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM geo_site_audit_run WHERE status = 'queued' OR (status = 'running' AND lease_expires_at < NOW())
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!rows[0]) return undefined;
    await connection.query("UPDATE geo_site_audit_run SET status = 'running', lease_owner = ?, lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), started_at = COALESCE(started_at, NOW()), version = version + 1 WHERE id = ?", [input.workerId, input.leaseSeconds, rows[0].id]);
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id = ?", [rows[0].id]);
    return mapRun(saved[0]);
  });
}

export async function completeSiteAuditRun(input: { run: SiteAuditRun; result: SiteAuditRunnerResult; workerId: string }) {
  const completed = await withV5GovernanceTransaction(async (connection) => {
    const [locked] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id = ? FOR UPDATE", [input.run.id]);
    if (!locked[0] || String(locked[0].lease_owner) !== input.workerId || String(locked[0].status) !== "running") throw new V5GovernanceRepositoryError("site_audit_lease_lost", "官网审计任务租约已失效。", 409);
    for (const page of input.result.pages) await connection.query(
      `INSERT INTO geo_site_audit_page (id, run_id, requested_url, final_url, http_status, render_mode, content_hash, evidence, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash), evidence = VALUES(evidence), fetched_at = VALUES(fetched_at)`,
      [page.id, page.runId, page.requestedUrl, page.finalUrl, page.httpStatus, page.renderMode, page.contentHash, stringifyV5Json({ ...page.evidence, experimentalSignals: input.result.experimentalSignals }), toMysqlDateTime(page.fetchedAt)]
    );
    const now = toMysqlDateTime(new Date());
    for (const item of input.result.findings) await connection.query(
      `INSERT INTO geo_site_audit_finding
       (id, run_id, url, category, severity, code, title, detection_evidence, evidence_source, user_impact, recommended_remediation, remediation_guidance, claim_ids, published_content_ids, status, version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [item.id, input.run.id, item.url, item.category, item.severity, item.code, item.title, item.detectionEvidence, item.evidenceSource, item.userImpact, item.recommendedRemediation, item.remediationGuidance ? stringifyV5Json(item.remediationGuidance) : null, stringifyV5Json(item.claimIds), stringifyV5Json(item.publishedContentIds), item.status, now, now]
    );
    const [baselineRows] = await connection.query<RowDataPacket[]>("SELECT id FROM geo_site_audit_run WHERE scope_url = ? AND status = 'completed' AND id <> ? ORDER BY completed_at DESC LIMIT 1", [input.run.scopeUrl, input.run.id]);
    if (baselineRows[0]) {
      const baselineId = String(baselineRows[0].id);
      const [baselineFindings] = await connection.query<RowDataPacket[]>("SELECT id, url, code FROM geo_site_audit_finding WHERE run_id = ?", [baselineId]);
      const [olderFindings] = await connection.query<RowDataPacket[]>(
        `SELECT f.url, f.code FROM geo_site_audit_finding f
         JOIN geo_site_audit_run r ON r.id = f.run_id
         WHERE r.scope_url = ? AND r.status = 'completed' AND r.id <> ?`,
        [input.run.scopeUrl, baselineId]
      );
      const before = new Map(baselineFindings.map((row) => [`${row.url}:${row.code}`, String(row.id)]));
      const after = new Map(input.result.findings.map((item) => [`${item.url}:${item.code}`, item.id]));
      const seenBeforeBaseline = new Set(olderFindings.map((row) => `${row.url}:${row.code}`));
      const persistent = [...after.keys()].filter((key) => before.has(key));
      const recurring = [...after.keys()].filter((key) => !before.has(key) && seenBeforeBaseline.has(key));
      const diff: SiteAuditDiff = { id: `site-audit-diff-${randomUUID()}`, baselineRunId: baselineId, comparisonRunId: input.run.id,
        newFindingIds: [...after.entries()].filter(([key]) => !before.has(key) && !seenBeforeBaseline.has(key)).map(([, id]) => id), persistentFindingIds: persistent.map((key) => after.get(key)!),
        resolvedFindingIds: [...before.entries()].filter(([key]) => !after.has(key)).map(([, id]) => id), recurringFindingIds: recurring.map((key) => after.get(key)!), createdAt: now };
      await connection.query("INSERT INTO geo_site_audit_diff (id, baseline_run_id, comparison_run_id, new_finding_ids, persistent_finding_ids, resolved_finding_ids, recurring_finding_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [diff.id, diff.baselineRunId, diff.comparisonRunId, stringifyV5Json(diff.newFindingIds), stringifyV5Json(diff.persistentFindingIds), stringifyV5Json(diff.resolvedFindingIds), stringifyV5Json(diff.recurringFindingIds), toMysqlDateTime(diff.createdAt)]);
    }
    await connection.query(
      `UPDATE geo_site_audit_run SET status = 'completed', audited_url_count = ?, failed_url_count = ?, core_readiness_score = ?, technical_readiness_score = ?, content_citability_score = ?, platform_compliance_score = ?, sitemap_url = COALESCE(sitemap_url, ?), executor_version = ?, failure_reason = NULL, completed_at = NOW(), lease_owner = NULL, lease_expires_at = NULL, version = version + 1 WHERE id = ?`,
      [input.result.pages.length, input.result.failedUrlCount, input.result.coreReadinessScore, input.result.technicalReadinessScore, input.result.contentCitabilityScore, input.result.platformComplianceScore, input.result.discoveredSitemapUrl || null, SITE_AUDIT_EXECUTOR_VERSION, input.run.id]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: input.workerId, actorRole: "system", actorType: "system", auditReason: "官网审计 Runner 完成确定性规则执行",
      eventType: "geo_site_audit_completed", objectType: "geo_site_audit_run", objectId: input.run.id,
      relatedSourceIds: input.result.pages.map((item) => item.finalUrl),
      beforeSummary: { status: "running", version: input.run.version },
      afterSummary: { status: "completed", score: input.result.coreReadinessScore, scoreBreakdown: { technical: input.result.technicalReadinessScore, content: input.result.contentCitabilityScore, compliance: input.result.platformComplianceScore }, auditedUrlCount: input.result.pages.length, findingCount: input.result.findings.length },
      correlationId: input.run.id
    });
    return { runId: input.run.id, auditedUrlCount: input.result.pages.length, findingCount: input.result.findings.length, score: input.result.coreReadinessScore };
  });
  if (input.run.productId) {
    const { markWebsiteAuditCompleted } = await import("./website-coverage-repository");
    await markWebsiteAuditCompleted(input.run.productId, input.run.id);
  }
  return completed;
}

export async function failSiteAuditRun(input: { runId: string; workerId: string; message: string }) {
  const productId = await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id = ? FOR UPDATE", [input.runId]);
    if (!rows[0] || String(rows[0].lease_owner) !== input.workerId) return undefined;
    await connection.query("UPDATE geo_site_audit_run SET status = 'failed', failure_reason = ?, completed_at = NOW(), lease_owner = NULL, lease_expires_at = NULL, version = version + 1 WHERE id = ?", [input.message.slice(0, 2000), input.runId]);
    await writeV5GovernanceAudit(connection, {
      actorId: input.workerId, actorRole: "system", actorType: "system", auditReason: "官网审计 Runner 执行失败",
      eventType: "geo_site_audit_failed", objectType: "geo_site_audit_run", objectId: input.runId,
      relatedSourceIds: [String(rows[0].scope_url)], beforeSummary: { status: rows[0].status }, afterSummary: { status: "failed", failureReason: input.message.slice(0, 500) }, correlationId: input.runId
    });
    return rows[0].product_id ? String(rows[0].product_id) : undefined;
  });
  if (productId) {
    const { markWebsiteAuditFailed } = await import("./website-coverage-repository");
    await markWebsiteAuditFailed(productId, input.runId, input.message);
  }
}

export async function createFormalSiteRemediation(findingId: string, input: { assignee?: string; dueDate?: string; note: string; expectedVersion: number; actor: V5MutationActor; reason: string }) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding WHERE id = ? FOR UPDATE", [findingId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("site_audit_finding_not_found", "官网审计问题不存在。", 404);
    if (Number(rows[0].version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("site_audit_finding_version_conflict", "官网审计问题已经更新，请刷新后重试。", 409);
    const id = `site-remediation-${randomUUID()}`;
    await connection.query("INSERT INTO geo_site_remediation_task (id, finding_id, assignee, due_date, note, status, version, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', 1, ?, NOW())", [id, findingId, input.assignee || null, input.dueDate || null, input.note, input.actor.actorId]);
    await connection.query("UPDATE geo_site_audit_finding SET status = 'remediation_created', version = version + 1 WHERE id = ?", [findingId]);
    await writeV5GovernanceAudit(connection, { ...actor(input), eventType: "geo_site_remediation_created", objectType: "geo_site_remediation_task", objectId: id, relatedSourceIds: [findingId, String(rows[0].url)], beforeSummary: { findingStatus: rows[0].status }, afterSummary: { findingStatus: "remediation_created", assignee: input.assignee || null, dueDate: input.dueDate || null }, correlationId: String(rows[0].run_id) });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_remediation_task WHERE id = ?", [id]);
    return mapRemediation(saved[0]);
  });
}

export async function reviewFormalSiteAuditFinding(findingId: string, input: { decision: "resolved" | "ignored"; note: string; expectedVersion: number; actor: V5MutationActor; reason: string }) {
  const finding = await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding WHERE id = ? FOR UPDATE", [findingId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("site_audit_finding_not_found", "官网审计问题不存在。", 404);
    if (Number(rows[0].version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("site_audit_finding_version_conflict", "官网审计问题已经更新，请刷新后重试。", 409);
    await connection.query("UPDATE geo_site_audit_finding SET status = ?, version = version + 1, last_seen_at = NOW() WHERE id = ?", [input.decision, findingId]);
    await writeV5GovernanceAudit(connection, { ...actor(input), eventType: "geo_site_audit_finding_reviewed", objectType: "geo_site_audit_finding", objectId: findingId, relatedSourceIds: [String(rows[0].url)], beforeSummary: { status: rows[0].status, version: rows[0].version }, afterSummary: { status: input.decision, note: input.note }, correlationId: String(rows[0].run_id) });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding WHERE id = ?", [findingId]);
    return mapFinding(saved[0]);
  });
  const [runs] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT product_id FROM geo_site_audit_run WHERE id = ? LIMIT 1", [finding.runId]);
  if (runs[0]?.product_id) {
    const { rebuildProductWebsiteCoverageProfile } = await import("./website-coverage-repository");
    await rebuildProductWebsiteCoverageProfile(String(runs[0].product_id));
  }
  return finding;
}
