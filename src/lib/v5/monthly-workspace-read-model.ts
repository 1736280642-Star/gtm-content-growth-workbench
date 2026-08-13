import type { V5MonthlyPlan } from "./monthly-contracts";
import { getMonthlyWorkspaceBase } from "./monthly-service";
import type {
  BatchQueueItem,
  MonthlyPlanConfig,
  MonthlyWorkspaceReadModel,
  ProductionMatrixTask,
  RulePackageOption,
  V5MonthlyPlanRecord
} from "./monthly-workspace-contracts";
import { loadMonthlyWorkspaceGovernance } from "./monthly-workspace-governance";
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool, hasV5GovernanceDatabaseConfig, parseV5Json } from "./knowledge-governance-repository";
import { readFormalProductionQueue } from "./single-article-production-repository";
import type { ProductGeoStrategyContentPlanV2 } from "./product-strategy-pack-contracts";
import { listProductRegistryRecords } from "./product-registry-repository";
import { attributeProductionTaskProducts } from "./product-attribution";

async function readProductStrategyTargetQuestions() {
  if (!hasV5GovernanceDatabaseConfig()) return [];
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT p.id AS product_id, sp.id AS strategy_pack_id, sp.status, sp.content_plan_json
     FROM product_entity p
     JOIN product_strategy_packs sp ON sp.id = (
       SELECT sp2.id
       FROM product_strategy_packs sp2
       WHERE sp2.product_id = p.id
       ORDER BY sp2.strategy_version DESC, sp2.created_at DESC
       LIMIT 1
     )
     WHERE p.status = 'active' AND sp.status IN ('pending_strategy_review', 'strategy_approved', 'pending_sample_review', 'production_ready')`
  );
  return rows.flatMap((row) => {
    const plan = parseV5Json<ProductGeoStrategyContentPlanV2 | null>(row.content_plan_json, null);
    if (!plan) return [];
    return plan.geoOpportunities.flatMap((opportunity) => opportunity.representativeQuestions.map((question) => ({
      questionVersionId: `strategy-question-${createHash("sha256").update(`${row.strategy_pack_id}:${opportunity.opportunityId}:${question}`).digest("hex").slice(0, 42)}`,
      question,
      productId: String(row.product_id),
      status: String(row.status) === "production_ready" ? "monthly_ready" as const : "frozen" as const,
      source: "v5_formal" as const
    })));
  });
}

function compactProductionTask(task: ProductionMatrixTask): ProductionMatrixTask {
  const compactDraft = (draft: ProductionMatrixTask["currentDraft"]) => draft ? {
    ...draft,
    markdown: "",
    bodyIncluded: false,
    evidenceReferences: undefined
  } : undefined;
  return { ...task, currentDraft: compactDraft(task.currentDraft), lastUsableDraft: compactDraft(task.lastUsableDraft) };
}

/** Keeps list/status data while removing article bodies and evidence excerpts. */
export function compactMonthlyWorkspace(model: MonthlyWorkspaceReadModel): MonthlyWorkspaceReadModel {
  return {
    ...model,
    productionTasks: model.productionTasks.map(compactProductionTask),
    plan: model.plan ? { ...model.plan, matrixTasks: model.plan.matrixTasks?.map(compactProductionTask) } : null
  };
}

function readGoalText(plan: V5MonthlyPlan, key: string) {
  const value = plan.goals[key];
  return typeof value === "string" ? value : "";
}

function toWorkspacePlanConfig(plan: V5MonthlyPlan, rulePackages: RulePackageOption[]): MonthlyPlanConfig {
  if (plan.workspaceConfig?.month === plan.month && Array.isArray(plan.workspaceConfig.groups)) {
    return plan.workspaceConfig as unknown as MonthlyPlanConfig;
  }
  const configuredChannels = Object.keys(plan.channelMix);
  return {
    month: plan.month,
    businessGoal: readGoalText(plan, "businessGoal"),
    groups: Object.entries(plan.productQuotas).map(([productId, articleQuota]) => {
      const rulePackage = rulePackages.find((item) => item.productId === productId);
      const selectedChannels = rulePackage
        ? rulePackage.allowedChannels.filter((channel) => configuredChannels.includes(channel))
        : configuredChannels;
      return {
        groupQuotaId: `formal-${plan.monthlyPlanId}-${productId}`,
        rulePackageVersionId: rulePackage?.id || "pending_config",
        productId,
        productName: rulePackage?.productName || productId,
        selectedChannels: selectedChannels.length ? selectedChannels : rulePackage?.allowedChannels || [],
        articleQuota
      };
    })
  };
}

function toWorkspacePlanRecord(plan: V5MonthlyPlan, rulePackages: RulePackageOption[]): V5MonthlyPlanRecord {
  const actor = plan.approvedBy || "v5_backend";
  const timestamp = plan.approvedAt || "";
  return {
    id: plan.monthlyPlanId,
    version: plan.version,
    status: plan.status === "completed" ? "completed" : plan.status === "in_execution" ? "running" : plan.status === "approved" ? "confirmed" : "draft",
    config: toWorkspacePlanConfig(plan, rulePackages),
    createdAt: timestamp,
    createdBy: actor,
    updatedAt: timestamp,
    updatedBy: actor
  };
}

function toFormalProductionTask(item: BatchQueueItem, strategyPackageId?: string): ProductionMatrixTask {
  const status: ProductionMatrixTask["status"] = item.displayStatus === "published"
    ? "published"
    : item.scheduleStatus === "active"
    ? "scheduled"
    : item.draftId
      ? "available"
      : item.generationStatus === "generating"
        ? "generating"
        : item.finalEvidenceGate === "blocked" || item.evidencePreview === "needs_material"
          ? "awaiting_material"
          : item.generationStatus === "provider_failed"
            ? "system_recovering"
            : "ready_for_generation";

  return {
    taskId: item.matrixItemId,
    monthlyPlanId: item.monthlyPlanId,
    productId: item.productId,
    productNameSnapshot: item.product,
    strategyPackageId: strategyPackageId || `formal-strategy-${item.monthlyPlanId}`,
    quotaRuleId: `formal-${item.matrixItemId}`,
    questionVersionId: "formal-matrix-snapshot",
    question: item.primaryDistilledTerm || item.product,
    baseTopicIndex: 1,
    title: item.title,
    contentType: item.contentType,
    articleTypeProfileVersionId: item.contentType,
    articleTypeNameSnapshot: item.contentType,
    typeMatchRunId: "formal-matrix-approved",
    typeSelectionSource: "user_selected",
    matchReasonSnapshot: "来自已批准正式矩阵快照",
    articleTypePromptConstraintSnapshot: "",
    articleTypePromptConstraintSnapshotHash: "",
    channel: item.channel,
    rulePackageVersionId: item.rulePackageVersion,
    knowledgeBaseIds: [],
    sourceSnapshotHash: "formal-evidence-snapshot",
    evidencePackSourceSnapshotHash: item.evidencePackId || "pending-evidence-pack",
    status,
    knowledgeTodoId: status === "awaiting_material" ? item.matrixItemId : undefined,
    recoveryAttemptCount: 0,
    automaticRepairCount: 0,
    scheduledAt: item.scheduleDate ? `${item.scheduleDate}T${item.scheduleTime || "00:00"}:00+08:00` : undefined,
    platformAccount: item.platformAccount,
    formal: true,
    formalDraftId: item.draftId,
    ctaValidationStatus: item.hardRuleStatus === "passed" ? "passed" : item.hardRuleStatus === "blocked" ? "failed" : "pending",
    generationProgress: item.generationStatus === "generating" ? 50 : item.draftId ? 100 : 0,
    failureReason: item.failureReason,
    updatedAt: new Date().toISOString()
  };
}

function productionTaskIdentity(task: ProductionMatrixTask) {
  const normalizedTitle = task.title.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
  const normalizedChannel = task.channel.trim().toLocaleLowerCase("zh-CN");
  return `${normalizedChannel}::${normalizedTitle}`;
}

/**
 * A formal queue is an overlay, not a replacement for a persisted monthly snapshot.
 * This keeps restored matrix items visible while preferring MySQL state for the same
 * channel/title once that item has entered the formal execution pipeline.
 */
export function mergeMonthlyProductionTasks(
  snapshotTasks: ProductionMatrixTask[],
  formalTasks: ProductionMatrixTask[]
) {
  const merged = new Map<string, ProductionMatrixTask>();
  for (const task of snapshotTasks) merged.set(productionTaskIdentity(task), task);
  for (const task of formalTasks) merged.set(productionTaskIdentity(task), task);
  return Array.from(merged.values());
}

export async function getMonthlyWorkspaceReadModel(requestedMonth?: string): Promise<MonthlyWorkspaceReadModel> {
  const base = await getMonthlyWorkspaceBase(requestedMonth);
  const [governance, productionQueue, productStrategyQuestions, products] = await Promise.all([
    loadMonthlyWorkspaceGovernance(base.month, base.rulePackages, base.plan?.id),
    loadFormalQueue(base.month),
    readProductStrategyTargetQuestions(),
    hasV5GovernanceDatabaseConfig() ? listProductRegistryRecords() : Promise.resolve([])
  ]);
  const formalPlanRecord = governance.monthlyPlan ? toWorkspacePlanRecord(governance.monthlyPlan, governance.rulePackages) : null;
  const formalTasks = productionQueue.items.map((item) => toFormalProductionTask(item, governance.monthlyPlan?.strategyPackageVersionId));
  const productionTasks = attributeProductionTaskProducts(
    mergeMonthlyProductionTasks(base.productionTasks, formalTasks),
    products
  );
  const plan = formalPlanRecord
    ? {
        ...base.plan,
        ...formalPlanRecord,
        strategyPackage: base.plan?.strategyPackage,
        matrixTasks: productionTasks
      }
    : base.plan
      ? { ...base.plan, matrixTasks: productionTasks }
      : null;
  const adaptedRulePackages = governance.source === "v5_mysql" || base.source.referenceData !== "v4_runtime"
    ? governance.rulePackages
    : base.rulePackages;
  const knowledgeBases = Array.from(
    new Map(
      [...base.knowledgeBases, ...governance.knowledgeBases]
        .map((item) => [item.knowledgeBaseId, item])
    ).values()
  );

  return {
    ...base,
    targetQuestions: Array.from(new Map([...base.targetQuestions, ...productStrategyQuestions].map((item) => [item.questionVersionId, item])).values()),
    batchQueueItems: productionQueue.items,
    productionTasks,
    plan,
    draftPlan: plan?.config || base.draftPlan,
    rulePackages: adaptedRulePackages,
    knowledgeBases,
    source: {
      ...base.source,
      monthlyData: plan ? "persisted" : base.source.monthlyData,
      governanceData: governance.source,
      productionQueue: productionQueue.source
    },
    formal: {
      monthlyPlan: governance.monthlyPlan,
      productionReadiness: governance.productionReadiness,
      productionPoolEntries: governance.productionPoolEntries,
      message: [governance.message, productionQueue.message].filter(Boolean).join(" ") || undefined
    }
  };
}

async function loadFormalQueue(month: string): Promise<{
  items: MonthlyWorkspaceReadModel["batchQueueItems"];
  source: MonthlyWorkspaceReadModel["source"]["productionQueue"];
  message?: string;
}> {
  if (!hasV5GovernanceDatabaseConfig()) {
    return { items: [], source: "pending_config", message: "正式生产队列需要独立 MySQL 配置。" };
  }
  try {
    return { items: await readFormalProductionQueue(month), source: "v5_mysql" };
  } catch (error) {
    return { items: [], source: "failed", message: error instanceof Error ? error.message : "正式生产队列读取失败。" };
  }
}
