import { readString, readStringArray } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5EvidenceGap } from "@/lib/v5/knowledge-governance-material-service";
import type { V5EvidenceGapSeverity, V5GovernanceRole } from "@/lib/v5/knowledge-governance-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { productId: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5EvidenceGap({
      gapId: readString(payload.gapId),
      productId: params.productId,
      gapCode: readString(payload.gapCode) || "",
      title: readString(payload.title) || "",
      description: readString(payload.description),
      affectedRuleFields: readStringArray(payload.affectedRuleFields) || [],
      affectedClaimTypes: readStringArray(payload.affectedClaimTypes) || [],
      triggerSourceIds: readStringArray(payload.triggerSourceIds) || [],
      severity: (readString(payload.severity) || "warning") as V5EvidenceGapSeverity,
      recommendedAction: readString(payload.recommendedAction) || "",
      ownerRole: (readString(payload.ownerRole) || "knowledge_manager") as V5GovernanceRole,
      dueAt: readString(payload.dueAt),
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
