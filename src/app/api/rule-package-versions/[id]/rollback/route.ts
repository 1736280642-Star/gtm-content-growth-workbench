import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { rollbackV5RulePackageVersion } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await rollbackV5RulePackageVersion({
      ...readV5WriteEnvelope(payload),
      rulePackageVersionId: params.id,
      targetRulePackageVersionId: readString(payload.targetRulePackageVersionId) || "",
      targetExpectedVersion: typeof payload.targetExpectedVersion === "number" ? payload.targetExpectedVersion : Number.NaN
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
