import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchRunDetails } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string; runId: string }> }
) {
  const routeParams = await params;
  try {
    return NextResponse.json({
      ok: true,
      ...(await getGeoResearchRunDetails({
        productId: routeParams.productId,
        runId: routeParams.runId
      }))
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
