import { NextResponse } from "next/server";
import { FreeContentExpressionTypeServiceError } from "./free-content-expression-type-service";
import { FreeProductionServiceError } from "./free-production-service";

export async function readFreeProductionPayload(request: Request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid payload");
    return value as Record<string, unknown>;
  } catch {
    throw new FreeProductionServiceError(400, "INVALID_REQUEST_BODY", "请求正文必须是 JSON 对象。", "刷新页面后重新提交。");
  }
}

export function readFreeProductionMutation(payload: Record<string, unknown>) {
  if (!Number.isInteger(payload.expectedVersion)) {
    throw new FreeProductionServiceError(400, "INVALID_EXPECTED_VERSION", "expectedVersion 必须是整数。", "刷新页面读取最新版本后重试。");
  }
  return {
    expectedVersion: Number(payload.expectedVersion),
    auditReason: typeof payload.auditReason === "string" ? payload.auditReason : ""
  };
}

export function freeProductionErrorResponse(error: unknown) {
  if (error instanceof FreeProductionServiceError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details } }, { status: error.status });
  }
  if (error instanceof FreeContentExpressionTypeServiceError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.details?.[0], details: error.details } }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: { code: "FREE_PRODUCTION_INTERNAL_ERROR", message: "自由内容生产服务发生未知错误。", nextAction: "刷新后重试；若仍失败，请查看服务端日志。" } }, { status: 500 });
}
