import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { activateFreeContentExpressionType } from "@/lib/v5/free-content-expression-type-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ ok: true, data: await activateFreeContentExpressionType(params.id, readFreeProductionMutation(await readFreeProductionPayload(request)), request.headers.get("x-idempotency-key")) }); }
  catch (error) { return freeProductionErrorResponse(error); }
}
