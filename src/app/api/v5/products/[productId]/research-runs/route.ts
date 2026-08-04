import { readString } from "@/lib/api-utils";
import {
  readV5Actor,
  readV5GovernancePayload,
  v5GovernanceErrorResponse
} from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchWorkspace, startGeoResearchRun } from "@/lib/v5/geo-research-service";
import type { GeoResearchRun } from "@/lib/v5/geo-research-contracts";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const payload = await readV5GovernancePayload(request);
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim()
      || readString(payload.idempotencyKey)
      || "";
    const trigger = readString(payload.triggerType);
    const result = await startGeoResearchRun({
      productId: routeParams.productId,
      triggerType: trigger as GeoResearchRun["triggerType"] | undefined,
      expectedProjectVersion: typeof payload.expectedProjectVersion === "number"
        ? payload.expectedProjectVersion
        : Number.NaN,
      idempotencyKey,
      actor: readV5Actor(payload)
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 202 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
