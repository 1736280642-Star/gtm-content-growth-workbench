import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { selectWechatCoverCandidate } from "@/lib/v5/wechat-visual-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await selectWechatCoverCandidate(routeParams.id, {
      ...readFreeProductionMutation(payload),
      artifactId: typeof payload.artifactId === "string" ? payload.artifactId : "",
      planId: typeof payload.planId === "string" ? payload.planId : "",
      candidateId: typeof payload.candidateId === "string" ? payload.candidateId : ""
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
