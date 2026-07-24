import { NextResponse } from "next/server";
import { object, ragErrorResponse, readRagActor, readRagPayload } from "@/lib/v5/rag/rag-api";
import { validateRagIndexSnapshot } from "@/lib/v5/rag/rag-service";
import type { RagEvaluationSummary } from "@/lib/v5/rag/contracts";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try { const p = await readRagPayload(request); const data = await validateRagIndexSnapshot(params.id, object(p.summary) as unknown as RagEvaluationSummary, readRagActor(p)); return NextResponse.json({ ok: true, data }); }
  catch (error) { return ragErrorResponse(error); }
}
