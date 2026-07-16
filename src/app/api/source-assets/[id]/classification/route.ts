import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { classifyV5SourceAsset } from "@/lib/v5/knowledge-governance-material-service";
import type { V5G2Input } from "@/lib/v5/knowledge-governance-workflow";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await classifyV5SourceAsset({
      ...readV5WriteEnvelope(payload),
      sourceId: params.id,
      g2: (payload.g2 || {}) as V5G2Input,
      classification: (payload.classification || {}) as Parameters<typeof classifyV5SourceAsset>[0]["classification"]
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
