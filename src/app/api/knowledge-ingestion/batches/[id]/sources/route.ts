import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { registerV5SourceAssets } from "@/lib/v5/knowledge-governance-material-service";
import type { V5SourceRegistrationInput } from "@/lib/v5/knowledge-governance-material-repository";
import type { V5G0Input } from "@/lib/v5/knowledge-governance-workflow";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const sources = Array.isArray(payload.sources) ? payload.sources as Array<V5SourceRegistrationInput & { g0: V5G0Input }> : [];
    const result = await registerV5SourceAssets({ ...readV5WriteEnvelope(payload), batchId: params.id, sources });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
