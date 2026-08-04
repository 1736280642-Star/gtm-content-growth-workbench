import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { getV5KnowledgeBaseDetail } from "@/lib/v5/knowledge-workspace-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    return NextResponse.json(getV5KnowledgeBaseDetail(routeParams.id));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
