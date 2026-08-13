import type { GeoResearchSourceSnapshot, GeoResearchWorkspace } from "./geo-research-contracts";
import type { ProductKnowledgeProfile } from "./product-knowledge-profile";
import type { ProductRegistryItem } from "./product-registry-contracts";
import type { ProductGeoStrategyPackRecord } from "./product-strategy-pack-contracts";

export type ProductKnowledgeStatus = "empty" | "incomplete" | "source_blocked" | "research_ready" | "stale";
export type ProductWorkflowStage = "knowledge" | "research" | "strategy" | "production_setup" | "production";
export type ProductKnowledgeItemStatus = "complete" | "partial" | "missing" | "conflicted" | "stale";
export type ProductNextAction =
  | "import_materials"
  | "complete_materials"
  | "resolve_source_issue"
  | "configure_research_provider"
  | "start_geo_research"
  | "view_geo_research"
  | "retry_geo_research"
  | "review_geo_strategy"
  | "start_content_automation"
  | "review_sample_article"
  | "configure_publish_account"
  | "view_monthly_production"
  | "resolve_blocker";

export interface ProductKnowledgeReadinessItem {
  code: "product_identity" | "product_definition" | "target_audience" | "core_capabilities" | "public_evidence" | "expression_boundaries";
  label: string;
  status: ProductKnowledgeItemStatus;
  blocking: boolean;
  factCount: number;
  reason: string;
  impact: string;
  requestedInputs: string[];
}

export interface ProductWorkflowSummary {
  productId: string;
  productName: string;
  knowledgeBase: {
    status: ProductKnowledgeStatus;
    coveredCategoryCount: number;
    requiredCategoryCount: 6;
    missingCategoryCodes: string[];
    blockerCodes: string[];
    latestSourceSnapshotId?: string;
    officialSourceCount: number;
    sourceCount: number;
    updatedAt?: string;
    items: ProductKnowledgeReadinessItem[];
  };
  workflowStage: ProductWorkflowStage;
  workflowStatus: string;
  statusDescription: string;
  nextAction: {
    type: ProductNextAction;
    label: string;
    href: string;
  };
  currentRunId?: string;
  currentStrategyPackId?: string;
  sampleContractId?: string;
  monthlyPlanId?: string;
}

function readinessItem(input: Omit<ProductKnowledgeReadinessItem, "status" | "blocking"> & { complete: boolean }): ProductKnowledgeReadinessItem {
  return {
    ...input,
    status: input.complete ? "complete" : input.factCount > 0 ? "partial" : "missing",
    blocking: !input.complete
  };
}

function compileKnowledgeItems(input: {
  product: ProductRegistryItem;
  profile: ProductKnowledgeProfile;
  snapshot?: GeoResearchSourceSnapshot;
  workspace?: GeoResearchWorkspace;
}) {
  const { product, profile, snapshot, workspace } = input;
  const identityCount = [product.displayName || product.canonicalName, product.officialEntity, product.officialUrl].filter(Boolean).length;
  const audienceScenarioCount = profile.audiences.length + profile.scenarios.length;
  const explicitBoundaries = profile.boundaries.length + (workspace?.project.forbiddenFocus.length || 0);
  const sourceReady = snapshot?.quality.status === "ready" && snapshot.quality.publicCitableSourceCount > 0 && snapshot.quality.officialSourceCount > 0;

  return [
    readinessItem({
      code: "product_identity",
      label: "产品身份",
      complete: identityCount === 3,
      factCount: identityCount,
      reason: identityCount === 3 ? "名称、所属主体和官方地址均已确认。" : "产品名称、所属主体或官方地址尚未确认完整。",
      impact: "产品身份不明确时，系统无法稳定判断资料归属和官方表述。",
      requestedInputs: ["所属主体", "官方网站或产品页"]
    }),
    readinessItem({
      code: "product_definition",
      label: "产品定义",
      complete: profile.positioning.length > 0,
      factCount: profile.positioning.length,
      reason: profile.positioning.length ? `已确认 ${profile.positioning.length} 条产品定义事实。` : "缺少“产品是什么、解决什么问题”的已确认事实。",
      impact: "系统无法确定调研边界和产品核心表达。",
      requestedInputs: ["一句话产品定义", "要解决的核心问题"]
    }),
    readinessItem({
      code: "target_audience",
      label: "目标用户与场景",
      complete: profile.audiences.length > 0 && profile.scenarios.length > 0,
      factCount: audienceScenarioCount,
      reason: profile.audiences.length > 0 && profile.scenarios.length > 0
        ? `已确认 ${profile.audiences.length} 类用户和 ${profile.scenarios.length} 类场景。`
        : "缺少已确认的目标用户或适用场景。",
      impact: "系统无法可靠判断哪些人会提出什么 GEO 问题。",
      requestedInputs: ["主要客户类型", "典型岗位或部门", "高频使用场景"]
    }),
    readinessItem({
      code: "core_capabilities",
      label: "核心能力",
      complete: profile.capabilities.length > 0,
      factCount: profile.capabilities.length,
      reason: profile.capabilities.length ? `已确认 ${profile.capabilities.length} 条核心能力事实。` : "缺少有正式来源支持的当前产品能力。",
      impact: "调研和内容生成不能安全说明产品能做什么。",
      requestedInputs: ["产品手册", "官方功能页", "服务能力说明"]
    }),
    readinessItem({
      code: "public_evidence",
      label: "公开事实依据",
      complete: Boolean(sourceReady),
      factCount: snapshot?.quality.publicCitableSourceCount || 0,
      reason: sourceReady ? `已通过 ${snapshot?.quality.officialSourceCount || 0} 个官方公开来源。` : "缺少安全通过、可公开引用的 A1/A2 正式来源。",
      impact: "不能将未经证实的能力或私有资料写入公开内容。",
      requestedInputs: ["产品官网", "正式产品手册", "公开帮助文档"]
    }),
    readinessItem({
      code: "expression_boundaries",
      label: "表达限制",
      complete: explicitBoundaries > 0,
      factCount: explicitBoundaries,
      reason: explicitBoundaries ? `已确认 ${explicitBoundaries} 条限制或表达边界。` : "尚未明确不能承诺的能力和禁止表述。",
      impact: "系统无法排除过度承诺、未上线能力或敏感表达。",
      requestedInputs: ["可以说的内容", "不能说的内容", "产品能力边界"]
    })
  ];
}

function stageAndAction(input: {
  productId: string;
  knowledgeStatus: ProductKnowledgeStatus;
  workspace?: GeoResearchWorkspace;
  strategyPack?: ProductGeoStrategyPackRecord;
  providerReady: boolean;
}): Pick<ProductWorkflowSummary, "workflowStage" | "workflowStatus" | "statusDescription" | "nextAction"> {
  const { productId, knowledgeStatus, workspace, strategyPack, providerReady } = input;
  const productHref = `/products/${encodeURIComponent(productId)}`;
  const run = workspace?.latestRun;
  const strategyStatus = strategyPack?.status;

  if (strategyStatus === "production_ready" || strategyStatus === "active") {
    return { workflowStage: "production", workflowStatus: "running", statusDescription: "产品已进入当月内容生产。", nextAction: { type: "view_monthly_production", label: "查看本月生产", href: "/monthly-plan" } };
  }
  if (strategyStatus === "pending_sample_review") {
    return { workflowStage: "production_setup", workflowStatus: "sample_review_required", statusDescription: "策略已确认，等待你验收示例正文。", nextAction: { type: "review_sample_article", label: "验收示例正文", href: `${productHref}?tab=strategy` } };
  }
  if (strategyStatus === "strategy_approved") {
    return { workflowStage: "production_setup", workflowStatus: "monthly_target_required", statusDescription: "GEO 策略已确认，可配置当月生产目标。", nextAction: { type: "start_content_automation", label: "开始自动化内容生产", href: `${productHref}?tab=strategy` } };
  }
  if (strategyStatus === "pending_strategy_review" || strategyStatus === "rejected") {
    return { workflowStage: "strategy", workflowStatus: strategyStatus === "rejected" ? "changes_requested" : "pending_human_review", statusDescription: strategyStatus === "rejected" ? "策略需根据人工意见修改。" : "GEO 策略已生成，等待你确认。", nextAction: { type: "review_geo_strategy", label: "查看并确认策略", href: `${productHref}?tab=strategy` } };
  }
  if (run) {
    const failed = run.status === "failed";
    const blocked = run.status === "blocked";
    return {
      workflowStage: "research",
      workflowStatus: failed ? "failed" : run.status,
      statusDescription: failed ? "GEO 调研未完成，需要查看原因后重试。" : blocked ? "GEO 调研遇到阻塞，需要查看当前环节。" : "GEO 调研正在运行，可查看问题采集和信息整合进度。",
      nextAction: { type: failed ? "retry_geo_research" : "view_geo_research", label: failed ? "查看原因并重试" : "查看调研进度", href: `${productHref}/research/${encodeURIComponent(run.runId)}` }
    };
  }
  if (knowledgeStatus === "empty") {
    return { workflowStage: "knowledge", workflowStatus: "empty", statusDescription: "尚未导入可用产品资料。", nextAction: { type: "import_materials", label: "导入资料", href: `${productHref}?tab=knowledge` } };
  }
  if (knowledgeStatus === "source_blocked") {
    return { workflowStage: "knowledge", workflowStatus: "source_blocked", statusDescription: "当前资料的来源质量或公开使用条件未通过。", nextAction: { type: "resolve_source_issue", label: "处理来源问题", href: `${productHref}?tab=knowledge` } };
  }
  if (knowledgeStatus === "incomplete" || knowledgeStatus === "stale") {
    return { workflowStage: "knowledge", workflowStatus: knowledgeStatus, statusDescription: knowledgeStatus === "stale" ? "资料已过期或当前快照失效。" : "必需资料尚未补充完整。", nextAction: { type: "complete_materials", label: "补充资料", href: `${productHref}?tab=knowledge` } };
  }
  if (!providerReady) {
    return { workflowStage: "research", workflowStatus: "provider_config_required", statusDescription: "资料已通过，需先配置联网搜索模型。", nextAction: { type: "configure_research_provider", label: "配置联网模型", href: "/settings" } };
  }
  return { workflowStage: "research", workflowStatus: "ready_to_start", statusDescription: "资料和来源门禁已通过，可开启正式 GEO 调研。", nextAction: { type: "start_geo_research", label: "开启 GEO 调研", href: `${productHref}?tab=research` } };
}

export function compileProductWorkflowSummary(input: {
  product: ProductRegistryItem;
  profile: ProductKnowledgeProfile;
  snapshot?: GeoResearchSourceSnapshot;
  workspace?: GeoResearchWorkspace;
  strategyPack?: ProductGeoStrategyPackRecord;
  providerReady: boolean;
}): ProductWorkflowSummary {
  const items = compileKnowledgeItems(input);
  const snapshot = input.snapshot;
  const sourceBlocked = Boolean(snapshot && snapshot.quality.status === "blocked");
  const coveredCategoryCount = items.filter((item) => item.status === "complete").length;
  const knowledgeStatus: ProductKnowledgeStatus = !snapshot
    ? "empty"
    : sourceBlocked
      ? "source_blocked"
      : coveredCategoryCount === 6
        ? "research_ready"
        : "incomplete";
  const workflow = stageAndAction({
    productId: input.product.productId,
    knowledgeStatus,
    workspace: input.workspace,
    strategyPack: input.strategyPack,
    providerReady: input.providerReady
  });

  return {
    productId: input.product.productId,
    productName: input.product.displayName,
    knowledgeBase: {
      status: knowledgeStatus,
      coveredCategoryCount,
      requiredCategoryCount: 6,
      missingCategoryCodes: items.filter((item) => item.status !== "complete").map((item) => item.code),
      blockerCodes: [
        ...items.filter((item) => item.blocking).map((item) => item.code),
        ...(snapshot?.quality.issueCodes || [])
      ],
      latestSourceSnapshotId: snapshot?.snapshotId,
      officialSourceCount: snapshot?.quality.officialSourceCount || 0,
      sourceCount: snapshot?.sourceCount || 0,
      updatedAt: snapshot?.createdAt || input.product.updatedAt,
      items
    },
    ...workflow,
    currentRunId: input.workspace?.latestRun?.runId,
    currentStrategyPackId: input.strategyPack?.id
  };
}
