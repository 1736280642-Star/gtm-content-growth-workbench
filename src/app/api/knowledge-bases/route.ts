import { readRequestPayload } from "@/lib/api-utils";
import { createKnowledgeBase, readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      knowledgeBases: readWorkbenchState().knowledgeBases
    }
  });
}

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = createKnowledgeBase(payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
