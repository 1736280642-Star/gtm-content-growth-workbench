import { readRequestPayload, readString } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { toV5GovernanceError, V5GovernanceServiceError, type V5WriteEnvelope } from "./knowledge-governance-service";
import type { V5GovernanceActor } from "./knowledge-governance-repository";

export async function readV5GovernancePayload(request: Request) {
  if (process.env.NODE_ENV === "production") {
    throw new V5GovernanceServiceError(
      "authorization_not_configured",
      "V5 治理写接口尚未接入可信服务端身份，生产环境拒绝使用请求体自报角色。",
      503,
      "接入服务端 Session / SSO 身份与对象范围授权后，再启用生产写入。"
    );
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
