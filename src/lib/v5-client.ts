"use client";

import { WORKSPACE_ACTOR } from "./workspace-actor";
import type { WorkspaceRole } from "./types";

export function createV5WritePayload(expectedVersion: number, auditReason: string): ReturnType<typeof buildV5WritePayload>;
export function createV5WritePayload(role: WorkspaceRole | undefined, expectedVersion: number, auditReason: string): ReturnType<typeof buildV5WritePayload>;
export function createV5WritePayload(roleOrVersion: WorkspaceRole | number | undefined, versionOrReason: number | string, possibleReason?: string) {
  const role = typeof roleOrVersion === "string" ? roleOrVersion : undefined;
  const expectedVersion = typeof roleOrVersion === "number" ? roleOrVersion : Number(versionOrReason);
  const auditReason = typeof versionOrReason === "string" ? versionOrReason : String(possibleReason || "");
  return buildV5WritePayload(expectedVersion, auditReason, role);
}

function buildV5WritePayload(expectedVersion: number, auditReason: string, role?: WorkspaceRole) {
  return {
    idempotencyKey: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedVersion,
    ...WORKSPACE_ACTOR,
    ...(role ? { actorId: `local-${role}`, actorRole: role } : {}),
    auditReason
  };
}
