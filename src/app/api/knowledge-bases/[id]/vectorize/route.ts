import { readRequestPayload } from "@/lib/api-utils";
import { vectorizeKnowledgeBase } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = await vectorizeKnowledgeBase(routeParams.id, payload);

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : result.ok ? 200 : 400 });
}
