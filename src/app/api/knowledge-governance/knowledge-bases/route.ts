import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { upsertV5KnowledgeBaseRegistry } from "@/lib/v5/knowledge-governance-material-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await upsertV5KnowledgeBaseRegistry({
      ...readV5WriteEnvelope(payload),
      knowledgeBaseId: readString(payload.knowledgeBaseId) || "",
      name: readString(payload.name) || "",
      type: readString(payload.type) || "",
      trustLevel: readString(payload.trustLevel) || "pending",
      status: readString(payload.status) || "enabled",
      updateMode: readString(payload.updateMode) || "manual",
      usageScope: readString(payload.usageScope),
      lastSyncedAt: readString(payload.lastSyncedAt)
    });
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
