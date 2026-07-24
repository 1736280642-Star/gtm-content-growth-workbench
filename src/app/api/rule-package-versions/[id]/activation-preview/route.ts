import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { previewV5RulePackageActivation } from "@/lib/v5/knowledge-governance-review-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await previewV5RulePackageActivation(params.id));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
