import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { retryFreeProductionFailures } from "@/lib/v5/free-production-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const data = await retryFreeProductionFailures(params.id, readFreeProductionMutation(await readFreeProductionPayload(request)), request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
