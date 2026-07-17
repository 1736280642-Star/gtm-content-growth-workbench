import { readRequestPayload } from "@/lib/api-utils";
import { mergeKnowledgeBases } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = mergeKnowledgeBases(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
