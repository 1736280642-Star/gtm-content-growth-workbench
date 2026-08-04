import { readRequestPayload, readString } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { toV5GovernanceError, V5GovernanceServiceError, type V5WriteEnvelope } from "./knowledge-governance-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";

export function readTrustedServerActor(defaultRole = "developer_admin"): V5GovernanceActor | undefined {
  if (process.env.V5_TRUSTED_SERVER_WRITES_ENABLED !== "true") return undefined;
  const actorId = String(process.env.V5_TRUSTED_SERVER_ACTOR_ID || "").trim();
  const actorRole = String(process.env.V5_TRUSTED_SERVER_ACTOR_ROLE || defaultRole).trim();
  if (!actorId || !actorRole) return undefined;
  return { actorId, actorRole, actorType: "human", auditReason: "由工作台可信服务端身份发起写入" };
}

export async function readV5GovernancePayload(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const actor = readTrustedServerActor();
    if (!actor) {
      throw new V5GovernanceServiceError(
        "authorization_not_configured",
        "当前 Docker 生产环境未配置工作台可信身份，系统已阻止写入以避免伪造操作人。",
        503,
        "配置 V5_TRUSTED_SERVER_WRITES_ENABLED、服务端操作人和角色后重启 Web。生产环境拒绝使用请求体自报角色。"
      );
    }
    const payload = await readRequestPayload(request);
    return { ...payload, actorId: actor.actorId, actorRole: actor.actorRole, actorType: actor.actorType };
  }
  return readRequestPayload(request);
}

export function readV5Actor(payload: Record<string, unknown>): V5GovernanceActor {
  const actorType = readString(payload.actorType);
  return {
    actorId: readString(payload.actorId) || "",
    actorRole: readString(payload.actorRole) || "",
    actorType: actorType === "agent" || actorType === "scheduler" || actorType === "system" ? actorType : "human",
    auditReason: readString(payload.auditReason) || ""
  };
}

export function readV5WriteEnvelope(payload: Record<string, unknown>): V5WriteEnvelope {
  return {
    idempotencyKey: readString(payload.idempotencyKey) || "",
    expectedVersion: typeof payload.expectedVersion === "number" ? payload.expectedVersion : Number.NaN,
    actor: readV5Actor(payload)
  };
}

export function v5GovernanceErrorResponse(error: unknown) {
  const result = toV5GovernanceError(error);
  return NextResponse.json(
    {
      ok: result.ok,
      status: result.status,
      code: result.code,
      message: result.message,
      nextAction: result.nextAction,
      details: result.details
    },
    { status: result.httpStatus }
  );
}
