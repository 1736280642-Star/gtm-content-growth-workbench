import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { evaluateV5GovernanceRunGate } from "@/lib/v5/knowledge-governance-service";
import type { V5GateCode } from "@/lib/v5/knowledge-governance-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string; gate: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await evaluateV5GovernanceRunGate({
      ...readV5WriteEnvelope(payload),
      runId: params.id,
      gate: params.gate.toUpperCase() as V5GateCode,
      gateInput: payload.input,
      evaluatorVersion: readString(payload.evaluatorVersion)
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
