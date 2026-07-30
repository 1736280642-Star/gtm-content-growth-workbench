import { createHash } from "node:crypto";

const MANAGED_REFERENCE_PREFIX = "mysql://source-revision/";

export function buildManagedSourceRevisionId(sourceId: string, contentHash: string) {
  return `src-rev-${createHash("sha256").update(`${sourceId}:${contentHash}`).digest("hex").slice(0, 40)}`;
}

export function buildManagedNormalizedTextRef(sourceRevisionId: string) {
  return `${MANAGED_REFERENCE_PREFIX}${sourceRevisionId}/normalized`;
}

export function buildManagedRawAssetRef(sourceRevisionId: string) {
  return `${MANAGED_REFERENCE_PREFIX}${sourceRevisionId}/raw`;
}

export function parseManagedNormalizedTextRef(reference: string) {
  if (!reference.startsWith(MANAGED_REFERENCE_PREFIX) || !reference.endsWith("/normalized")) return undefined;
  const sourceRevisionId = reference.slice(MANAGED_REFERENCE_PREFIX.length, -"/normalized".length);
  return /^[a-zA-Z0-9_-]{1,64}$/.test(sourceRevisionId) ? sourceRevisionId : undefined;
}
