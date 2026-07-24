import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload } from "@/lib/v5/rag/rag-api";
import { rollbackRagIndexSnapshot } from "@/lib/v5/rag/rag-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readRagPayload(request);
    const data = await rollbackRagIndexSnapshot(params.id, String(payload.targetSnapshotId || ""), readRagActor(payload));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return ragErrorResponse(error);
  }
}
