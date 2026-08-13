import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { editFreeProductionArticle } from "@/lib/v5/free-production-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const data = await editFreeProductionArticle(routeParams.id, {
      ...readFreeProductionMutation(payload),
      artifactId: typeof payload.artifactId === "string" ? payload.artifactId : "",
      title: typeof payload.title === "string" ? payload.title : "",
      summary: typeof payload.summary === "string" ? payload.summary : "",
      articleBody: typeof payload.articleBody === "string" ? payload.articleBody : ""
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
