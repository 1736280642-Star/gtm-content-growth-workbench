import { readString, readStringArray } from "@/lib/api-utils";
import {
  readV5Actor,
  readV5GovernancePayload,
  v5GovernanceErrorResponse
} from "@/lib/v5/knowledge-governance-api";
import { createGeoResearchProjectForProduct, updateGeoResearchProject } from "@/lib/v5/geo-research-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createGeoResearchProjectForProduct({
      productId: routeParams.productId,
      expressionFocus: readString(payload.expressionFocus) || "",
      forbiddenFocus: readStringArray(payload.forbiddenFocus),
      researchMarkets: readStringArray(payload.researchMarkets),
      languages: readStringArray(payload.languages),
      targetChannels: readStringArray(payload.targetChannels),
      idempotencyKey: request.headers.get("x-idempotency-key")?.trim()
        || readString(payload.idempotencyKey)
        || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await updateGeoResearchProject({
      productId: routeParams.productId,
      expectedProjectVersion: typeof payload.expectedProjectVersion === "number"
        ? payload.expectedProjectVersion
        : Number.NaN,
      expressionFocus: readString(payload.expressionFocus) || "",
      forbiddenFocus: readStringArray(payload.forbiddenFocus),
      researchMarkets: readStringArray(payload.researchMarkets),
      languages: readStringArray(payload.languages),
      targetChannels: readStringArray(payload.targetChannels),
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
