import { readRequestPayload } from "@/lib/api-utils";
import { addBlogArticleToCandidatePool, updateBlogArticleCandidateStatus } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = addBlogArticleToCandidatePool(routeParams.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = updateBlogArticleCandidateStatus(routeParams.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = updateBlogArticleCandidateStatus(routeParams.id, { status: "dismissed" });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
