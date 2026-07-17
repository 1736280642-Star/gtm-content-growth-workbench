import { readRequestPayload } from "@/lib/api-utils";
import { deleteKnowledgeBase, patchKnowledgeBase } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = patchKnowledgeBase(params.id, payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = deleteKnowledgeBase(params.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
