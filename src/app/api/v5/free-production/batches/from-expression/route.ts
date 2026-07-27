import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { createFreeProductionFromExpression } from "@/lib/v5/free-production-service";

export async function POST(request: Request) {
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await createFreeProductionFromExpression({ ...readFreeProductionMutation(payload), expressionTypeVersionId: typeof payload.expressionTypeVersionId === "string" ? payload.expressionTypeVersionId : "" }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return freeProductionErrorResponse(error); }
}
