import { readString } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { extractV5ProductClaims } from "@/lib/v5/knowledge-governance-material-service";
import type { V5ClaimWriteInput } from "@/lib/v5/knowledge-governance-material-repository";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const claims = Array.isArray(payload.claims) ? payload.claims as V5ClaimWriteInput[] : [];
    if (claims.some((claim) => claim.sourceId !== params.id)) {
      return NextResponse.json({ ok: false, status: "failed", code: "source_mismatch", message: "Claim sourceId 与路由来源不一致。" }, { status: 400 });
    }
    const result = await extractV5ProductClaims({
      sourceRevisionId: readString(payload.sourceRevisionId) || "",
      claims,
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: result.ok ? 201 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
