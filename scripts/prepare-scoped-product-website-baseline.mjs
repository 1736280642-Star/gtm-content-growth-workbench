import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const [productId] = process.argv.slice(2);
if (!productId) throw new Error("Usage: node scripts/prepare-scoped-product-website-baseline.mjs <productId>");

const [
  { getV5GovernancePool },
  { registerOfficialWebsiteSourcesAndEnsureAudits, readProductWebsiteCoverageProfile },
  { leaseNextSiteAuditRun, completeSiteAuditRun, failSiteAuditRun },
  { runSiteAudit }
] = await Promise.all([
  import("../src/lib/v5/knowledge-governance-repository.ts"),
  import("../src/lib/v5/website-coverage-repository.ts"),
  import("../src/lib/v5/site-audit-repository.ts"),
  import("../src/lib/v5/site-audit-runner.ts")
]);

const pool = getV5GovernancePool();
const workerId = `scoped-site-audit-${process.pid}-${randomUUID()}`;
const actor = {
  actorId: workerId,
  actorRole: "capture_runner",
  actorType: "runner",
  auditReason: "为指定产品建立启动 GEO 调研所需的官网基线"
};

try {
  const [rows] = await pool.query(
    `SELECT DISTINCT source.id AS source_id, revision.id AS source_revision_id,
            source.canonical_url, source.content_hash, source.authority_level
     FROM knowledge_base_product_link product_link
     JOIN knowledge_base_source_asset source_link ON source_link.knowledge_base_id = product_link.knowledge_base_id
     JOIN source_asset source ON source.id = source_link.source_id
     JOIN source_revision revision ON revision.source_id = source.id AND revision.content_hash = source.content_hash
     WHERE product_link.product_id = ? AND product_link.status = 'active'
       AND source.lifecycle_status = 'current' AND source.canonical_url IS NOT NULL
       AND source.canonical_url <> '' AND source.content_hash IS NOT NULL
     ORDER BY source.id`,
    [productId]
  );
  const candidates = rows.map((row) => ({
    productId,
    sourceId: String(row.source_id),
    sourceRevisionId: String(row.source_revision_id),
    canonicalUrl: String(row.canonical_url),
    contentHash: String(row.content_hash),
    authorityLevel: String(row.authority_level)
  }));
  const registered = await registerOfficialWebsiteSourcesAndEnsureAudits({ productId, candidates, actor });
  const auditResults = [];
  for (let index = 0; index < registered.auditRunIds.length; index += 1) {
    const run = await leaseNextSiteAuditRun({ workerId, leaseSeconds: 900 });
    if (!run || run.productId !== productId || !registered.auditRunIds.includes(run.id)) {
      throw new Error(`scoped_site_audit_lease_mismatch:${run?.id || "missing"}`);
    }
    try {
      const result = await runSiteAudit({ runId: run.id, scopeUrl: run.scopeUrl, sitemapUrl: run.sitemapUrl, scopeMode: run.scopeMode });
      auditResults.push(await completeSiteAuditRun({ run, result, workerId }));
    } catch (error) {
      await failSiteAuditRun({ runId: run.id, workerId, message: error instanceof Error ? error.message : "site_audit_failed" });
      throw error;
    }
  }
  const profile = await readProductWebsiteCoverageProfile(productId);
  console.log(JSON.stringify({
    status: "completed",
    productId,
    candidateCount: candidates.length,
    officialSourceCount: registered.officialSourceCount,
    auditResults,
    coverage: profile ? {
      profileVersion: profile.profileVersion,
      knowledgeReadiness: profile.knowledgeReadiness,
      publicGeoReadiness: profile.publicGeoReadiness,
      sufficientTopics: profile.topicCoverage.filter((item) => item.status === "sufficient").map((item) => item.topic),
      evidenceGapCount: profile.evidenceGaps.length
    } : null
  }));
} finally {
  await pool.end().catch(() => undefined);
}
