import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { recheckFreeProductionBatch } from "@/lib/v5/free-production-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try { return NextResponse.json({ ok: true, data: await recheckFreeProductionBatch(routeParams.id, readFreeProductionMutation(await readFreeProductionPayload(request)), request.headers.get("x-idempotency-key")) }); }
  catch (error) { return freeProductionErrorResponse(error); }
}
