import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { supplementFreeProductionBatch } from "@/lib/v5/free-production-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await supplementFreeProductionBatch(routeParams.id, { ...readFreeProductionMutation(payload), supplements: Array.isArray(payload.supplements) ? payload.supplements as Array<{ riskId: string; value: string | { fileName: string; mimeType: string; dataBase64: string } }> : [] }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
