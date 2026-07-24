import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { restoreV5Keyword } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(restoreV5Keyword({ ...readV5WriteEnvelope(payload), keywordId: params.id, reason: readString(payload.reason) || "" }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
