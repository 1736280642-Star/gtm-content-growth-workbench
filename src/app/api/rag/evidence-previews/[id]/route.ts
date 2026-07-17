import { NextResponse } from "next/server";
import { ragErrorResponse } from "@/lib/v5/rag/rag-api";
import { readEvidencePreviewRecord } from "@/lib/v5/rag/rag-repository";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: { id: string } }) { try { const data = await readEvidencePreviewRecord(params.id); return data ? NextResponse.json({ ok: true, data }) : NextResponse.json({ ok: false, error: { code: "not_found", message: "EvidencePreview 不存在。" } }, { status: 404 }); } catch (error) { return ragErrorResponse(error); } }
