import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  type V5GovernanceActor
} from "./knowledge-governance-repository";
import { createFormalSiteAuditRun } from "./site-audit-repository";
import { SITE_AUDIT_RULESET_VERSION } from "./site-audit-runner";
import type {
  OfficialWebsiteImportCandidate,
  ProductWebsiteCoverageProfile,
  ProductWebsiteSourceStatus,
  WebsiteCoverageTopic,
  WebsitePublicGeoReadiness,
  WebsiteTopicCoverage
} from "./website-coverage-contracts";

const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : undefined;

function stableId(prefix: string, value: string, length = 40) {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function normalizedHost(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function mapSourceStatus(row: RowDataPacket): ProductWebsiteSourceStatus {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    sourceId: String(row.source_id),
    sourceRevisionId: String(row.source_revision_id),
    canonicalUrl: String(row.canonical_url),
    contentHash: String(row.content_hash),
    ownershipStatus: String(row.ownership_status) as ProductWebsiteSourceStatus["ownershipStatus"],
    knowledgeReadiness: String(row.knowledge_readiness) as ProductWebsiteSourceStatus["knowledgeReadiness"],
    publicGeoReadiness: String(row.public_geo_readiness) as ProductWebsiteSourceStatus["publicGeoReadiness"],
    siteAuditRunId: row.site_audit_run_id ? String(row.site_audit_run_id) : undefined,
    auditRulesetVersion: row.audit_ruleset_version ? String(row.audit_ruleset_version) : undefined,
    lastAuditedAt: iso(row.last_audited_at),
    lastError: row.last_error ? String(row.last_error) : undefined
  };
}

const TOPIC_RULES: Array<{ topic: WebsiteCoverageTopic; label: string; keywords: RegExp[]; evidenceRequired: boolean }> = [
  { topic: "core_service", label: "核心产品与服务页", keywords: [/产品|服务|解决方案/i, /能力|功能|场景|价值/i], evidenceRequired: false },
  { topic: "provider_selection", label: "服务商选择依据", keywords: [/服务商|实施伙伴|合作伙伴/i, /资质|认证|选型|选择|交付范围/i], evidenceRequired: true },
  { topic: "capability_boundary", label: "服务能力与边界", keywords: [/能力|服务范围|职责|分工/i, /边界|适用|不适用|限制|条件/i], evidenceRequired: true },
  { topic: "implementation_delivery", label: "实施与交付说明", keywords: [/实施|部署|接入|集成/i, /交付|验收|培训|运营|支持/i], evidenceRequired: true },
  { topic: "case_practice", label: "案例或实践证据", keywords: [/案例|客户|实践|项目/i, /结果|效果|验收|上线|交付/i], evidenceRequired: true },
  { topic: "faq", label: "FAQ 与常见问题", keywords: [/FAQ|常见问题|问答|Q&A/i, /如何|为什么|哪些|是否|怎么/i], evidenceRequired: false }
];

function resolvePublicReadiness(run: RowDataPacket | undefined, findings: RowDataPacket[]): WebsitePublicGeoReadiness {
  if (!run) return "pending_audit";
  if (String(run.status) === "failed") return "blocked";
  if (String(run.status) !== "completed") return "pending_audit";
  const open = findings.filter((item) => !["resolved", "ignored"].includes(String(item.status)));
  const blockerCodes = new Set(["page_fetch_failed", "citation_bots_blocked", "page_noindex", "javascript_rendering_unverified"]);
  if (open.some((item) => String(item.severity) === "critical" || blockerCodes.has(String(item.code)))) return "blocked";
  if (open.some((item) => String(item.severity) === "high") || Number(run.core_readiness_score || 0) < 70) return "partial";
  return "ready";
}

function compileTopicCoverage(rows: RowDataPacket[]): WebsiteTopicCoverage[] {
  return TOPIC_RULES.map((rule) => {
    const matches = rows.flatMap((row) => {
      const text = `${String(row.title || "")}\n${String(row.normalized_text || "")}`;
      const hitCount = rule.keywords.filter((pattern) => pattern.test(text)).length;
      return hitCount ? [{ row, hitCount, length: text.length }] : [];
    });
    const sourceIds = [...new Set(matches.map((item) => String(item.row.source_id)))];
    const pageUrls = [...new Set(matches.map((item) => String(item.row.canonical_url)).filter(Boolean))];
    const claimIds = [...new Set(matches.flatMap((item) => parseV5Json<unknown[]>(item.row.claim_ids, [])
      .filter((claimId): claimId is string => typeof claimId === "string" && claimId.length > 0)))];
    const strong = matches.some((item) => item.hitCount >= 2 && item.length >= 500);
    const caseEvidenceReady = rule.topic !== "case_practice" || claimIds.length > 0;
    const status = strong && caseEvidenceReady ? "sufficient" as const : matches.length ? "partial" as const : "missing" as const;
    return {
      topic: rule.topic,
      label: rule.label,
      status,
      pageUrls,
      sourceIds,
      claimIds,
      evidenceRequired: rule.evidenceRequired,
      reason: status === "sufficient"
        ? "官网正文已覆盖该主题，并存在可追溯来源。"
        : status === "partial"
          ? rule.topic === "case_practice" && !claimIds.length
            ? "官网出现案例或实践信号，但尚无已治理 Claim 支撑具体客户、过程或结果。"
            : "官网仅部分覆盖该主题，尚不足以独立回答对应问题。"
          : "已登记的正式官网页面尚未覆盖该主题。"
    };
  });
}

async function readLatestSourceSnapshotId(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT id FROM source_snapshot WHERE product_id = ? ORDER BY created_at DESC LIMIT 1",
    [productId]
  );
  return rows[0]?.id ? String(rows[0].id) : undefined;
}

export async function readProductWebsiteCoverageProfile(productId: string): Promise<ProductWebsiteCoverageProfile | undefined> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM product_website_coverage_profile WHERE product_id = ? LIMIT 1",
    [productId]
  );
  return rows[0] ? parseV5Json<ProductWebsiteCoverageProfile | undefined>(rows[0].profile_json, undefined) : undefined;
}

export async function listProductWebsiteCoverageProfiles(): Promise<ProductWebsiteCoverageProfile[]> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT profile_json FROM product_website_coverage_profile ORDER BY generated_at DESC"
  );
  return rows.flatMap((row) => {
    const profile = parseV5Json<ProductWebsiteCoverageProfile | undefined>(row.profile_json, undefined);
    return profile ? [profile] : [];
  });
}

export async function rebuildProductWebsiteCoverageProfile(productId: string): Promise<ProductWebsiteCoverageProfile> {
  const pool = getV5GovernancePool();
  const [[sourceRows], [contentRows], sourceSnapshotId] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT ws.* FROM product_website_source_status ws
       JOIN source_asset s ON s.id = ws.source_id AND s.content_hash = ws.content_hash
       WHERE ws.product_id = ? AND ws.ownership_status = 'official' ORDER BY ws.updated_at DESC`,
      [productId]
    ),
    pool.query<RowDataPacket[]>(
      `SELECT s.id AS source_id, s.title, s.canonical_url, c.normalized_text,
              COALESCE(JSON_ARRAYAGG(CASE WHEN pc.review_status IN ('supported','conditional') THEN pc.id END), JSON_ARRAY()) AS claim_ids
       FROM source_asset s
       JOIN product_website_source_status ws ON ws.source_id = s.id AND ws.product_id = ? AND ws.ownership_status = 'official' AND s.content_hash = ws.content_hash
       JOIN source_revision_content c ON c.source_revision_id = ws.source_revision_id
       LEFT JOIN product_claim pc ON pc.source_id = s.id AND pc.source_revision_id = ws.source_revision_id
       GROUP BY s.id, s.title, s.canonical_url, c.normalized_text`,
      [productId]
    ),
    readLatestSourceSnapshotId(productId)
  ]);
  const auditRunIds = [...new Set(sourceRows.map((row) => row.site_audit_run_id ? String(row.site_audit_run_id) : "").filter(Boolean))];
  let runRows: RowDataPacket[] = [];
  let findingRows: RowDataPacket[] = [];
  if (auditRunIds.length) {
    const [runResult, findingResult] = await Promise.all([
      pool.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id IN (?) ORDER BY created_at DESC", [auditRunIds]),
      pool.query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding WHERE run_id IN (?)", [auditRunIds])
    ]);
    runRows = runResult[0];
    findingRows = findingResult[0];
  }
  const runById = new Map(runRows.map((row) => [String(row.id), row]));
  const findingsByRun = new Map<string, RowDataPacket[]>();
  for (const finding of findingRows) {
    const runId = String(finding.run_id);
    const current = findingsByRun.get(runId) || [];
    current.push(finding);
    findingsByRun.set(runId, current);
  }
  const sourcePublicReadiness = sourceRows.map((row) => {
    const runId = row.site_audit_run_id ? String(row.site_audit_run_id) : "";
    return resolvePublicReadiness(runById.get(runId), findingsByRun.get(runId) || []);
  });
  const publicGeoReadiness: WebsitePublicGeoReadiness = !sourcePublicReadiness.length || sourcePublicReadiness.includes("pending_audit")
    ? "pending_audit"
    : sourcePublicReadiness.includes("blocked") ? "blocked"
      : sourcePublicReadiness.includes("partial") ? "partial" : "ready";
  const latestRun = runRows[0];
  const knowledgeReadiness = sourceRows.length && sourceRows.every((row) => String(row.knowledge_readiness) === "ready")
    ? "ready" as const
    : sourceRows.length ? "partial" as const : "blocked" as const;
  const officialSources = sourceRows.map((row) => {
    const runId = row.site_audit_run_id ? String(row.site_audit_run_id) : "";
    return { ...mapSourceStatus(row), publicGeoReadiness: resolvePublicReadiness(runById.get(runId), findingsByRun.get(runId) || []) };
  });
  const topicCoverage = compileTopicCoverage(contentRows);
  const criticalFindingCodes = [...new Set(findingRows
    .filter((row) => !["resolved", "ignored"].includes(String(row.status)) && ["critical", "high"].includes(String(row.severity)))
    .map((row) => String(row.code)))];
  const evidenceGaps = topicCoverage
    .filter((item) => item.status !== "sufficient")
    .map((item) => `${item.label}：${item.reason}`);
  const generatedAt = new Date().toISOString();
  const profileBody = {
    productId,
    sourceSnapshotId,
    latestSiteAuditRunId: latestRun?.id ? String(latestRun.id) : undefined,
    knowledgeReadiness,
    publicGeoReadiness,
    officialSources,
    topicCoverage,
    criticalFindingCodes,
    evidenceGaps
  };
  const profileHash = hashV5GovernancePayload(profileBody);
  return withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT * FROM product_website_coverage_profile WHERE product_id = ? FOR UPDATE", [productId]);
    const profileVersion = Number(existing[0]?.profile_version || 0) + (String(existing[0]?.profile_hash || "") === profileHash ? 0 : 1);
    const profile: ProductWebsiteCoverageProfile = {
      id: existing[0]?.id ? String(existing[0].id) : stableId("website-coverage-", productId, 32),
      profileVersion: Math.max(1, profileVersion),
      profileHash,
      generatedAt,
      ...profileBody
    };
    await connection.query(
      `INSERT INTO product_website_coverage_profile
       (id, product_id, profile_version, source_snapshot_id, latest_site_audit_run_id, profile_hash, profile_json, generated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE profile_version = VALUES(profile_version), source_snapshot_id = VALUES(source_snapshot_id),
         latest_site_audit_run_id = VALUES(latest_site_audit_run_id), profile_hash = VALUES(profile_hash),
         profile_json = VALUES(profile_json), generated_at = VALUES(generated_at)`,
      [profile.id, productId, profile.profileVersion, sourceSnapshotId || null, profile.latestSiteAuditRunId || null, profileHash, stringifyV5Json(profile), generatedAt.slice(0, 19).replace("T", " ")]
    );
    if (!existing[0] || String(existing[0].profile_hash) !== profileHash) {
      await writeV5GovernanceAudit(connection, {
        actorId: "website-coverage-compiler", actorRole: "system", actorType: "system", auditReason: "官网来源或审计结果变化后重建产品官网覆盖画像",
        eventType: "product_website_coverage_rebuilt", objectType: "product_website_coverage_profile", objectId: profile.id,
        relatedSourceIds: officialSources.map((item) => item.sourceRevisionId),
        beforeSummary: existing[0] ? { profileVersion: existing[0].profile_version, profileHash: existing[0].profile_hash } : undefined,
        afterSummary: { profileVersion: profile.profileVersion, profileHash, knowledgeReadiness, publicGeoReadiness, evidenceGapCount: evidenceGaps.length },
        correlationId: productId
      });
    }
    return profile;
  });
}

async function upsertWebsiteSource(connection: PoolConnection, candidate: OfficialWebsiteImportCandidate, officialHost: string) {
  const candidateHost = normalizedHost(candidate.canonicalUrl);
  const ownershipStatus = officialHost && (candidateHost === officialHost || candidateHost.endsWith(`.${officialHost}`)) ? "official" : "external";
  const knowledgeReadiness = candidate.authorityLevel === "A2" ? "ready" : "partial";
  const id = stableId("website-source-", `${candidate.productId}:${candidate.sourceId}:${candidate.sourceRevisionId}`, 36);
  await connection.query(
    `INSERT INTO product_website_source_status
     (id, product_id, source_id, source_revision_id, canonical_url, content_hash, ownership_status, knowledge_readiness,
      public_geo_readiness, audit_ruleset_version, row_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_audit', ?, 1, NOW())
     ON DUPLICATE KEY UPDATE canonical_url = VALUES(canonical_url), content_hash = VALUES(content_hash), ownership_status = VALUES(ownership_status),
       knowledge_readiness = VALUES(knowledge_readiness), audit_ruleset_version = VALUES(audit_ruleset_version), row_version = row_version + 1`,
    [id, candidate.productId, candidate.sourceId, candidate.sourceRevisionId, candidate.canonicalUrl, candidate.contentHash, ownershipStatus, knowledgeReadiness, SITE_AUDIT_RULESET_VERSION]
  );
  return { id, ownershipStatus };
}

export async function registerOfficialWebsiteSourcesAndEnsureAudits(input: {
  productId: string;
  candidates: OfficialWebsiteImportCandidate[];
  actor: V5GovernanceActor;
}) {
  if (!input.candidates.length) return { officialSourceCount: 0, auditRunIds: [] as string[] };
  const [products] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT official_url FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1", [input.productId]);
  const officialHost = normalizedHost(String(products[0]?.official_url || ""));
  const officialCandidates: OfficialWebsiteImportCandidate[] = [];
  await withV5GovernanceTransaction(async (connection) => {
    for (const candidate of input.candidates) {
      const saved = await upsertWebsiteSource(connection, candidate, officialHost);
      if (saved.ownershipStatus === "official") officialCandidates.push(candidate);
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "official_website_sources_registered", objectType: "product_website_source_status", objectId: input.productId,
      relatedSourceIds: input.candidates.map((item) => item.sourceRevisionId),
      afterSummary: { candidateCount: input.candidates.length, officialSourceCount: officialCandidates.length, auditRulesetVersion: SITE_AUDIT_RULESET_VERSION },
      correlationId: input.productId
    });
  });
  const auditRunIds: string[] = [];
  for (const candidate of officialCandidates) {
    const digest = hashV5GovernancePayload({ productId: input.productId, sourceRevisionId: candidate.sourceRevisionId, ruleset: SITE_AUDIT_RULESET_VERSION });
    const run = await createFormalSiteAuditRun({
      productId: input.productId,
      scopeUrl: candidate.canonicalUrl,
      scopeMode: "single_page",
      idempotencyKey: `auto-site-audit:${digest.slice(0, 96)}`,
      actor: { actorId: "website-source-import", actorRole: "capture_runner", actorType: "runner" },
      reason: "正式官网 URL 写入产品知识库后自动建立基线或增量审计"
    });
    auditRunIds.push(run.id);
    await getV5GovernancePool().query(
      `UPDATE product_website_source_status SET site_audit_run_id = ?, audit_ruleset_version = ?, public_geo_readiness = ?, last_error = NULL, row_version = row_version + 1
       WHERE product_id = ? AND source_id = ? AND source_revision_id = ?`,
      [run.id, SITE_AUDIT_RULESET_VERSION, run.status === "completed" ? "partial" : "pending_audit", input.productId, candidate.sourceId, candidate.sourceRevisionId]
    );
  }
  const profile = await rebuildProductWebsiteCoverageProfile(input.productId);
  return { officialSourceCount: officialCandidates.length, auditRunIds, profile };
}

export async function reconcileExistingOfficialWebsiteSources(actor: V5GovernanceActor) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT DISTINCT product_link.product_id, source.id AS source_id, revision.id AS source_revision_id,
            source.canonical_url, source.content_hash, source.authority_level
     FROM knowledge_base_product_link product_link
     JOIN knowledge_base_source_asset source_link ON source_link.knowledge_base_id = product_link.knowledge_base_id
     JOIN source_asset source ON source.id = source_link.source_id
     JOIN source_revision revision ON revision.source_id = source.id AND revision.content_hash = source.content_hash
     JOIN product_entity product ON product.id = product_link.product_id AND product.status = 'active'
     LEFT JOIN product_website_source_status website_source
       ON website_source.product_id = product_link.product_id
      AND website_source.source_id = source.id
      AND website_source.source_revision_id = revision.id
     LEFT JOIN product_website_coverage_profile website_profile ON website_profile.product_id = product_link.product_id
     WHERE product_link.status = 'active'
       AND source.lifecycle_status = 'current'
       AND source.canonical_url IS NOT NULL
       AND source.canonical_url <> ''
       AND source.content_hash IS NOT NULL
       AND (website_source.id IS NULL
         OR website_source.content_hash <> source.content_hash
         OR website_source.canonical_url <> source.canonical_url
         OR website_source.audit_ruleset_version IS NULL
         OR website_source.audit_ruleset_version <> ?
         OR website_profile.id IS NULL)
     ORDER BY product_link.product_id, source.id`,
    [SITE_AUDIT_RULESET_VERSION]
  );
  const candidatesByProduct = new Map<string, OfficialWebsiteImportCandidate[]>();
  for (const row of rows) {
    const productId = String(row.product_id);
    const candidates = candidatesByProduct.get(productId) || [];
    candidates.push({
      productId,
      sourceId: String(row.source_id),
      sourceRevisionId: String(row.source_revision_id),
      canonicalUrl: String(row.canonical_url),
      contentHash: String(row.content_hash),
      authorityLevel: String(row.authority_level) as OfficialWebsiteImportCandidate["authorityLevel"]
    });
    candidatesByProduct.set(productId, candidates);
  }
  const products: Array<{ productId: string; officialSourceCount: number; auditRunIds: string[] }> = [];
  for (const [productId, candidates] of candidatesByProduct) {
    const result = await registerOfficialWebsiteSourcesAndEnsureAudits({ productId, candidates, actor });
    products.push({ productId, officialSourceCount: result.officialSourceCount, auditRunIds: result.auditRunIds });
  }
  return {
    scannedProductCount: candidatesByProduct.size,
    officialSourceCount: products.reduce((sum, item) => sum + item.officialSourceCount, 0),
    queuedAuditRunIds: [...new Set(products.flatMap((item) => item.auditRunIds))],
    products
  };
}

export async function markWebsiteAuditCompleted(productId: string, runId: string) {
  const [runs] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM geo_site_audit_run WHERE id = ? AND product_id = ? LIMIT 1", [runId, productId]);
  if (!runs[0]) return undefined;
  const [findings] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM geo_site_audit_finding WHERE run_id = ?", [runId]);
  const readiness = resolvePublicReadiness(runs[0], findings);
  await getV5GovernancePool().query(
    `UPDATE product_website_source_status SET public_geo_readiness = ?, last_audited_at = ?, last_error = NULL, row_version = row_version + 1
     WHERE product_id = ? AND site_audit_run_id = ?`,
    [readiness, runs[0].completed_at || new Date(), productId, runId]
  );
  return rebuildProductWebsiteCoverageProfile(productId);
}

export async function markWebsiteAuditFailed(productId: string, runId: string, message: string) {
  await getV5GovernancePool().query(
    `UPDATE product_website_source_status
     SET public_geo_readiness = 'blocked', last_audited_at = NOW(), last_error = ?, row_version = row_version + 1
     WHERE product_id = ? AND site_audit_run_id = ?`,
    [message.slice(0, 2000), productId, runId]
  );
  return rebuildProductWebsiteCoverageProfile(productId);
}
