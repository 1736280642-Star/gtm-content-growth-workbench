import { readString } from "@/lib/api-utils";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { runKnowledgeCollection } from "@/lib/v5/knowledge-collection-service";
import {
  readV5Actor,
  readV5GovernancePayload
} from "@/lib/v5/knowledge-governance-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await runKnowledgeCollection({
      actor: readV5Actor(payload),
      sourceId: readString(payload.sourceId),
      force: payload.force === true
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
