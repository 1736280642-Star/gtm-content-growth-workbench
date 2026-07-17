import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { evaluateV5MonthlyProductionReadiness } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { productId: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await evaluateV5MonthlyProductionReadiness({
      ...readV5WriteEnvelope(payload),
      productId: params.productId,
      governanceRunId: readString(payload.governanceRunId),
      evaluatorVersion: readString(payload.evaluatorVersion)
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
