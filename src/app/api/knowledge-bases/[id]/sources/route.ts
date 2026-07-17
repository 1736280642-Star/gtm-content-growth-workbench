import { readRequestPayload } from "@/lib/api-utils";
import { appendKnowledgeSources } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = await appendKnowledgeSources(params.id, payload);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 400 : 404 });
}
