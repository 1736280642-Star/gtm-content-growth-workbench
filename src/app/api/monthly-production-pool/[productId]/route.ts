import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getV5MonthlyProductionPool } from "@/lib/v5/knowledge-governance-production-pool-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { productId: string } }) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await getV5MonthlyProductionPool({
      productId: params.productId,
      monthlyPlanId: url.searchParams.get("monthlyPlanId") || undefined
    }));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
