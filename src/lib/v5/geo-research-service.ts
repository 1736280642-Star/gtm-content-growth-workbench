import type { GeoResearchReadiness, GeoResearchRun } from "./geo-research-contracts";
import { getGeoResearchProviderReadiness } from "./geo-research-provider";
import {
  approveGeoBlueprintRecord,
  createGeoResearchProjectRecord,
  createGeoResearchRunRecord,
  readGeoResearchRunWorkspace,
  readGeoResearchWorkspace,
  readLatestGeoSourceSnapshot,
  requestGeoBlueprintChangesRecord,
  updateGeoResearchProjectRecord
} from "./geo-research-repository";
import { getActiveProduct } from "./product-registry-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";

function assertText(value: string | undefined, field: string, maxLength = 255) {
  if (!value?.trim()) {
    throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
  }
  if (value.trim().length > maxLength) {
    throw new V5GovernanceServiceError("invalid_contract", `${field} 不能超过 ${maxLength} 个字符。`, 400);
  }
}

function assertActor(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId", 128);
  assertText(actor.actorRole, "actorRole", 128);
  assertText(actor.actorType, "actorType", 32);
  assertText(actor.auditReason, "auditReason", 500);
}

function assertStringList(values: string[] | undefined, field: string, maxItems = 50) {
  if (!values) return;
  if (values.length > maxItems || values.some((item) => typeof item !== "string" || !item.trim())) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      `${field} 必须是至多 ${maxItems} 项的非空字符串数组。`,
      400
    );
  }
}

export async function getGeoResearchWorkspace(productId: string) {
  assertText(productId, "productId", 64);
  const product = await getActiveProduct(productId);
  const [workspace, latestSourceSnapshot] = await Promise.all([
    readGeoResearchWorkspace(productId),
    readLatestGeoSourceSnapshot(productId)
  ]);
  const provider = getGeoResearchProviderReadiness();
  const checks: GeoResearchReadiness["checks"] = [
    {
      key: "product_identity",
      label: "产品身份",
      status: product.confirmedAt ? "ready" : "blocked",
      detail: product.confirmedAt ? "产品实体已人工确认。" : "产品实体还没有人工确认记录。"
    },
    {
      key: "research_boundary",
      label: "研究边界",
      status: workspace ? "ready" : "blocked",
      detail: workspace ? "表达重点、市场、语言和渠道已保存。" : "还没有创建 GEO 调研项目。",
      actionLabel: workspace ? undefined : "补充研究边界",
      actionHref: workspace ? undefined : `/products/${encodeURIComponent(productId)}/research`
    },
    {
      key: "source_snapshot",
      label: "产品资料快照",
      status: latestSourceSnapshot ? "ready" : "blocked",
      detail: latestSourceSnapshot
        ? `已冻结 ${latestSourceSnapshot.sourceCount} 个资料源、${latestSourceSnapshot.approvedClaimCount} 条已批准事实。`
        : "尚未形成可追溯的 SourceSnapshot，不能创建研究运行。",
      actionLabel: latestSourceSnapshot ? undefined : "导入产品资料",
      actionHref: latestSourceSnapshot
        ? undefined
        : `/knowledge/import/document?productId=${encodeURIComponent(productId)}`
    },
    {
      key: "live_search_provider",
      label: "联网研究 Provider",
      status: provider.status,
      detail: provider.status === "ready"
        ? "OpenAI Responses API 与 web_search 已配置。"
        : "任务链可以先建立，但执行到模型规划时会暂停等待配置。",
      actionLabel: provider.status === "ready" ? undefined : "查看待配置字段",
      actionHref: provider.status === "ready" ? undefined : "/configuration",
      missingConfig: provider.missingConfig
    }
  ];
  const hasBlockedCheck = checks.some((check) => check.status === "blocked");
  const readiness: GeoResearchReadiness = {
    status: hasBlockedCheck ? "blocked" : provider.status,
    canCreateRun: !hasBlockedCheck,
    canExecuteLiveResearch: !hasBlockedCheck && provider.status === "ready",
    latestSourceSnapshot,
    checks
  };
  return { product, workspace, readiness };
}

export async function getGeoResearchRunDetails(input: { productId: string; runId: string }) {
  assertText(input.productId, "productId", 64);
  assertText(input.runId, "runId", 64);
  const product = await getActiveProduct(input.productId);
  const runWorkspace = await readGeoResearchRunWorkspace(input);
  if (!runWorkspace) {
    throw new V5GovernanceServiceError("research_run_not_found", "GEO 调研运行不存在。", 404);
  }
  return { product, runWorkspace };
}

export async function createGeoResearchProjectForProduct(input: {
  productId: string;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 96);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  await getActiveProduct(input.productId);
  const write = await createGeoResearchProjectRecord({
    project: {
      productId: input.productId,
      expressionFocus: input.expressionFocus,
      forbiddenFocus: input.forbiddenFocus,
      researchMarkets: input.researchMarkets,
      languages: input.languages,
      targetChannels: input.targetChannels
    },
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目创建后读取失败。", 500);
  }
  return { ...write, workspace };
}

export async function updateGeoResearchProject(input: {
  productId: string;
  expectedProjectVersion: number;
  expressionFocus: string;
  forbiddenFocus?: string[];
  researchMarkets?: string[];
  languages?: string[];
  targetChannels?: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.expressionFocus, "expressionFocus", 4000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  assertStringList(input.forbiddenFocus, "forbiddenFocus", 100);
  assertStringList(input.researchMarkets, "researchMarkets", 20);
  assertStringList(input.languages, "languages", 20);
  assertStringList(input.targetChannels, "targetChannels", 30);
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedProjectVersion 必须是正整数。", 400);
  }
  await getActiveProduct(input.productId);
  const write = await updateGeoResearchProjectRecord({
    productId: input.productId,
    expectedVersion: input.expectedProjectVersion,
    expressionFocus: input.expressionFocus.trim(),
    forbiddenFocus: input.forbiddenFocus || [],
    researchMarkets: input.researchMarkets?.length ? input.researchMarkets : ["CN"],
    languages: input.languages?.length ? input.languages : ["zh-CN"],
    targetChannels: input.targetChannels?.length ? input.targetChannels : ["wechat", "official_website"],
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function startGeoResearchRun(input: {
  productId: string;
  triggerType?: GeoResearchRun["triggerType"];
  expectedProjectVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (!Number.isInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1) {
    throw new V5GovernanceServiceError(
      "invalid_contract",
      "expectedProjectVersion 必须是正整数。",
      400,
      "刷新产品调研页，读取最新版本后重试。"
    );
  }
  await getActiveProduct(input.productId);
  const write = await createGeoResearchRunRecord({
    productId: input.productId,
    triggerType: input.triggerType || "product_onboarding",
    expectedProjectVersion: input.expectedProjectVersion,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor
  });
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) {
    throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  }
  return { ...write, workspace };
}

export async function approveGeoBlueprint(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图必须由人工批准，Agent 不能代替批准。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "forbidden",
      "当前角色无权批准 GEO 蓝图。",
      403,
      "切换到内容增长、知识管理、工作台运营或开发管理员角色。"
    );
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await approveGeoBlueprintRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}

export async function requestGeoBlueprintChanges(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  reviewNote: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  assertText(input.productId, "productId", 64);
  assertText(input.blueprintVersionId, "blueprintVersionId", 64);
  assertText(input.reviewNote, "reviewNote", 2000);
  assertText(input.idempotencyKey, "idempotencyKey", 128);
  assertActor(input.actor);
  if (input.actor.actorType !== "human") {
    throw new V5GovernanceServiceError(
      "human_approval_required",
      "GEO 蓝图只能由人工退回修改。",
      403
    );
  }
  const allowedRoles = new Set(["content_growth", "knowledge_manager", "workbench_operator", "developer_admin"]);
  if (!allowedRoles.has(input.actor.actorRole)) {
    throw new V5GovernanceServiceError("forbidden", "当前角色无权评审 GEO 蓝图。", 403);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是正整数。", 400);
  }
  const write = await requestGeoBlueprintChangesRecord(input);
  const workspace = await readGeoResearchWorkspace(input.productId);
  if (!workspace) throw new V5GovernanceServiceError("research_project_not_found", "调研项目不存在。", 404);
  return { ...write, workspace };
}
