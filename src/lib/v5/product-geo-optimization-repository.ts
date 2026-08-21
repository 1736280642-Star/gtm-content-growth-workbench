import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  stringifyV5Json,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import type { ObservationGapCode, ObservationGapRecommendedAction, ObservationGapRootCause } from "./observation-contracts";
import type { ProductGeoArticleTypePortfolioItem, ProductGeoStrategyContentPlanV2 } from "./product-strategy-pack-contracts";
import type {
  ProductGeoOptimizationAction,
  ProductGeoOptimizationGap,
  ProductGeoOptimizationPriority,
  ProductGeoOptimizationSnapshot,
  ProductGeoOptimizationWorkspace
} from "./product-geo-optimization-contracts";
import { readProductWebsiteCoverageProfile } from "./website-coverage-repository";

const CAPTURE_TERMINAL = new Set(["completed", "failed", "needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed", "cancelled"]);
const MATRIX_TERMINAL = new Set(["published", "cancelled", "archived", "intercepted"]);

function stableId(prefix: string, value: string, length = 44) {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function normalizeDomain(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function normalizeUrl(value: string) {
  try { const url = new URL(value); url.search = ""; url.hash = ""; return url.toString().replace(/\/$/, "").toLowerCase(); }
  catch { return ""; }
}

function pickPriority(actions: ProductGeoOptimizationAction[]): ProductGeoOptimizationPriority {
  return actions.some((item) => item.priority === "P0") ? "P0"
    : actions.some((item) => item.priority === "P1") ? "P1"
      : actions.some((item) => item.priority === "P2") ? "P2" : "hold";
}

function gap(input: {
  code: ObservationGapCode;
  rootCause: ObservationGapRootCause;
  recommendedAction: ObservationGapRecommendedAction;
  reason: string;
  evidenceRefs: string[];
}): ProductGeoOptimizationGap { return input; }

function action(input: Omit<ProductGeoOptimizationAction, "automaticExecutionAllowed">): ProductGeoOptimizationAction {
  return { ...input, automaticExecutionAllowed: false };
}

function targetProviderFromRelationship(value: string) {
  for (const segment of value.split(/[；。]/).map((item) => item.trim()).filter(Boolean)) {
    if (!/(?:服务商|实施伙伴|合作伙伴|提供|支持|负责|实施|交付)/.test(segment)) continue;
    const match = segment.match(/^([A-Za-z][A-Za-z0-9._-]{1,40})\s*(?:是|作为|可|为|向|提供|支持|负责)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function isCategoryEnumerationQuestion(value: string) {
  return /服务商.*(?:有哪些|哪家|推荐|名单|选择|选型)|(?:有哪些|哪家|推荐|名单).*服务商|实施伙伴.*(?:有哪些|哪家|推荐|选择)/.test(value);
}

function targetSolutionUrlsForQuestion(profile: Awaited<ReturnType<typeof readProductWebsiteCoverageProfile>>, question: string) {
  const topic = isCategoryEnumerationQuestion(question)
    ? "provider_selection"
    : /实施|部署|接入|集成|交付|验收|培训/.test(question)
      ? "implementation_delivery"
      : "core_service";
  return new Set((profile?.topicCoverage.find((item) => item.topic === topic)?.pageUrls || []).map(normalizeUrl).filter(Boolean));
}

function evaluateRelationship(answerText: string, targetEntity: string | undefined, relationship: string) {
  if (!targetEntity || !relationship || !answerText.toLocaleLowerCase().includes(targetEntity.toLocaleLowerCase())) return undefined;
  const serviceRolePresent = /服务商|实施伙伴|合作伙伴|实施|交付|培训|技术支持|持续运营/.test(answerText);
  const escaped = targetEntity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownershipMisstatement = new RegExp(`${escaped}.{0,18}(?:旗下产品|官方产品|产品所有方|原厂产品)`, "i").test(answerText);
  return serviceRolePresent && !ownershipMisstatement;
}

function selectProviderArticleType(plan: ProductGeoStrategyContentPlanV2 | undefined) {
  return plan?.articleTypePortfolio.find((item) => /服务商|实施伙伴|合作伙伴|资质|选型/.test(`${item.name} ${item.definition}`));
}

function publishedArticleTypeVersions(rows: RowDataPacket[]) {
  return new Set(rows.flatMap((row) => {
    const scope = parseV5Json<Record<string, unknown>>(row.production_scope, {});
    return typeof scope.articleTypeProfileVersionId === "string" ? [scope.articleTypeProfileVersionId] : [];
  }));
}

async function deriveBatchSnapshot(rows: RowDataPacket[]): Promise<ProductGeoOptimizationSnapshot> {
  const first = rows[0];
  const productId = String(first.product_id);
  const matrixVersionId = String(first.matrix_version_id);
  const month = String(first.plan_month).slice(0, 7);
  const publishedRows = rows.filter((row) => String(row.publish_status) === "published");
  const publishedContentIds = publishedRows.map((row) => String(row.matrix_item_id));
  const pool = getV5GovernancePool();
  const [[taskRows], [strategyRows], websiteProfile, [capacityRows]] = await Promise.all([
    publishedContentIds.length ? pool.query<RowDataPacket[]>(
      `SELECT t.*, e.payload FROM capture_tasks t
       LEFT JOIN capture_evidence e ON e.id = (
         SELECT e2.id FROM capture_evidence e2 WHERE e2.task_id = t.task_id ORDER BY e2.version DESC, e2.created_at DESC LIMIT 1)
       WHERE t.trigger_type = 'published_content_retest' AND t.published_content_id IN (?) ORDER BY t.created_at`,
      [publishedContentIds]
    ) : Promise.resolve([[] as RowDataPacket[], []] as unknown as [RowDataPacket[], unknown]),
    pool.query<RowDataPacket[]>(
      `SELECT sp.id, sp.content_plan_json, p.display_name, p.entity_relationship
       FROM product_entity p LEFT JOIN product_strategy_packs sp ON sp.id = p.strategy_pack_id
       WHERE p.id = ? LIMIT 1`,
      [productId]
    ),
    readProductWebsiteCoverageProfile(productId),
    pool.query<RowDataPacket[]>(
      `SELECT p.workspace_config, COUNT(i.id) AS active_content_count
       FROM monthly_plan p
       LEFT JOIN content_matrix_item i ON i.monthly_plan_id = p.id AND i.status NOT IN ('cancelled', 'archived')
       WHERE p.id = ? GROUP BY p.id, p.workspace_config`,
      [String(first.monthly_plan_id)]
    )
  ]);
  const strategyRow = strategyRows[0];
  const plan = parseV5Json<ProductGeoStrategyContentPlanV2 | undefined>(strategyRow?.content_plan_json, undefined);
  const strategyPackId = strategyRow?.id ? String(strategyRow.id) : undefined;
  const productName = String(strategyRow?.display_name || productId);
  const relationship = String(strategyRow?.entity_relationship || "");
  const targetProvider = targetProviderFromRelationship(relationship);
  const captureTaskIds = taskRows.map((row) => String(row.task_id));
  const completed = taskRows.filter((row) => String(row.status) === "completed" && row.payload);
  const publishedContentWithRetest = new Set(taskRows.map((row) => String(row.published_content_id || "")).filter(Boolean));
  const allTasksSettled = publishedContentIds.length > 0
    && publishedContentIds.every((contentId) => publishedContentWithRetest.has(contentId))
    && taskRows.every((row) => CAPTURE_TERMINAL.has(String(row.status)));
  const allMatrixItemsSettled = rows.every((row) => MATRIX_TERMINAL.has(String(row.item_status)));
  const stablePublishedContentCount = publishedRows.filter((row) => row.stable_published_at || row.removed_at).length;
  const livenessSettled = publishedRows.length > 0 && stablePublishedContentCount === publishedRows.length;
  const batchClosed = allMatrixItemsSettled && livenessSettled && allTasksSettled;
  const officialDomains = [...new Set((websiteProfile?.officialSources || []).map((item) => normalizeDomain(item.canonicalUrl)).filter(Boolean))];
  const parsedAnswers = completed.map((row) => {
    const payload = parseV5Json<Record<string, unknown>>(row.payload, {});
    const answerText = String(payload.answerText || "");
    const question = String(row.question || "");
    const targetEntity = row.target_entity_name ? String(row.target_entity_name) : targetProvider;
    const mentioned = payload.targetEntityMentioned === true || Boolean(targetEntity && answerText.toLocaleLowerCase().includes(targetEntity.toLocaleLowerCase()));
    const citations = Array.isArray(payload.citations) ? payload.citations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
    const ownedCited = citations.some((item) => officialDomains.includes(normalizeDomain(String(item.url || ""))));
    const targetSolutionUrls = targetSolutionUrlsForQuestion(websiteProfile, question);
    const targetSolutionCited = citations.some((item) => targetSolutionUrls.has(normalizeUrl(String(item.url || ""))));
    return { row, answerText, mentioned, ownedCited, targetSolutionCited, targetSolutionConfigured: targetSolutionUrls.size > 0, relationshipAccurate: evaluateRelationship(answerText, targetEntity, relationship) };
  });
  const categoryAnswers = parsedAnswers.filter((item) => isCategoryEnumerationQuestion(String(item.row.question || "")));
  const relationshipAnswers = parsedAnswers.filter((item) => item.relationshipAccurate !== undefined);
  const targetSolutionAnswers = parsedAnswers.filter((item) => item.targetSolutionConfigured);
  const rate = (count: number, total: number) => total ? count / total : null;
  const targetMentionRate = rate(categoryAnswers.filter((item) => item.mentioned).length, categoryAnswers.length);
  const ownedCitationRate = rate(parsedAnswers.filter((item) => item.ownedCited).length, parsedAnswers.length);
  const targetSolutionCitationRate = rate(targetSolutionAnswers.filter((item) => item.targetSolutionCited).length, targetSolutionAnswers.length);
  const relationshipAccuracyRate = rate(relationshipAnswers.filter((item) => item.relationshipAccurate).length, relationshipAnswers.length);
  const evidenceRefs = [
    ...publishedRows.map((row) => `published_content:${String(row.matrix_item_id)}`),
    ...taskRows.map((row) => `geo_capture_task:${String(row.task_id)}`),
    ...(websiteProfile?.latestSiteAuditRunId ? [`geo_site_audit_run:${websiteProfile.latestSiteAuditRunId}`] : [])
  ];
  const gaps: ProductGeoOptimizationGap[] = [];
  const actions: ProductGeoOptimizationAction[] = [];
  const monthlyPlanConfig = parseV5Json<Record<string, unknown>>(capacityRows[0]?.workspace_config, {});
  const targetDeliverableCount = Number(monthlyPlanConfig.targetDeliverableCount || 0);
  const currentMonthHasCapacity = month === new Date().toISOString().slice(0, 7)
    && targetDeliverableCount > Number(capacityRows[0]?.active_content_count || 0);
  const candidateDestination = currentMonthHasCapacity
    ? "current_month_candidate_pool" as const : "next_month_candidate_pool" as const;
  const providerCoverage = websiteProfile?.topicCoverage.find((item) => item.topic === "provider_selection");
  const providerType = selectProviderArticleType(plan);
  const alreadyPublishedTypes = publishedArticleTypeVersions(publishedRows);
  const providerTypePublished = Boolean(providerType?.articleTypeVersionId && alreadyPublishedTypes.has(providerType.articleTypeVersionId));

  if (!batchClosed) {
    gaps.push(gap({ code: "observation_uncertain", rootCause: "sample_insufficient", recommendedAction: "continue_monitoring", reason: "该产品批次尚未同时完成发布存活观察与 AI 复测，当前不能提前改变内容组合。", evidenceRefs }));
    actions.push(action({ action: "continue_monitoring", priority: "P2", title: "等待批次证据闭环", rationale: "发布、72 小时存活与复测未全部结束；只继续监控，不生成重复文章。", target: "monitoring", candidateDestination: "none", evidenceRefs }));
  } else {
    if (publishedRows.some((row) => row.removed_at)) {
      actions.push(action({ action: "manual_review", priority: "P0", title: "先处理发布存活异常", rationale: "批次内存在发布后移除或不可见内容，需先核验平台回执。", target: "existing_content", candidateDestination: "none", evidenceRefs }));
    }
    if (websiteProfile?.publicGeoReadiness === "blocked") {
      gaps.push(gap({ code: "citation_gap", rootCause: "site_accessibility", recommendedAction: "fix_site", reason: "正式官网存在抓取、索引或渲染阻断，继续发文不能替代可访问性修复。", evidenceRefs }));
      actions.push(action({ action: "fix_site", priority: "P0", title: "修复官网 GEO 阻断项", rationale: "官网尚未达到公开机器可读准备度，优先修复审计中的 critical/high 问题后复测。", target: "official_website", candidateDestination: "none", evidenceRefs }));
    }
    if (relationshipAccuracyRate !== null && relationshipAccuracyRate < 0.8) {
      gaps.push(gap({ code: "relationship_gap", rootCause: "evidence_missing", recommendedAction: "collect_evidence", reason: "AI 回答对产品归属与服务商角色的表达不稳定。", evidenceRefs }));
      actions.push(action({ action: "collect_evidence", priority: "P0", title: "补强服务商关系证据", rationale: "先补资质、服务范围与双方分工的可追溯证据，禁止用新文章放大未被证明的身份表述。", target: "knowledge_base", candidateDestination: "none", evidenceRefs }));
    }
    if (targetMentionRate !== null && targetMentionRate < 0.5) {
      const rootCause: ObservationGapRootCause = websiteProfile?.publicGeoReadiness === "blocked" ? "site_accessibility"
        : providerCoverage?.status === "sufficient" || providerTypePublished ? "distribution_weak" : "content_coverage_missing";
      const recommendedAction: ObservationGapRecommendedAction = rootCause === "site_accessibility" ? "fix_site"
        : rootCause === "distribution_weak" ? "refresh_existing_content" : "create_content_candidate";
      gaps.push(gap({ code: "entity_gap", rootCause, recommendedAction, reason: "服务商枚举类回答中的目标服务商进入率仍低于 50%。", evidenceRefs }));
      if (recommendedAction === "refresh_existing_content") {
        actions.push(action({ action: "refresh_existing_content", priority: "P1", title: "增强现有服务页的可抽取性与分发", rationale: "官网或本批内容已经覆盖服务商主题，不再重复发同题文章；优先更新标题、实体关系、选择依据、内部链接与外部分发。", target: providerCoverage?.status === "sufficient" ? "official_website" : "existing_content", candidateDestination: "none", articleTypePortfolioItemId: providerType?.portfolioItemId, articleTypeVersionId: providerType?.articleTypeVersionId, evidenceRefs }));
      } else if (recommendedAction === "create_content_candidate" && providerType?.evidenceReadiness === "ready" && providerType.websiteCoverageDisposition !== "refresh_existing") {
        actions.push(action({ action: "create_content_candidate", priority: "P1", title: `补充“${providerType.name}”候选内容`, rationale: "官网覆盖不足、该文章类型证据已就绪，进入候选池供 MonthlyPlan 人工确认；不自动修改月度配额。", target: "content_candidate_pool", candidateDestination, articleTypePortfolioItemId: providerType.portfolioItemId, articleTypeVersionId: providerType.articleTypeVersionId, evidenceRefs }));
      }
    }
    if (ownedCitationRate !== null && ownedCitationRate < 0.5 && websiteProfile?.publicGeoReadiness !== "blocked") {
      gaps.push(gap({ code: "citation_gap", rootCause: "distribution_weak", recommendedAction: "refresh_existing_content", reason: "AI 已有有效回答，但官网引用率低于 50%。", evidenceRefs }));
      actions.push(action({ action: "refresh_existing_content", priority: "P1", title: "提升目标解决方案页的引用信号", rationale: "强化页面主题句、证据链接、结构化信息、站内链接与外部分发，不重复新建同主题页面。", target: "official_website", candidateDestination: "none", evidenceRefs }));
    }
    if (targetSolutionCitationRate !== null && targetSolutionCitationRate < 0.5) {
      actions.push(action({ action: "refresh_existing_content", priority: "P1", title: "把引用落到目标产品服务页", rationale: "AI 即使引用自有域名，也未稳定引用对应产品解决方案页；优化 canonical、页面实体关系和锚文本指向。", target: "official_website", candidateDestination: "none", evidenceRefs }));
    }
    if (!actions.length) {
      actions.push(action({ action: "hold", priority: "hold", title: "保持当前主题，不重复扩写", rationale: "本批的提及、关系与引用信号没有触发新增内容或官网整改阈值，继续观察相邻问题。", target: "monitoring", candidateDestination: "none", evidenceRefs }));
    }
  }
  const signals = {
    plannedContentCount: rows.length,
    publishedContentCount: publishedRows.length,
    stablePublishedContentCount,
    captureTaskCount: taskRows.length,
    successfulCaptureCount: completed.length,
    targetMentionRate,
    ownedCitationRate,
    targetSolutionCitationRate,
    relationshipAccuracyRate
  };
  const batchKey = `${productId}:${matrixVersionId}`;
  const inputEvidenceHash = hashV5GovernancePayload({ batchKey, signals, websiteProfileHash: websiteProfile?.profileHash, gaps, publishedContentIds, captureTaskIds });
  return {
    id: stableId("geo-optimization-", `${batchKey}:${inputEvidenceHash}`),
    productId,
    productName,
    month,
    matrixVersionId,
    strategyPackId,
    batchKey,
    status: !batchClosed ? "collecting" : actions.some((item) => item.priority === "P0") ? "blocked" : "ready",
    priority: pickPriority(actions),
    batchClosed,
    inputEvidenceHash,
    websiteReadiness: websiteProfile?.publicGeoReadiness || "unknown",
    signals,
    gaps,
    actions,
    publishedContentIds,
    captureTaskIds,
    sourceSiteAuditRunId: websiteProfile?.latestSiteAuditRunId,
    generatedAt: new Date().toISOString()
  };
}

async function persistClosedSnapshot(snapshot: ProductGeoOptimizationSnapshot) {
  if (!snapshot.batchClosed) return snapshot;
  await withV5GovernanceTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO product_geo_optimization_snapshot
       (id, product_id, matrix_version_id, strategy_pack_id, batch_key, input_evidence_hash, status, priority,
        optimization_json, published_content_ids, capture_task_ids, source_site_audit_run_id, generated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE optimization_json = VALUES(optimization_json), status = VALUES(status), priority = VALUES(priority),
         published_content_ids = VALUES(published_content_ids), capture_task_ids = VALUES(capture_task_ids), generated_at = VALUES(generated_at)`,
      [snapshot.id, snapshot.productId, snapshot.matrixVersionId || null, snapshot.strategyPackId || null, snapshot.batchKey, snapshot.inputEvidenceHash,
        snapshot.status, snapshot.priority, stringifyV5Json(snapshot), stringifyV5Json(snapshot.publishedContentIds), stringifyV5Json(snapshot.captureTaskIds),
        snapshot.sourceSiteAuditRunId || null, snapshot.generatedAt.slice(0, 19).replace("T", " ")]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: "product-geo-optimizer", actorRole: "system", actorType: "system", auditReason: "产品发布批次完成存活观察与 AI 复测后生成下一批优化候选",
      eventType: "product_geo_optimization_snapshot_created", objectType: "product_geo_optimization_snapshot", objectId: snapshot.id,
      relatedSourceIds: [...snapshot.publishedContentIds, ...snapshot.captureTaskIds, ...(snapshot.sourceSiteAuditRunId ? [snapshot.sourceSiteAuditRunId] : [])],
      afterSummary: { productId: snapshot.productId, batchKey: snapshot.batchKey, priority: snapshot.priority, actionCount: snapshot.actions.length, monthlyPlanMutated: false },
      correlationId: snapshot.batchKey
    });
  });
  return snapshot;
}

export async function reconcileProductGeoOptimizations(productIds?: string[]): Promise<ProductGeoOptimizationWorkspace> {
  const where = productIds?.length ? `WHERE i.product_id IN (${productIds.map(() => "?").join(",")})` : "";
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT i.id AS matrix_item_id, i.product_id, i.matrix_version_id, i.monthly_plan_id, i.status AS item_status, i.title, i.source_problem,
            i.production_scope, p.plan_month, r.id AS publish_result_id, r.status AS publish_status, r.public_url,
            r.published_at, r.stable_published_at, r.removed_at, r.url_status
     FROM content_matrix_item i JOIN monthly_plan p ON p.id = i.monthly_plan_id
     LEFT JOIN content_publish_result r ON r.matrix_item_id = i.id
     ${where}
     ORDER BY p.plan_month DESC, i.matrix_version_id, i.product_id, i.created_at`,
    productIds || []
  );
  const groups = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    const key = `${String(row.product_id)}:${String(row.matrix_version_id)}`;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  const snapshots: ProductGeoOptimizationSnapshot[] = [];
  for (const groupRows of groups.values()) {
    if (!groupRows.some((row) => String(row.publish_status) === "published")) continue;
    snapshots.push(await persistClosedSnapshot(await deriveBatchSnapshot(groupRows)));
  }
  const latestByProduct = new Map<string, ProductGeoOptimizationSnapshot>();
  for (const snapshot of snapshots.sort((left, right) => right.month.localeCompare(left.month) || right.generatedAt.localeCompare(left.generatedAt))) {
    if (!latestByProduct.has(snapshot.productId)) latestByProduct.set(snapshot.productId, snapshot);
  }
  return { source: "formal_database", products: [...latestByProduct.values()], generatedAt: new Date().toISOString() };
}

/** 已关闭发布批次是 post_publish_retest 的唯一启动凭据。 */
export async function readLatestClosedProductGeoOptimizationSnapshot(input: {
  productId: string;
  generatedAfter?: string;
  blueprintVersionId?: string;
}): Promise<ProductGeoOptimizationSnapshot | undefined> {
  const parameters: unknown[] = [input.productId];
  const generatedAfterClause = input.generatedAfter
    ? "AND opt.generated_at >= ?"
    : "";
  if (input.generatedAfter) parameters.push(new Date(input.generatedAfter));
  const blueprintClause = input.blueprintVersionId
    ? "AND sp.geo_blueprint_id = ?"
    : "";
  if (input.blueprintVersionId) parameters.push(input.blueprintVersionId);
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT opt.optimization_json
     FROM product_geo_optimization_snapshot opt
     LEFT JOIN product_strategy_packs sp ON sp.id = opt.strategy_pack_id
     WHERE opt.product_id = ? ${generatedAfterClause} ${blueprintClause}
     ORDER BY opt.generated_at DESC, opt.created_at DESC LIMIT 1`,
    parameters
  );
  const snapshot = parseV5Json<ProductGeoOptimizationSnapshot | undefined>(rows[0]?.optimization_json, undefined);
  return snapshot?.batchClosed ? snapshot : undefined;
}
