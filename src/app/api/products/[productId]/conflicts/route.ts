import { readString, readStringArray } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5ClaimConflict } from "@/lib/v5/knowledge-governance-material-service";
import type { V5EvidenceGapSeverity, V5GovernanceRole } from "@/lib/v5/knowledge-governance-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { productId: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5ClaimConflict({
      conflictId: readString(payload.conflictId),
      productId: params.productId,
      conflictType: readString(payload.conflictType) || "value_conflict",
      subject: readString(payload.subject) || "",
      claimIds: readStringArray(payload.claimIds) || [],
      sourceIds: readStringArray(payload.sourceIds) || [],
      preferredTemporaryClaimId: readString(payload.preferredTemporaryClaimId),
      temporaryPolicy: readString(payload.temporaryPolicy) || "use_more_conservative_claim",
      severity: (readString(payload.severity) || "warning") as V5EvidenceGapSeverity,
      requiredRoles: (readStringArray(payload.requiredRoles) || []) as V5GovernanceRole[],
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
