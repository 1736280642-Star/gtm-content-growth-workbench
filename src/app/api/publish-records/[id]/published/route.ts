import { readRequestPayload } from "@/lib/api-utils";
import { markPublishRecordPublished } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = markPublishRecordPublished(routeParams.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
