import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { bindFreeProductionVisualAsset } from "@/lib/v5/free-production-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await bindFreeProductionVisualAsset(routeParams.id, {
      ...readFreeProductionMutation(payload),
      artifactId: typeof payload.artifactId === "string" ? payload.artifactId : "",
      suggestionId: typeof payload.suggestionId === "string" ? payload.suggestionId : "",
      mediaAssetId: typeof payload.mediaAssetId === "string" ? payload.mediaAssetId : undefined
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
