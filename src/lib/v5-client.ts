"use client";

import type { WorkspaceRole } from "./types";

export function createV5WritePayload(role: WorkspaceRole, expectedVersion: number, auditReason: string) {
  return {
    idempotencyKey: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedVersion,
    actorId: `local-${role}`,
    actorRole: role,
    actorType: "human",
    auditReason
  };
}
