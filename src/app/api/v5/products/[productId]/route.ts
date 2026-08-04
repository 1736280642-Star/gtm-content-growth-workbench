import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchWorkspace } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    return NextResponse.json({ ok: true, ...(await getGeoResearchWorkspace(routeParams.productId)) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
