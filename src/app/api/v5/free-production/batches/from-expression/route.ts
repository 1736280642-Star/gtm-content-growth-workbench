import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import type { FreeProductionFactInput } from "@/lib/v5/free-production-contracts";
import { createFreeProductionFromExpression } from "@/lib/v5/free-production-service";

export async function POST(request: Request) {
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await createFreeProductionFromExpression({
      ...readFreeProductionMutation(payload),
      expressionTypeVersionId: typeof payload.expressionTypeVersionId === "string" ? payload.expressionTypeVersionId : "",
      productId: typeof payload.productId === "string" ? payload.productId : undefined,
      knowledgeSnapshotIds: Array.isArray(payload.knowledgeSnapshotIds) ? payload.knowledgeSnapshotIds.filter((item): item is string => typeof item === "string") : [],
      expressionFocus: typeof payload.expressionFocus === "string" ? payload.expressionFocus : "",
      factItems: Array.isArray(payload.factItems) ? payload.factItems as FreeProductionFactInput[] : [],
      meetingText: typeof payload.meetingText === "string" ? payload.meetingText : undefined
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return freeProductionErrorResponse(error); }
}
