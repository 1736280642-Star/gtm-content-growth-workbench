import { NextResponse } from "next/server";
import type { CreateFreeExpressionInput } from "@/lib/v5/free-production-contracts";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { createFreeContentExpressionType, listFreeContentExpressionTypes } from "@/lib/v5/free-content-expression-type-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ ok: true, data: await listFreeContentExpressionTypes() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return freeProductionErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await createFreeContentExpressionType({ ...readFreeProductionMutation(payload), input: payload.input as CreateFreeExpressionInput }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return freeProductionErrorResponse(error); }
}
