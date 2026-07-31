import { readString } from "@/lib/api-utils";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import {
  createKnowledgeCollectionSource,
  listKnowledgeCollectionWorkspace
} from "@/lib/v5/knowledge-collection-service";
import type { V5KnowledgeCollectionSourceType } from "@/lib/v5/knowledge-collection-contracts";
import {
  readV5Actor,
  readV5GovernancePayload,
  readV5WriteEnvelope
} from "@/lib/v5/knowledge-governance-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json(listKnowledgeCollectionWorkspace());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const envelope = readV5WriteEnvelope(payload);
    return NextResponse.json(createKnowledgeCollectionSource({
      idempotencyKey: envelope.idempotencyKey,
      actor: readV5Actor(payload),
      name: readString(payload.name) || "",
      sourceType: readString(payload.sourceType) as V5KnowledgeCollectionSourceType,
      entryUrl: readString(payload.entryUrl),
      accountId: readString(payload.accountId),
      defaultKnowledgeBaseId: readString(payload.defaultKnowledgeBaseId) || "",
      defaultProductId: readString(payload.defaultProductId),
      defaultProductName: readString(payload.defaultProductName),
      publicUseConfirmed: payload.publicUseConfirmed === true,
      scheduleHour: typeof payload.scheduleHour === "number" ? payload.scheduleHour : undefined
    }), { status: 201 });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
