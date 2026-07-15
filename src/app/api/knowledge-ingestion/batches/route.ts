import { readString } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5IngestionBatch } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5IngestionBatch({
      idempotencyKey: readString(payload.idempotencyKey) || "",
      purpose: readString(payload.purpose),
      targetKnowledgeBaseId: readString(payload.targetKnowledgeBaseId),
      targetProductId: readString(payload.targetProductId),
      sourceCount: typeof payload.sourceCount === "number" ? payload.sourceCount : Number.NaN,
      parserVersion: readString(payload.parserVersion),
      classifierVersion: readString(payload.classifierVersion),
      extractorVersion: readString(payload.extractorVersion),
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
