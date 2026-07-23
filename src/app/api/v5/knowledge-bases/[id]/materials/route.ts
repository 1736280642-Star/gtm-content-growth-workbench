import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { addV5KnowledgeMaterial } from "@/lib/v5/knowledge-workspace-service";
import type { V5KnowledgeMaterialStatus, V5KnowledgeVisibility } from "@/lib/v5/knowledge-workspace-contracts";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const kind = readString(payload.kind);
    return NextResponse.json(addV5KnowledgeMaterial({
      ...readV5WriteEnvelope(payload),
      knowledgeBaseId: params.id,
      title: readString(payload.title) || "",
      kind: kind === "url" || kind === "document" || kind === "text" ? kind : "text",
      status: readString(payload.status) as V5KnowledgeMaterialStatus | undefined,
      summary: readString(payload.summary),
      evidenceExcerpt: readString(payload.evidenceExcerpt),
      sourceOwner: readString(payload.sourceOwner),
      visibility: readString(payload.visibility) as V5KnowledgeVisibility | undefined,
      limitation: readString(payload.limitation),
      failureReason: readString(payload.failureReason)
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
