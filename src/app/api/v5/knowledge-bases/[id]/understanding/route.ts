import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { getV5KnowledgeBaseDetail } from "@/lib/v5/knowledge-workspace-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const result = getV5KnowledgeBaseDetail(routeParams.id);
    return NextResponse.json({ ok: true, status: "success", data: { understanding: result.data.knowledgeBase.understanding, stateVersion: result.data.stateVersion } });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
