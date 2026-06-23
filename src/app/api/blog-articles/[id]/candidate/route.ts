import { readRequestPayload } from "@/lib/api-utils";
import { addBlogArticleToCandidatePool, updateBlogArticleCandidateStatus } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = addBlogArticleToCandidatePool(params.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = updateBlogArticleCandidateStatus(params.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = updateBlogArticleCandidateStatus(params.id, { status: "dismissed" });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
