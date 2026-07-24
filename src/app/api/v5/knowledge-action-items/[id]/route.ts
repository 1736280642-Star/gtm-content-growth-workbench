import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { updateV5KnowledgeActionItem } from "@/lib/v5/knowledge-workspace-service";
import type { V5KnowledgeActionStatus } from "@/lib/v5/knowledge-workspace-contracts";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(updateV5KnowledgeActionItem({
      ...readV5WriteEnvelope(payload),
      actionItemId: params.id,
      status: readString(payload.status) as V5KnowledgeActionStatus
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
