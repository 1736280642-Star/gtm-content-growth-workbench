import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { updateKnowledgeCollectionSource } from "@/lib/v5/knowledge-collection-service";
import {
  readV5Actor,
  readV5GovernancePayload,
  readV5WriteEnvelope
} from "@/lib/v5/knowledge-governance-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    const envelope = readV5WriteEnvelope(payload);
    return NextResponse.json(updateKnowledgeCollectionSource({
      sourceId: params.id,
      idempotencyKey: envelope.idempotencyKey,
      actor: readV5Actor(payload),
      expectedVersion: envelope.expectedVersion,
      enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
      scheduleHour: typeof payload.scheduleHour === "number" ? payload.scheduleHour : undefined
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
