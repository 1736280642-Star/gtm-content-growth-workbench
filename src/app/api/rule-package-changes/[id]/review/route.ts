import { readString, readStringArray } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { reviewV5RulePackageChange } from "@/lib/v5/knowledge-governance-review-service";
import type { V5ApprovalAction, V5GovernanceRole } from "@/lib/v5/knowledge-governance-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await reviewV5RulePackageChange({
      ...readV5WriteEnvelope(payload),
      changeId: params.id,
      role: (readString(payload.role) || "knowledge_manager") as V5GovernanceRole,
      action: (readString(payload.action) || "approve") as V5ApprovalAction,
      reason: readString(payload.reason) || "",
      evidenceSourceIds: readStringArray(payload.evidenceSourceIds) || []
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
