import { readRequestPayload } from "@/lib/api-utils";
import { vectorizeKnowledgeBases } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = await vectorizeKnowledgeBases(payload);

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : result.ok ? 200 : 400 });
}
