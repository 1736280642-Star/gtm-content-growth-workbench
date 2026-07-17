import { readString, readStringArray } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { updateV5EvidenceGap } from "@/lib/v5/knowledge-governance-review-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const action = readString(payload.action);
    const result = await updateV5EvidenceGap({
      ...readV5WriteEnvelope(payload),
      gapId: params.id,
      action: action === "resolve" || action === "accept_risk" || action === "reopen" ? action : "start",
      resolvedBySourceIds: readStringArray(payload.resolvedBySourceIds) || [],
      resolutionNote: readString(payload.resolutionNote) || ""
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
