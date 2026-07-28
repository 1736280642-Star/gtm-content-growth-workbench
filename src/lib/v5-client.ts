"use client";

import { WORKSPACE_ACTOR } from "./workspace-actor";

export function createV5WritePayload(expectedVersion: number, auditReason: string) {
  return {
    idempotencyKey: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedVersion,
    ...WORKSPACE_ACTOR,
    auditReason
  };
}
