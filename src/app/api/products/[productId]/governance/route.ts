import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getV5ProductGovernanceSummary } from "@/lib/v5/knowledge-governance-material-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { productId: string } }) {
  try {
    return NextResponse.json(await getV5ProductGovernanceSummary(params.productId));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
