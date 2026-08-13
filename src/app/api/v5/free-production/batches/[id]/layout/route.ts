import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { selectFreeProductionWechatLayout } from "@/lib/v5/free-production-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await selectFreeProductionWechatLayout(routeParams.id, {
      ...readFreeProductionMutation(payload),
      artifactId: typeof payload.artifactId === "string" ? payload.artifactId : "",
      templateId: typeof payload.templateId === "string" ? payload.templateId : ""
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
