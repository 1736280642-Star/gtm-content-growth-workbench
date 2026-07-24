import { NextResponse } from "next/server";
import type { WorkspaceRole } from "../types";
import { V5FoundationRepositoryError } from "./foundation-repository";
import type { V5GovernanceActor } from "./knowledge-governance-repository";
import type { V5WriteEnvelope } from "./knowledge-governance-service";

export class V5FoundationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly nextAction?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "V5FoundationServiceError";
  }
}

export function assertV5FoundationText(value: unknown, field: string, maxLength = 500): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new V5FoundationServiceError("invalid_contract", `缺少 ${field}。`, 400, `补充 ${field} 后重试。`);
  }
  if (value.trim().length > maxLength) {
    throw new V5FoundationServiceError("invalid_contract", `${field}不能超过 ${maxLength} 个字符。`, 400);
  }
}

export function assertV5FoundationActor(actor: V5GovernanceActor, allowedRoles: WorkspaceRole[]) {
  if (!actor || typeof actor !== "object") {
    throw new V5FoundationServiceError("invalid_contract", "缺少操作人信息。", 400, "刷新页面后重试。");
  }
  assertV5FoundationText(actor.actorId, "actorId", 120);
  assertV5FoundationText(actor.actorRole, "actorRole", 80);
  assertV5FoundationText(actor.auditReason, "auditReason", 300);
  if (!allowedRoles.includes(actor.actorRole as WorkspaceRole)) {
    throw new V5FoundationServiceError(
      "permission_denied",
      "当前角色没有执行此操作的权限。",
      403,
      "切换到具备对应对象管理权限的角色后重试。"
    );
  }
}

export function assertV5FoundationEnvelope(input: V5WriteEnvelope, allowedRoles: WorkspaceRole[]) {
  assertV5FoundationText(input.idempotencyKey, "idempotencyKey", 160);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new V5FoundationServiceError(
      "invalid_contract",
      "expectedVersion 必须是非负整数。",
      400,
      "刷新页面读取最新版本后重试。"
    );
  }
  assertV5FoundationActor(input.actor, allowedRoles);
}

export function assertV5ExpectedVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw new V5FoundationServiceError(
      "version_conflict",
      "数据已被其他操作更新。",
      409,
      "刷新页面读取最新版本，确认变化后再提交。",
      { expectedVersion: expected, actualVersion: actual }
    );
  }
}

export function toV5FoundationError(error: unknown) {
  if (error instanceof V5FoundationServiceError || error instanceof V5FoundationRepositoryError) {
    return {
      ok: false as const,
      status: "failed" as const,
      code: error.code,
      message: error.message,
      nextAction: error.nextAction,
      details: error instanceof V5FoundationServiceError ? error.details : undefined,
      httpStatus: error.httpStatus
    };
  }
  return {
    ok: false as const,
    status: "failed" as const,
    code: "unexpected_error",
    message: error instanceof Error ? error.message : "V5 基础能力发生未知错误。",
    nextAction: "刷新后重试；若仍失败，请查看服务端日志和审计记录。",
    httpStatus: 500
  };
}

export function v5FoundationErrorResponse(error: unknown) {
  const result = toV5FoundationError(error);
  return NextResponse.json(result, { status: result.httpStatus });
}
