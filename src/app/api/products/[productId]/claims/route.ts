import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { listV5ProductClaims } from "@/lib/v5/knowledge-governance-review-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { productId: string } }) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listV5ProductClaims({
      productId: params.productId,
      reviewStatus: url.searchParams.get("reviewStatus") || undefined,
      claimType: url.searchParams.get("claimType") || undefined
    }));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
