import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { resolveV5ClaimConflict } from "@/lib/v5/knowledge-governance-review-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await resolveV5ClaimConflict({
      ...readV5WriteEnvelope(payload),
      conflictId: params.id,
      action: readString(payload.action) === "accept_risk" ? "accept_risk" : "resolve",
      selectedClaimId: readString(payload.selectedClaimId),
      applicableVersion: readString(payload.applicableVersion),
      temporaryPolicy: readString(payload.temporaryPolicy) || "use_more_conservative_claim",
      claimDecisions: Array.isArray(payload.claimDecisions)
        ? payload.claimDecisions as Parameters<typeof resolveV5ClaimConflict>[0]["claimDecisions"]
        : [],
      resolutionReason: readString(payload.resolutionReason) || ""
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
