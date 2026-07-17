import { readRequestPayload } from "@/lib/api-utils";
import { createContentTaskFromGeoGap, createKnowledgeBaseFromGeoGap } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "create_task";
  const result = action === "create_knowledge_base" ? createKnowledgeBaseFromGeoGap(params.id) : createContentTaskFromGeoGap(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
