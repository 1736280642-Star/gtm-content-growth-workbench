import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { CreateGeoMonitoringQuestionRequest, GeoMonitoringQuestion, GeoMonitoringRecommendation, GeoMonitoringWorkspace, GeoQuestionMetric, UpdateGeoMonitoringQuestionRequest } from "./geo-monitoring-contracts";
import { createCaptureTask } from "./capture-repository";
import { getV5GovernancePool, hashV5GovernancePayload, parseV5Json, stringifyV5Json, V5GovernanceRepositoryError, withV5GovernanceTransaction, writeV5GovernanceAudit } from "./knowledge-governance-repository";
import { listApprovedGeoMonitoringQuestions } from "./question-service";
import type { ProductWebsiteCoverageProfile } from "./website-coverage-contracts";

const SUPPORTED_PLATFORMS = new Set(["doubao", "deepseek", "qwen", "chatgpt"]);
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : "";
const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
const normalizeDomain = (value: string) => { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const domainMatches = (candidate: string, owned: string[]) => owned.some((domain) => candidate === domain || candidate.endsWith(`.${domain}`));
const normalizeUrl = (value: string) => { try { const url = new URL(value); url.hash = ""; url.search = ""; return url.toString().replace(/\/$/, "").toLowerCase(); } catch { return ""; } };
const categoryEnumerationPattern = /服务商.*(?:有哪些|哪家|推荐|名单|选择|选型)|(?:有哪些|哪家|推荐|名单).*服务商|实施伙伴.*(?:有哪些|哪家|推荐|选择)/;

function targetSolutionTopic(questionText: string) {
  if (categoryEnumerationPattern.test(questionText)) return "provider_selection";
  if (/实施|部署|接入|集成|交付|验收|培训/.test(questionText)) return "implementation_delivery";
  return "core_service";
}

/**
 * Resolve the page(s) whose citation rate is being measured. Explicit URLs
 * win; otherwise use the audited topic page selected from the coverage profile
 * and finally the product's official URL. Do not treat every official page as
 * a solution page, or a generic footer/legal citation would inflate the metric.
 */
export function deriveTargetSolutionUrls(input: {
  questionText: string;
  explicitUrls?: string[];
  officialUrl?: string;
  websiteCoverageProfile?: Pick<ProductWebsiteCoverageProfile, "topicCoverage">;
}) {
  const normalize = (values: string[]) => [...new Set(values.map(normalizeUrl).filter(Boolean))];
  const explicit = normalize(input.explicitUrls || []);
  if (explicit.length) return explicit;
  const topic = input.websiteCoverageProfile?.topicCoverage.find((item) => item.topic === targetSolutionTopic(input.questionText));
  const covered = normalize(topic?.pageUrls || []);
  return covered.length ? covered : normalize(input.officialUrl ? [input.officialUrl] : []);
}

function serviceProviderFromRelationship(value?: string) {
  if (!value) return undefined;
  for (const segment of value.split(/[；。]/).map((item) => item.trim()).filter(Boolean)) {
    if (!/(?:服务商|实施伙伴|合作伙伴|提供|支持|负责|实施|交付)/.test(segment)) continue;
    const match = segment.match(/^([A-Za-z][A-Za-z0-9._-]{1,40})\s*(?:是|作为|可|为|向|提供|支持|负责)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function validatePlatforms(platforms: string[]) {
  const normalized = [...new Set(platforms.map((item) => item.trim()).filter(Boolean))];
  if (!normalized.length || normalized.some((item) => !SUPPORTED_PLATFORMS.has(item))) throw new V5GovernanceRepositoryError("geo_monitoring_platform_unsupported", "监控平台必须从豆包、DeepSeek、千问和 ChatGPT 中选择。", 422);
  return normalized;
}

function mapQuestion(row: RowDataPacket): GeoMonitoringQuestion {
  return {
    id: String(row.id), productId: String(row.product_id), questionVersionId: row.question_version_id ? String(row.question_version_id) : undefined,
    questionText: String(row.question_text_snapshot), targetEntityName: row.target_entity_name ? String(row.target_entity_name) : undefined,
    expectedRelationship: row.expected_relationship ? String(row.expected_relationship) : undefined,
    status: String(row.status) as GeoMonitoringQuestion["status"], selectionSource: String(row.selection_source) as GeoMonitoringQuestion["selectionSource"],
    strategyPackId: row.strategy_pack_id ? String(row.strategy_pack_id) : undefined, priority: String(row.priority) as GeoMonitoringQuestion["priority"],
    platforms: parseV5Json<string[]>(row.platforms, []), locale: String(row.locale), region: row.region ? String(row.region) : undefined,
    ownedDomains: parseV5Json<string[]>(row.owned_domains, []), targetSolutionUrls: parseV5Json<string[]>(row.target_solution_urls, []), samplesPerMonth: Number(row.samples_per_month), activeFrom: String(row.active_from).slice(0, 10),
    activeTo: row.active_to ? String(row.active_to).slice(0, 10) : undefined, approvedBy: String(row.approved_by), approvedAt: iso(row.approved_at),
    rowVersion: Number(row.row_version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

export async function listGeoMonitoringQuestions() {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT * FROM geo_monitoring_question ORDER BY status = 'active' DESC, approved_at DESC");
  return rows.map(mapQuestion);
}

export async function listGeoMonitoringRecommendations(): Promise<GeoMonitoringRecommendation[]> {
  const configured = await listGeoMonitoringQuestions();
  const key = (productId: string, text: string) => `${productId}:${text.trim().toLowerCase()}`;
  const activeKeys = new Set(configured.map((item) => key(item.productId, item.questionText)));
  const [productRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT id, canonical_name, display_name, aliases FROM product_entity WHERE status = 'active'"
  );
  const normalizeIdentity = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const productIdentity = new Map<string, string>();
  for (const row of productRows) {
    const productId = String(row.id);
    for (const identity of [productId, String(row.canonical_name || ""), String(row.display_name || ""), ...parseV5Json<string[]>(row.aliases, [])]) {
      if (identity.trim()) productIdentity.set(normalizeIdentity(identity), productId);
    }
  }
  const recommendations: GeoMonitoringRecommendation[] = listApprovedGeoMonitoringQuestions().flatMap((item) => {
    const productId = productIdentity.get(normalizeIdentity(item.currentVersion.product || ""));
    if (!productId) return [];
    return [{
      productId, questionVersionId: item.currentVersion.questionVersionId,
      questionText: item.currentVersion.text, source: "geo_research_confirmed" as const, alreadyConfigured: activeKeys.has(key(productId, item.currentVersion.text))
    }];
  });
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id, product_id, content_plan_json FROM product_strategy_packs
     WHERE status IN ('active', 'production_ready', 'pending_sample_review') ORDER BY compiled_at DESC`
  );
  const seenProducts = new Set<string>();
  for (const row of rows) {
    const productId = String(row.product_id);
    if (seenProducts.has(productId)) continue;
    seenProducts.add(productId);
    const plan = parseV5Json<Record<string, unknown>>(row.content_plan_json, {});
    const baseline = plan.retestBaseline && typeof plan.retestBaseline === "object" && !Array.isArray(plan.retestBaseline) ? plan.retestBaseline as Record<string, unknown> : {};
    const questions = Array.isArray(baseline.questions) ? baseline.questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    for (const questionText of questions) recommendations.push({ productId, questionText, source: "geo_strategy_recommended", strategyPackId: String(row.id), alreadyConfigured: activeKeys.has(key(productId, questionText)) });
  }
  return [...new Map(recommendations.map((item) => [`${item.productId}:${item.questionText}:${item.source}`, item])).values()];
}

export async function createGeoMonitoringQuestion(input: CreateGeoMonitoringQuestionRequest) {
  const productId = input.productId.trim();
  const questionText = input.questionText.trim();
  if (!productId || !questionText) throw new V5GovernanceRepositoryError("geo_monitoring_question_invalid", "productId 和 questionText 为必填项。", 422);
  const platforms = validatePlatforms(input.platforms);
  const [productRows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT display_name, official_url, entity_relationship FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1", [productId]);
  if (!productRows[0]) throw new V5GovernanceRepositoryError("geo_monitoring_product_not_found", "监控问题必须关联一个正式启用的产品实体。", 422);
  const relationship = input.expectedRelationship?.trim() || (productRows[0].entity_relationship ? String(productRows[0].entity_relationship) : undefined);
  const targetEntityName = input.targetEntityName?.trim()
    || (categoryEnumerationPattern.test(questionText) ? serviceProviderFromRelationship(relationship) : undefined)
    || String(productRows[0].display_name || "").trim();
  const ownedDomains = [...new Set([...(input.ownedDomains || []), String(productRows[0].official_url || "")].map(normalizeDomain).filter(Boolean))];
  const [profileRows] = await getV5GovernancePool().query<RowDataPacket[]>("SELECT profile_json FROM product_website_coverage_profile WHERE product_id = ? LIMIT 1", [productId]);
  const websiteCoverageProfile = parseV5Json<Pick<ProductWebsiteCoverageProfile, "topicCoverage"> | undefined>(profileRows[0]?.profile_json, undefined);
  const targetSolutionUrls = deriveTargetSolutionUrls({ questionText, explicitUrls: input.targetSolutionUrls, officialUrl: String(productRows[0].official_url || ""), websiteCoverageProfile });
  const samplesPerMonth = Math.max(1, Math.min(20, Number(input.samplesPerMonth || 3)));
  const requestHash = hashV5GovernancePayload({ productId, questionText, targetEntityName, relationship, questionVersionId: input.questionVersionId, selectionSource: input.selectionSource, strategyPackId: input.strategyPackId, platforms, locale: input.locale || "zh-CN", region: input.region, ownedDomains, targetSolutionUrls, samplesPerMonth });
  const saved = await withV5GovernanceTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_monitoring_question WHERE idempotency_key = ? FOR UPDATE", [input.idempotencyKey]);
    if (existing[0]) {
      if (String(existing[0].request_hash) !== requestHash) throw new V5GovernanceRepositoryError("idempotency_conflict", "同一幂等键已用于不同的监控问题请求。", 409);
      return mapQuestion(existing[0]);
    }
    const [products] = await connection.query<RowDataPacket[]>("SELECT id FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1 FOR UPDATE", [productId]);
    if (!products[0]) throw new V5GovernanceRepositoryError("geo_monitoring_product_not_found", "监控问题必须关联一个正式启用的产品实体。", 422);
    const [duplicates] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM geo_monitoring_question WHERE product_id = ? AND LOWER(TRIM(question_text_snapshot)) = LOWER(?) AND status <> 'archived' LIMIT 1 FOR UPDATE",
      [productId, questionText]
    );
    if (duplicates[0]) throw new V5GovernanceRepositoryError("geo_monitoring_question_duplicate", "该产品下已有相同的有效监控问题。", 409);
    const id = `geo-monitor-question-${randomUUID()}`;
    await connection.query(
      `INSERT INTO geo_monitoring_question
       (id, product_id, question_version_id, question_text_snapshot, target_entity_name, expected_relationship, status, selection_source, strategy_pack_id, priority, platforms, locale, region, owned_domains, target_solution_urls, samples_per_month, active_from, approved_by, approved_at, idempotency_key, request_hash, row_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, 1, NOW())`,
      [id, productId, input.questionVersionId || null, questionText, targetEntityName || null, relationship || null, input.selectionSource, input.strategyPackId || null, input.priority || "medium", stringifyV5Json(platforms), input.locale || "zh-CN", input.region || null, stringifyV5Json(ownedDomains), stringifyV5Json(targetSolutionUrls), samplesPerMonth, input.actor.actorId, input.idempotencyKey, requestHash]
    );
    await writeV5GovernanceAudit(connection, { actorId: input.actor.actorId, actorRole: input.actor.actorRole, actorType: input.actor.actorType === "runner" ? "system" : input.actor.actorType, auditReason: input.reason, eventType: "geo_monitoring_question_activated", objectType: "geo_monitoring_question", objectId: id, relatedSourceIds: [input.questionVersionId || questionText], afterSummary: { productId, selectionSource: input.selectionSource, platforms, samplesPerMonth }, correlationId: input.strategyPackId || id });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_monitoring_question WHERE id = ?", [id]);
    return mapQuestion(rows[0]);
  });
  await ensureGeoMonitoringTasksForQuestion(saved, monthNow());
  return saved;
}

export async function updateGeoMonitoringQuestion(id: string, input: UpdateGeoMonitoringQuestionRequest) {
  const saved = await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_monitoring_question WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("geo_monitoring_question_not_found", "监控问题不存在。", 404);
    if (Number(rows[0].row_version) !== input.expectedVersion) throw new V5GovernanceRepositoryError("geo_monitoring_question_version_conflict", "监控问题已经更新，请刷新后重试。", 409);
    const current = mapQuestion(rows[0]);
    const platforms = input.platforms ? validatePlatforms(input.platforms) : current.platforms;
    const ownedDomains = input.ownedDomains ? [...new Set(input.ownedDomains.map(normalizeDomain).filter(Boolean))] : current.ownedDomains;
    const status = input.status || current.status;
    await connection.query(
      `UPDATE geo_monitoring_question SET status = ?, priority = ?, platforms = ?, locale = ?, region = ?, owned_domains = ?, samples_per_month = ?,
       active_to = IF(? = 'archived', CURDATE(), IF(? = 'active', NULL, active_to)), row_version = row_version + 1 WHERE id = ?`,
      [status, input.priority || current.priority, stringifyV5Json(platforms), input.locale || current.locale, input.region === undefined ? current.region || null : input.region || null,
        stringifyV5Json(ownedDomains), Math.max(1, Math.min(20, Number(input.samplesPerMonth || current.samplesPerMonth))), status, status, id]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      actorType: input.actor.actorType === "runner" ? "system" : input.actor.actorType,
      auditReason: input.reason,
      eventType: "geo_monitoring_question_updated",
      objectType: "geo_monitoring_question",
      objectId: id,
      relatedSourceIds: [current.questionVersionId || current.questionText],
      beforeSummary: { status: current.status, rowVersion: current.rowVersion },
      afterSummary: { status, platforms, samplesPerMonth: Math.max(1, Math.min(20, Number(input.samplesPerMonth || current.samplesPerMonth))) },
      correlationId: current.strategyPackId || id
    });
    const [saved] = await connection.query<RowDataPacket[]>("SELECT * FROM geo_monitoring_question WHERE id = ?", [id]);
    return mapQuestion(saved[0]);
  });
  if (saved.status === "active") await ensureGeoMonitoringTasksForQuestion(saved, monthNow());
  return saved;
}

export function getGeoMonitoringSampleSchedule(month: string, samplesPerMonth: number) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new V5GovernanceRepositoryError("invalid_month", "month 必须使用 YYYY-MM。", 422);
  const count = Math.max(1, Math.min(20, Math.floor(samplesPerMonth)));
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const day = count === 1 ? 1 : 1 + Math.floor((index * (daysInMonth - 1)) / (count - 1));
    return `${month}-${String(day).padStart(2, "0")}T01:00:00.000Z`;
  });
}

export async function ensureGeoMonitoringTasksForQuestion(question: GeoMonitoringQuestion, month: string) {
  if (question.status !== "active") return [];
  const sampleSchedule = getGeoMonitoringSampleSchedule(month, question.samplesPerMonth);
  const created: Awaited<ReturnType<typeof createCaptureTask>>[] = [];
  for (const platform of question.platforms) for (let sample = 1; sample <= question.samplesPerMonth; sample += 1) {
    const digest = createHash("sha256").update(`${question.id}:${month}:${platform}:${sample}`).digest("hex").slice(0, 48);
    created.push(await createCaptureTask({ productId: question.productId, question: question.questionText, questionVersionId: question.questionVersionId,
      monitoringQuestionId: question.id, triggerType: "monitoring_question", captureCondition: { locale: question.locale, region: question.region || "CN", conversationMode: "new_conversation", personalizationMode: "off", modelLabel: "platform-default" },
      targetEntityName: question.targetEntityName, platform, idempotencyKey: `geo-monitor:${digest}`, priority: question.priority === "high" ? 90 : question.priority === "medium" ? 60 : 30, scheduledFor: sampleSchedule[sample - 1] }));
  }
  return created;
}

export async function ensureCurrentMonthGeoMonitoringTasks(month = monthNow()) {
  const questions = (await listGeoMonitoringQuestions()).filter((item) => item.status === "active" && item.activeFrom.slice(0, 7) <= month && (!item.activeTo || item.activeTo.slice(0, 7) >= month));
  const results = await Promise.all(questions.map((item) => ensureGeoMonitoringTasksForQuestion(item, month)));
  return { month, questionCount: questions.length, taskCount: results.flat().length };
}

function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function wilson95(successes: number, total: number) {
  if (!total) return null;
  const z = 1.959963984540054;
  const ratio = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (ratio + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((ratio * (1 - ratio) + (z * z) / (4 * total)) / total) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

interface GeoMetricEvidenceRow {
  monitoring_question_id: string;
  platform: string;
  status: string;
  payload?: unknown;
}

export function evaluateGeoAnswerSignals(config: GeoMonitoringQuestion, payload: Record<string, unknown>) {
  const answerText = String(payload.answerText || "");
  const targetEntity = config.targetEntityName || String(payload.targetEntity || "");
  const mentioned = payload.targetEntityMentioned === true || Boolean(targetEntity && answerText.toLocaleLowerCase().includes(targetEntity.toLocaleLowerCase()));
  const categoryEnumeration = categoryEnumerationPattern.test(config.questionText);
  const serviceRolePresent = /服务商|实施伙伴|合作伙伴|实施|交付|培训|技术支持|持续运营/.test(answerText);
  const ownershipMisstatement = targetEntity
    ? new RegExp(`${targetEntity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,18}(?:旗下产品|官方产品|产品所有方|原厂产品)`, "i").test(answerText)
    : false;
  const relationshipAccurate = mentioned && Boolean(config.expectedRelationship) && serviceRolePresent && !ownershipMisstatement;
  const citations = Array.isArray(payload.citations) ? payload.citations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const targetUrls = new Set((config.targetSolutionUrls || []).map(normalizeUrl).filter(Boolean));
  const targetSolutionCited = citations.some((item) => targetUrls.has(normalizeUrl(String(item.url || ""))));
  return { mentioned, categoryEnumeration, categoryIncluded: categoryEnumeration && mentioned, relationshipAccurate, targetSolutionCited, citations };
}

export function computeGeoQuestionMetric(config: GeoMonitoringQuestion, rows: GeoMetricEvidenceRow[], month: string): GeoQuestionMetric {
  const relevant = rows.filter((row) => String(row.monitoring_question_id) === config.id);
  const completed = relevant.filter((row) => String(row.status) === "completed" && row.payload);
  const failureStatuses = new Set(["failed", "needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed", "cancelled"]);
  const failed = relevant.filter((row) => failureStatuses.has(String(row.status)));
  const observedRuns = completed.length + failed.length;
  const owned = config.ownedDomains.map(normalizeDomain).filter(Boolean);
  const hasOwnedDomains = owned.length > 0;
  const parsed = completed.map((row) => ({ row, payload: parseV5Json<Record<string, unknown>>(row.payload, {}) }));
  const signals = parsed.map(({ payload }) => evaluateGeoAnswerSignals(config, payload));
  const mentioned = signals.filter((item) => item.mentioned).length;
  const categoryEnumeration = categoryEnumerationPattern.test(config.questionText);
  const categoryInclusionCount = signals.filter((item) => item.categoryIncluded).length;
  const relationshipObservedCount = signals.filter((item) => item.mentioned && Boolean(config.expectedRelationship)).length;
  const relationshipAccurateCount = signals.filter((item) => item.relationshipAccurate).length;
  const targetSolutionCitationCount = signals.filter((item) => item.targetSolutionCited).length;
  const citations = signals.map((item) => item.citations);
  const ownedByRun = citations.map((items) => items.filter((item) => domainMatches(normalizeDomain(String(item.url || "")), owned)));
  const ownedCitationCount = ownedByRun.filter((items) => items.length > 0).length;
  const allCitationCount = citations.reduce((sum, items) => sum + items.length, 0);
  const ownedCitationAppearances = ownedByRun.reduce((sum, items) => sum + items.length, 0);
  const ranks = ownedByRun.flatMap((items) => items.map((item) => Number(item.position)).filter((value) => Number.isFinite(value) && value > 0));
  const platformBreakdown = [...new Set([...config.platforms, ...relevant.map((row) => String(row.platform))])].map((platform) => {
    const platformRows = parsed.filter(({ row }) => String(row.platform) === platform);
    const platformSignals = platformRows.map(({ payload }) => evaluateGeoAnswerSignals(config, payload));
    const platformOwned = platformRows.filter(({ payload }) => (Array.isArray(payload.citations) ? payload.citations : []).some((item) => Boolean(item) && typeof item === "object" && domainMatches(normalizeDomain(String((item as Record<string, unknown>).url || "")), owned))).length;
    const platformMentioned = platformSignals.filter((item) => item.mentioned).length;
    const platformRelationshipObserved = platformSignals.filter((item) => item.mentioned && Boolean(config.expectedRelationship)).length;
    return { platform, successfulRuns: platformRows.length, brandMentionRate: platformRows.length ? platformMentioned / platformRows.length : null, ownedCitationRate: hasOwnedDomains && platformRows.length ? platformOwned / platformRows.length : null,
      categoryInclusionRate: categoryEnumeration && platformRows.length ? platformSignals.filter((item) => item.categoryIncluded).length / platformRows.length : null,
      relationshipAccuracyRate: platformRelationshipObserved ? platformSignals.filter((item) => item.relationshipAccurate).length / platformRelationshipObserved : null,
      targetSolutionCitationRate: platformRows.length && (config.targetSolutionUrls || []).length ? platformSignals.filter((item) => item.targetSolutionCited).length / platformRows.length : null };
  });
  const successfulRuns = completed.length;
  const platformCoverageComplete = config.platforms.every((platform) => (platformBreakdown.find((item) => item.platform === platform)?.successfulRuns || 0) >= 3);
  return { monitoringQuestionId: config.id, month, totalRuns: observedRuns, successfulRuns, failedRuns: failed.length,
    brandMentionCount: mentioned, ownedCitationCount, totalCitationCount: allCitationCount, categoryInclusionCount, relationshipAccurateCount, targetSolutionCitationCount,
    brandMentionRate: successfulRuns ? mentioned / successfulRuns : null, ownedCitationRate: hasOwnedDomains && successfulRuns ? ownedCitationCount / successfulRuns : null,
    categoryInclusionRate: categoryEnumeration && successfulRuns ? categoryInclusionCount / successfulRuns : null,
    relationshipAccuracyRate: relationshipObservedCount ? relationshipAccurateCount / relationshipObservedCount : null,
    targetSolutionCitationRate: successfulRuns && (config.targetSolutionUrls || []).length ? targetSolutionCitationCount / successfulRuns : null,
    brandMentionConfidence95: wilson95(mentioned, successfulRuns), ownedCitationConfidence95: hasOwnedDomains ? wilson95(ownedCitationCount, successfulRuns) : null,
    citationShareOfVoice: hasOwnedDomains && allCitationCount ? ownedCitationAppearances / allCitationCount : null, medianCitationRank: median(ranks), answerFailureRate: observedRuns ? failed.length / observedRuns : null,
    platformCoverageComplete,
    sampleStatus: successfulRuns >= 20 && platformCoverageComplete ? "reliable" : successfulRuns >= 3 ? "directional" : "insufficient", evidenceSource: "ui_capture_real", platformBreakdown };
}

export async function getGeoQuestionMetrics(month: string, questions?: GeoMonitoringQuestion[]): Promise<GeoQuestionMetric[]> {
  const configs = questions || await listGeoMonitoringQuestions();
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT t.monitoring_question_id, t.platform, t.status, e.payload
     FROM capture_tasks t LEFT JOIN capture_evidence e ON e.id = (
       SELECT e2.id FROM capture_evidence e2 WHERE e2.task_id = t.task_id ORDER BY e2.version DESC, e2.created_at DESC LIMIT 1)
     WHERE t.monitoring_question_id IS NOT NULL AND DATE_FORMAT(t.created_at, '%Y-%m') = ?`, [month]
  );
  return configs.map((config) => computeGeoQuestionMetric(config, rows as GeoMetricEvidenceRow[], month));
}

export async function getGeoMonitoringWorkspace(month: string): Promise<GeoMonitoringWorkspace> {
  const questions = await listGeoMonitoringQuestions();
  const [recommendations, metrics] = await Promise.all([listGeoMonitoringRecommendations(), getGeoQuestionMetrics(month, questions)]);
  return { source: "formal_database", questions, recommendations, metrics };
}
