import { randomUUID } from "node:crypto";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import { generateFormalArticle, FormalGenerationError } from "./formal-generation-service";
import type { RagPlatformContentType, RagRetrievalRequest } from "./rag/contracts";
import { readActiveRagIndexSnapshotRecord, readRagMatrixItemContextRecord } from "./rag/rag-repository";
import { createFinalEvidencePack, RagServiceError, retrieveRag } from "./rag/rag-service";
import type { SingleArticleActor, SingleArticleFailure, SingleArticleResult } from "./single-article-contracts";
import {
  claimSingleArticleOperation,
  readCompletedSingleArticleResult,
  readFormalGenerationContext,
  recordSingleArticleEvidence,
  recordSingleArticleFailure
} from "./single-article-production-repository";

export class SingleArticleProductionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = "SingleArticleProductionError";
  }
}

function validateIdempotencyKey(value: string) {
  if (value.length < 8 || value.length > 191) {
    throw new SingleArticleProductionError(400, "invalid_idempotency_key", "x-idempotency-key 必须为 8 到 191 个字符。", "刷新任务后重新点击生成正文。");
  }
}

function normalizeFailure(error: unknown): { status: number; failure: SingleArticleFailure; details?: string[]; recorded: boolean } {
  if (error instanceof SingleArticleProductionError) return { status: error.status, failure: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details }, details: error.details, recorded: false };
  if (error instanceof FormalGenerationError) return { status: error.status, failure: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details }, details: error.details, recorded: error.recorded };
  if (error instanceof RagServiceError) return { status: error.status, failure: { code: error.code, message: error.message, nextAction: error.nextAction || "按提示修复 RAG 前置条件后重试。", details: error.details }, details: error.details, recorded: false };
  if (error instanceof V5GovernanceRepositoryError) return { status: error.httpStatus, failure: { code: error.code, message: error.message, nextAction: error.nextAction || "检查正式数据状态后重试。" }, recorded: false };
  return { status: 500, failure: { code: "single_article_internal_error", message: error instanceof Error ? error.message : "单篇正式生成失败。", nextAction: "查看服务端日志与关联 ID 后重试。" }, recorded: false };
}

function operationFailureStatus(status: number, code: string): "blocked" | "pending_config" | "failed" {
  if (status === 503 || code.includes("pending_config")) return "pending_config";
  if (status === 409 || status === 422 || code.includes("blocked") || code.includes("evidence")) return "blocked";
  return "failed";
}

export async function prepareAndGenerateSingleArticle(input: {
  taskId: string;
  idempotencyKey: string;
  actor: SingleArticleActor;
}): Promise<SingleArticleResult> {
  validateIdempotencyKey(input.idempotencyKey);
  const claimed = await claimSingleArticleOperation(input);
  if (!claimed.claimed) {
    const replay = await readCompletedSingleArticleResult(claimed.operation);
    if (replay) return replay;
    if (claimed.operation.status === "running") {
      throw new SingleArticleProductionError(409, "operation_in_progress", "相同幂等键的正式生成仍在执行。", "等待当前生成完成后刷新队列，不要重复点击。");
    }
    throw new SingleArticleProductionError(
      claimed.operation.status === "pending_config" ? 503 : claimed.operation.status === "blocked" ? 422 : 500,
      claimed.operation.errorCode || "operation_failed",
      claimed.operation.errorMessage || "原正式生成请求失败。",
      claimed.operation.nextAction || "处理失败原因后使用新的幂等键重试。"
    );
  }
  try {
    const matrix = await readRagMatrixItemContextRecord(input.taskId);
    if (!matrix) throw new SingleArticleProductionError(404, "formal_task_not_found", "正式单篇矩阵项不存在。", "运行 Bootstrap 并确认正式任务已写入 MySQL。");
    const snapshot = await readActiveRagIndexSnapshotRecord({ productId: matrix.productId, namespace: "production_public", language: "zh-CN" });
    if (!snapshot) throw new SingleArticleProductionError(409, "active_snapshot_missing", "Pharaoh Command 没有 active production_public IndexSnapshot。", "完成 RAG 索引构建、评测与人工激活后重试。");
    const request: RagRetrievalRequest = {
      retrievalRequestId: `request-${randomUUID()}`,
      matrixItemId: matrix.matrixItemId,
      taskId: matrix.matrixItemId,
      taskVersion: matrix.currentTaskVersion,
      productId: matrix.productId,
      productName: matrix.productName,
      namespace: "production_public",
      language: "zh-CN",
      title: matrix.title,
      channel: matrix.channel,
      contentType: matrix.contentType,
      platformContentType: matrix.platformContentType as RagPlatformContentType,
      targetAudience: matrix.targetAudience,
      sourceProblem: matrix.sourceProblem,
      distilledTermIds: [matrix.primaryDistilledTermId, ...matrix.secondaryDistilledTermIds].filter(Boolean),
      rulePackageVersionId: matrix.rulePackageVersionId,
      permissionScope: ["public"],
      lifecycleStatuses: ["current", "unknown"],
      requestedAt: new Date().toISOString()
    };
    const retrievalRun = await retrieveRag({ request, indexSnapshotId: snapshot.indexSnapshotId, actor: input.actor });
    const pack = await createFinalEvidencePack({ retrievalRunId: retrievalRun.retrievalRunId, actor: input.actor });
    await recordSingleArticleEvidence({ operationId: claimed.operation.operationId, retrievalRunId: retrievalRun.retrievalRunId, finalEvidencePackId: pack.evidencePackId, actor: input.actor });
    if (pack.decision !== "generatable") {
      throw new SingleArticleProductionError(422, "evidence_not_generatable", `Final EvidencePack 决策为 ${pack.decision}，未调用正文模型。`, "按 EvidencePack 缺口补资料或完成复核后，使用新幂等键重试。", [...pack.gaps, ...pack.conflicts, ...pack.outdatedEvidence, ...pack.unverifiedClaims]);
    }
    const context = await readFormalGenerationContext(input.taskId);
    const packTask = pack.taskSnapshot;
    const snapshotMatches = pack.indexSnapshotIds.length === 1 && pack.indexSnapshotIds[0] === snapshot.indexSnapshotId;
    const taskMatches = pack.taskId === context.taskId && pack.taskVersion === context.taskVersion;
    const ruleMatches = context.rulePackageVersionId === pack.rulePackageVersionId
      && String(packTask.promptGroupId || "") === context.promptGroupId
      && String(packTask.promptGroupVersionId || "") === context.promptGroupVersionId
      && String(packTask.channelRuleVersionId || "") === context.channelRuleVersionId;
    if (!snapshotMatches || !taskMatches || !ruleMatches) {
      throw new SingleArticleProductionError(
        409,
        "formal_snapshot_mismatch",
        "正式生成上下文与 Final EvidencePack 的任务、规则或 active Snapshot 不一致。",
        "重新冻结矩阵项和 Final EvidencePack 后重试。",
        [
          ...(snapshotMatches ? [] : ["active_snapshot_mismatch"]),
          ...(taskMatches ? [] : ["task_version_mismatch"]),
          ...(ruleMatches ? [] : ["formal_rule_version_mismatch"])
        ]
      );
    }
    const result = await generateFormalArticle({ operationId: claimed.operation.operationId, idempotencyKey: input.idempotencyKey, pack, context, actor: input.actor });
    return {
      operationId: claimed.operation.operationId,
      correlationId: claimed.operation.correlationId,
      replayed: false,
      retrievalRunId: retrievalRun.retrievalRunId,
      finalEvidencePackId: pack.evidencePackId,
      evidenceDecision: "generatable",
      ...result
    };
  } catch (error) {
    const normalized = normalizeFailure(error);
    if (!normalized.recorded) {
      await recordSingleArticleFailure({ operationId: claimed.operation.operationId, status: operationFailureStatus(normalized.status, normalized.failure.code), failure: normalized.failure, actor: input.actor });
    }
    throw new SingleArticleProductionError(normalized.status, normalized.failure.code, normalized.failure.message, normalized.failure.nextAction, normalized.details);
  }
}
