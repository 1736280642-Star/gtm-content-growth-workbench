import { readString } from "@/lib/api-utils";
import {
  readV5Actor,
  readV5GovernancePayload,
  v5GovernanceErrorResponse
} from "@/lib/v5/knowledge-governance-api";
import { requestGeoBlueprintChanges } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { productId: string; blueprintId: string } }
) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await requestGeoBlueprintChanges({
      productId: params.productId,
      blueprintVersionId: params.blueprintId,
      expectedVersion: typeof payload.expectedVersion === "number" ? payload.expectedVersion : Number.NaN,
      reviewNote: readString(payload.reviewNote) || "",
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
