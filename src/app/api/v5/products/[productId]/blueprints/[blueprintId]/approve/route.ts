import { readString } from "@/lib/api-utils";
import {
  readV5Actor,
  readV5GovernancePayload,
  v5GovernanceErrorResponse
} from "@/lib/v5/knowledge-governance-api";
import { approveGeoBlueprint } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; blueprintId: string }> }
) {
  const routeParams = await params;
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await approveGeoBlueprint({
      productId: routeParams.productId,
      blueprintVersionId: routeParams.blueprintId,
      expectedVersion: typeof payload.expectedVersion === "number" ? payload.expectedVersion : Number.NaN,
      idempotencyKey: request.headers.get("x-idempotency-key")?.trim()
        || readString(payload.idempotencyKey)
        || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
