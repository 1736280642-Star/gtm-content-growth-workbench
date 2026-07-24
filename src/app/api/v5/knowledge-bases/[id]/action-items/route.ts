import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { getV5KnowledgeBaseDetail } from "@/lib/v5/knowledge-workspace-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const result = getV5KnowledgeBaseDetail(params.id);
    return NextResponse.json({ ok: true, status: "success", data: { actionItems: result.data.knowledgeBase.actionItems, stateVersion: result.data.stateVersion } });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
