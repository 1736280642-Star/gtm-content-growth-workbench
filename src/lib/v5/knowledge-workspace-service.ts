import type { V5WriteEnvelope } from "./knowledge-governance-service";
import {
  appendV5FoundationAudit,
  createV5FoundationId,
  hashV5FoundationPayload,
  mutateV5FoundationState,
  readV5FoundationSnapshot,
  type V5FoundationState
} from "./foundation-repository";
import {
  assertV5ExpectedVersion,
  assertV5FoundationEnvelope,
  assertV5FoundationText,
  V5FoundationServiceError
} from "./foundation-service";
import type {
  V5KnowledgeActionItem,
  V5KnowledgeActionStatus,
  V5KnowledgeBaseDetail,
  V5KnowledgeMaterialStatus,
  V5KnowledgeVisibility
} from "./knowledge-workspace-contracts";

const knowledgeRoles = ["workbench_operator", "knowledge_manager", "developer_admin"] as const;
export const V5_KNOWLEDGE_UNDERSTANDING_VERSION = "knowledge-understanding.v1.0.0";

function buildDetail(state: V5FoundationState, knowledgeBaseId: string): V5KnowledgeBaseDetail | undefined {
  const knowledgeBase = state.knowledgeBases.find((item) => item.knowledgeBaseId === knowledgeBaseId);
  if (!knowledgeBase) return undefined;
  return {
    ...knowledgeBase,
    materials: state.knowledgeMaterials.filter((item) => item.knowledgeBaseId === knowledgeBaseId),
    understanding: state.knowledgeUnderstanding.filter((item) => {
      const material = state.knowledgeMaterials.find((entry) => entry.materialId === item.materialId);
      return material?.knowledgeBaseId === knowledgeBaseId;
    }),
    actionItems: state.knowledgeActionItems.filter((item) => item.knowledgeBaseId === knowledgeBaseId)
  };
}

function refreshKnowledgeSummary(state: V5FoundationState, knowledgeBaseId: string) {
  const knowledgeBase = state.knowledgeBases.find((item) => item.knowledgeBaseId === knowledgeBaseId)!;
  const materials = state.knowledgeMaterials.filter((item) => item.knowledgeBaseId === knowledgeBaseId);
  const openActions = state.knowledgeActionItems.filter((item) => item.knowledgeBaseId === knowledgeBaseId && item.status === "open");
  knowledgeBase.materialCount = materials.length;
  knowledgeBase.openActionCount = openActions.length;
  knowledgeBase.productionBlockingActionCount = openActions.filter((item) => item.affectsProduction).length;
  knowledgeBase.productionStatus = materials.length === 0
    ? "empty"
    : knowledgeBase.productionBlockingActionCount > 0 ? "limited" : "ready";
  knowledgeBase.sourceSnapshotVersion += 1;
  knowledgeBase.sourceSnapshotHash = hashV5FoundationPayload({
    knowledgeBaseId,
    focus: knowledgeBase.focus,
    materials: materials.map((item) => [item.materialId, item.status, item.updatedAt]),
    actions: openActions.map((item) => [item.actionItemId, item.status, item.updatedAt])
  });
  knowledgeBase.rowVersion += 1;
  knowledgeBase.updatedAt = new Date().toISOString();
}

export function listV5KnowledgeBases() {
  const state = readV5FoundationSnapshot();
  return { ok: true as const, status: "success" as const, data: { knowledgeBases: state.knowledgeBases, stateVersion: state.version } };
}

export function getV5KnowledgeBaseDetail(knowledgeBaseId: string) {
  assertV5FoundationText(knowledgeBaseId, "knowledgeBaseId", 160);
  const state = readV5FoundationSnapshot();
  const detail = buildDetail(state, knowledgeBaseId);
  if (!detail) throw new V5FoundationServiceError("not_found", "知识库不存在。", 404, "返回知识库列表选择现有知识库。");
  return { ok: true as const, status: "success" as const, data: { knowledgeBase: detail, stateVersion: state.version } };
}

export function createV5KnowledgeBase(input: V5WriteEnvelope & {
  name: string;
  focus: string;
  defaultVisibility?: V5KnowledgeVisibility;
}) {
  assertV5FoundationEnvelope(input, [...knowledgeRoles]);
  assertV5FoundationText(input.name, "知识库名称", 100);
  assertV5FoundationText(input.focus, "知识库重点", 600);
  const stored = mutateV5FoundationState({
    operation: "create_knowledge_workspace",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ name: input.name, focus: input.focus, defaultVisibility: input.defaultVisibility }),
    mutate(state) {
      assertV5ExpectedVersion(state.version, input.expectedVersion);
      if (state.knowledgeBases.some((item) => item.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
        throw new V5FoundationServiceError("duplicate_name", "已存在同名知识库。", 409, "打开现有知识库或使用更明确的名称。 ");
      }
      const now = new Date().toISOString();
      const knowledgeBaseId = createV5FoundationId("knowledge-base");
      const knowledgeBase = {
        knowledgeBaseId,
        name: input.name.trim(),
        focus: input.focus.trim(),
        defaultVisibility: input.defaultVisibility || "conditional_public" as V5KnowledgeVisibility,
        productionStatus: "empty" as const,
        dataSource: "real" as const,
        sourceSnapshotHash: hashV5FoundationPayload({ knowledgeBaseId, focus: input.focus.trim(), materials: [] }),
        sourceSnapshotVersion: 1,
        materialCount: 0,
        openActionCount: 0,
        productionBlockingActionCount: 0,
        rowVersion: 1,
        createdAt: now,
        updatedAt: now
      };
      state.knowledgeBases.push(knowledgeBase);
      appendV5FoundationAudit(state, {
        action: "knowledge_workspace_created",
        objectType: "KnowledgeBaseWorkspace",
        objectId: knowledgeBaseId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { knowledgeBase };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function addV5KnowledgeMaterial(input: V5WriteEnvelope & {
  knowledgeBaseId: string;
  title: string;
  kind: "url" | "document" | "text";
  status?: V5KnowledgeMaterialStatus;
  summary?: string;
  evidenceExcerpt?: string;
  sourceOwner?: string;
  visibility?: V5KnowledgeVisibility;
  limitation?: string;
  failureReason?: string;
}) {
  assertV5FoundationEnvelope(input, [...knowledgeRoles]);
  assertV5FoundationText(input.title, "资料名称", 180);
  const stored = mutateV5FoundationState({
    operation: "add_knowledge_material",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({
      knowledgeBaseId: input.knowledgeBaseId,
      title: input.title,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      evidenceExcerpt: input.evidenceExcerpt
    }),
    mutate(state) {
      const knowledgeBase = state.knowledgeBases.find((item) => item.knowledgeBaseId === input.knowledgeBaseId);
      if (!knowledgeBase) throw new V5FoundationServiceError("not_found", "知识库不存在。", 404);
      assertV5ExpectedVersion(knowledgeBase.rowVersion, input.expectedVersion);
      const now = new Date().toISOString();
      const materialId = createV5FoundationId("material");
      const materialStatus = input.status || "ready";
      const material = {
        materialId,
        knowledgeBaseId: input.knowledgeBaseId,
        title: input.title.trim(),
        kind: input.kind,
        status: materialStatus,
        importedAt: now,
        updatedAt: now,
        failureReason: materialStatus === "failed" ? input.failureReason || "资料处理失败且无法自动恢复。" : undefined
      };
      state.knowledgeMaterials.push(material);
      if (materialStatus === "ready" && input.summary?.trim()) {
        state.knowledgeUnderstanding.push({
          understandingId: createV5FoundationId("understanding"),
          summary: input.summary.trim(),
          evidenceExcerpt: input.evidenceExcerpt?.trim() || "未提供可展示的原文片段。",
          materialId,
          materialTitle: material.title,
          sourceOwner: input.sourceOwner?.trim() || "未标注",
          visibility: input.visibility || knowledgeBase.defaultVisibility,
          limitation: input.limitation?.trim(),
          trace: {
            source: "material_import",
            sourceIds: [materialId],
            algorithmVersion: V5_KNOWLEDGE_UNDERSTANDING_VERSION,
            confidence: 0.8,
            recordedAt: now
          }
        });
      }
      if (materialStatus === "failed") {
        state.knowledgeActionItems.push({
          actionItemId: createV5FoundationId("knowledge-action"),
          knowledgeBaseId: input.knowledgeBaseId,
          type: "unrecoverable_source_failure",
          title: `资料处理失败：${material.title}`,
          description: material.failureReason || "资料处理失败且无法自动恢复。",
          recommendedAction: "重新上传可读取文件，或提供新的资料地址。",
          affectsProduction: false,
          status: "open",
          rowVersion: 1,
          createdAt: now,
          updatedAt: now
        });
      }
      refreshKnowledgeSummary(state, input.knowledgeBaseId);
      appendV5FoundationAudit(state, {
        action: "knowledge_material_added",
        objectType: "KnowledgeMaterial",
        objectId: materialId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { material, knowledgeBase: buildDetail(state, input.knowledgeBaseId)! };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "created", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function updateV5KnowledgeActionItem(input: V5WriteEnvelope & {
  actionItemId: string;
  status: V5KnowledgeActionStatus;
}) {
  assertV5FoundationEnvelope(input, [...knowledgeRoles]);
  const stored = mutateV5FoundationState({
    operation: "update_knowledge_action_item",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ actionItemId: input.actionItemId, status: input.status }),
    mutate(state) {
      const actionItem = state.knowledgeActionItems.find((item) => item.actionItemId === input.actionItemId);
      if (!actionItem) throw new V5FoundationServiceError("not_found", "待处理事项不存在。", 404);
      assertV5ExpectedVersion(actionItem.rowVersion, input.expectedVersion);
      actionItem.status = input.status;
      actionItem.rowVersion += 1;
      actionItem.updatedAt = new Date().toISOString();
      refreshKnowledgeSummary(state, actionItem.knowledgeBaseId);
      appendV5FoundationAudit(state, {
        action: "knowledge_action_updated",
        objectType: "KnowledgeActionItem",
        objectId: actionItem.actionItemId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { actionItem, knowledgeBase: buildDetail(state, actionItem.knowledgeBaseId)! };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "updated", data: { ...stored.data, stateVersion: stored.stateVersion } };
}
