import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload } from "@/lib/v5/rag/rag-api";
import { createFinalEvidencePack } from "@/lib/v5/rag/rag-service";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const p = await readRagPayload(request); const data = await createFinalEvidencePack({ retrievalRunId: String(p.retrievalRunId || ""), actor: readRagActor(p) }); return NextResponse.json({ ok: true, data }, { status: 201 }); }
  catch (error) { return ragErrorResponse(error); }
}
