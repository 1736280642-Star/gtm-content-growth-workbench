import { NextResponse } from "next/server";
import { ragErrorResponse, readRagActor, readRagPayload } from "@/lib/v5/rag/rag-api";
import { createRagIndexSnapshot } from "@/lib/v5/rag/rag-service";
import type { RagNamespace } from "@/lib/v5/rag/contracts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const p = await readRagPayload(request);
    const result = await createRagIndexSnapshot({ manifestId: String(p.manifestId || ""), namespace: String(p.namespace || "production_public") as RagNamespace,
      language: String(p.language || "zh-CN"), indexVersion: String(p.indexVersion || ""), chunkSchemaVersion: String(p.chunkSchemaVersion || "rag-chunk@1"),
      chunkerVersion: String(p.chunkerVersion || "claim-aware@1"), retrievalPolicyVersion: String(p.retrievalPolicyVersion || "hybrid-rrf@1"), actor: readRagActor(p) });
    return NextResponse.json({ ok: true, data: result }, { status: 201 });
  } catch (error) { return ragErrorResponse(error); }
}
