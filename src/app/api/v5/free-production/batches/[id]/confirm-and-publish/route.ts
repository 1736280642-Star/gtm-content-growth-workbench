import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { confirmAndPublishFreeProductionBatch } from "@/lib/v5/free-production-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await confirmAndPublishFreeProductionBatch(routeParams.id, { ...readFreeProductionMutation(payload), contentDigest: typeof payload.contentDigest === "string" ? payload.contentDigest : "" }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
