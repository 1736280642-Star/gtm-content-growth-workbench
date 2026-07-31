import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchRunDetails } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { productId: string; runId: string } }
) {
  try {
    return NextResponse.json({
      ok: true,
      ...(await getGeoResearchRunDetails({
        productId: params.productId,
        runId: params.runId
      }))
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
