import { readRequestPayload, readString, readStringArray } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { V5GovernanceRepositoryError, type V5GovernanceActor } from "../knowledge-governance-repository";
import { readTrustedServerActor } from "../knowledge-governance-api";
import { RagInfrastructureError } from "./infrastructure";
import { RagServiceError } from "./rag-service";

export async function readRagPayload(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const actor = readTrustedServerActor("rag_operator");
    if (!actor) throw new RagServiceError(503, "authorization_not_configured", "RAG 写入尚未配置工作台可信身份。", "完成 Docker 服务端身份配置后重启 Web。");
    const payload = await readRequestPayload(request);
    return { ...payload, actorId: actor.actorId, actorRole: actor.actorRole, actorType: actor.actorType };
  }
  return readRequestPayload(request);
}

export function readRagActor(payload: Record<string, unknown>): V5GovernanceActor {
  const actorType = readString(payload.actorType);
  return {
    actorId: readString(payload.actorId) || "",
    actorRole: readString(payload.actorRole) || "",
    actorType: actorType === "agent" || actorType === "scheduler" || actorType === "system" ? actorType : "human",
    auditReason: readString(payload.auditReason) || ""
  };
}

export function strings(value: unknown) { return readStringArray(value) || []; }
export function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function ragErrorResponse(error: unknown) {
  if (error instanceof RagServiceError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details } }, { status: error.status });
  if (error instanceof RagInfrastructureError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: "补齐缺失配置后重试。", details: error.missingConfig } }, { status: 503 });
  if (error instanceof V5GovernanceRepositoryError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction } }, { status: error.httpStatus });
  const message = error instanceof Error ? error.message : "RAG 请求处理失败。";
  return NextResponse.json({ ok: false, error: { code: "rag_internal_error", message, nextAction: "查看服务端日志与审计记录后重试。" } }, { status: 500 });
}
