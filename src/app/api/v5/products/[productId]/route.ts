import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchWorkspace } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { productId: string } }
) {
  try {
    return NextResponse.json({ ok: true, ...(await getGeoResearchWorkspace(params.productId)) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
