import type { V5GovernanceActor } from "./knowledge-governance-repository";
import {
  activateV5ProductionPoolEntryRecord,
  listV5ProductionPoolEntriesRecord,
  suspendV5ProductionPoolEntryRecord
} from "./knowledge-governance-production-pool-repository";
import { V5GovernanceServiceError, type V5WriteEnvelope } from "./knowledge-governance-service";

function assertText(value: string | undefined, field: string) {
  if (!value?.trim()) throw new V5GovernanceServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
}

function assertHumanOwner(actor: V5GovernanceActor) {
  assertText(actor.actorId, "actorId");
  assertText(actor.actorRole, "actorRole");
  assertText(actor.auditReason, "auditReason");
  if (actor.actorType !== "human" || !["product_owner", "business_owner"].includes(actor.actorRole)) {
    throw new V5GovernanceServiceError(
      "permission_denied",
      "只有人工 product_owner 或 business_owner 可以变更月度生产池。",
      403,
      "Agent 只能计算准备度和提出建议，最终准入与暂停由人工 Owner 决定。"
    );
  }
}

function assertEnvelope(input: V5WriteEnvelope) {
  assertText(input.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new V5GovernanceServiceError("invalid_contract", "expectedVersion 必须是非负整数。", 400);
  }
  assertHumanOwner(input.actor);
}

export async function getV5MonthlyProductionPool(input: { productId: string; monthlyPlanId?: string }) {
  assertText(input.productId, "productId");
  const entries = await listV5ProductionPoolEntriesRecord(input);
  return { ok: true as const, status: "success", data: { ...input, entries, count: entries.length } };
}

export async function activateV5MonthlyProductionPoolEntry(input: V5WriteEnvelope & {
  productId: string;
  monthlyPlanId: string;
  monthlyQuota: number;
}) {
  assertEnvelope(input);
  assertText(input.productId, "productId");
  assertText(input.monthlyPlanId, "monthlyPlanId");
  if (!Number.isInteger(input.monthlyQuota) || input.monthlyQuota < 1) {
    throw new V5GovernanceServiceError("invalid_contract", "monthlyQuota 必须是正整数。", 400);
  }
  const stored = await activateV5ProductionPoolEntryRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "approved", data: stored };
}

export async function suspendV5MonthlyProductionPoolEntry(input: V5WriteEnvelope & {
  productId: string;
  monthlyPlanId: string;
}) {
  assertEnvelope(input);
  assertText(input.productId, "productId");
  assertText(input.monthlyPlanId, "monthlyPlanId");
  const stored = await suspendV5ProductionPoolEntryRecord(input);
  return { ok: true as const, status: stored.replayed ? "replayed" : "blocked", data: stored };
}
