import { NextResponse } from "next/server";
import { ragErrorResponse } from "@/lib/v5/rag/rag-api";
import { readRagIndexSnapshotRecord } from "@/lib/v5/rag/rag-repository";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try { const data = await readRagIndexSnapshotRecord(routeParams.id); return data ? NextResponse.json({ ok: true, data }) : NextResponse.json({ ok: false, error: { code: "not_found", message: "IndexSnapshot 不存在。" } }, { status: 404 }); }
  catch (error) { return ragErrorResponse(error); }
}
