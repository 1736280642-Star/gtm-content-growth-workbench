import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { activateV5MonthlyProductionPoolEntry } from "@/lib/v5/knowledge-governance-production-pool-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { productId: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await activateV5MonthlyProductionPoolEntry({
      ...readV5WriteEnvelope(payload),
      productId: params.productId,
      monthlyPlanId: readString(payload.monthlyPlanId) || "",
      monthlyQuota: typeof payload.monthlyQuota === "number" ? payload.monthlyQuota : Number.NaN
    });
    return NextResponse.json(result);
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
