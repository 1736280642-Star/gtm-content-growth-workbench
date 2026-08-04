import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload } from "@/lib/v5/rag/rag-api";
import { activateRagIndexSnapshot } from "@/lib/v5/rag/rag-service";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try { const p = await readRagPayload(request); const data = await activateRagIndexSnapshot(routeParams.id, readRagActor(p), typeof p.previousActiveId === "string" ? p.previousActiveId : undefined); return NextResponse.json({ ok: true, data }); }
  catch (error) { return ragErrorResponse(error); }
}
