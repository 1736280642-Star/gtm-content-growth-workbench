import { readString, readStringArray } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { reviewV5ProductClaim } from "@/lib/v5/knowledge-governance-material-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const reviewStatus = readString(payload.reviewStatus);
    const result = await reviewV5ProductClaim({
      ...readV5WriteEnvelope(payload),
      claimId: params.id,
      reviewStatus: reviewStatus === "conditional" || reviewStatus === "rejected" ? reviewStatus : "supported",
      conditions: readStringArray(payload.conditions),
      limitations: readStringArray(payload.limitations)
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
