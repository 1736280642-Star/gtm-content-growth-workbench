import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { activateV5RulePackageVersion } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await activateV5RulePackageVersion({ ...readV5WriteEnvelope(payload), rulePackageVersionId: routeParams.id });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
