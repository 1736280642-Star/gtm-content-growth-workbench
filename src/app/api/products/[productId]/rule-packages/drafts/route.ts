import { readString } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5RulePackageDraft } from "@/lib/v5/knowledge-governance-material-service";
import type { V5RuleDraftWriteInput } from "@/lib/v5/knowledge-governance-material-repository";
import type { V5G4ConflictInput, V5G4GapInput } from "@/lib/v5/knowledge-governance-workflow";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { productId: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5RulePackageDraft({
      productId: params.productId,
      draft: (payload.draft || {}) as V5RuleDraftWriteInput,
      conflicts: (Array.isArray(payload.conflicts) ? payload.conflicts : []) as V5G4ConflictInput[],
      gaps: (Array.isArray(payload.gaps) ? payload.gaps : []) as V5G4GapInput[],
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: result.ok ? 201 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
