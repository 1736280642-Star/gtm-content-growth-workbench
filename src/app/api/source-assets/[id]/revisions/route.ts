import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5SourceRevision } from "@/lib/v5/knowledge-governance-material-service";
import type { V5G1Input } from "@/lib/v5/knowledge-governance-workflow";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5SourceRevision({
      ...readV5WriteEnvelope(payload),
      sourceId: params.id,
      g1: (payload.g1 || {}) as V5G1Input,
      revision: (payload.revision || {}) as Parameters<typeof createV5SourceRevision>[0]["revision"]
    });
    return NextResponse.json(result, { status: result.ok ? 201 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
