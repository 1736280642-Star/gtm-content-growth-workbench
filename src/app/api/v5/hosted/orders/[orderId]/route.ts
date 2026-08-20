import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getHostedPromotionOrder } from "@/lib/v5/hosted-managed-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    return NextResponse.json(
      { ok: true, ...(await getHostedPromotionOrder(orderId)) },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
