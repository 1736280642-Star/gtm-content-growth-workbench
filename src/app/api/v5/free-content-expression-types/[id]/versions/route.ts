import { NextResponse } from "next/server";
import type { FreeContentExpressionTypeDraftInput } from "@/lib/v5/free-production-contracts";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { createFreeContentExpressionTypeVersion } from "@/lib/v5/free-content-expression-type-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await createFreeContentExpressionTypeVersion(params.id, { ...readFreeProductionMutation(payload), input: payload.input as FreeContentExpressionTypeDraftInput }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return freeProductionErrorResponse(error); }
}
