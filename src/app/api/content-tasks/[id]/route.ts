import { readRequestPayload } from "@/lib/api-utils";
import { deleteContentTask, patchContentTask } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = patchContentTask(routeParams.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = deleteContentTask(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
