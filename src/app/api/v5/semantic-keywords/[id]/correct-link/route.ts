import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { correctV5KeywordLink } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(correctV5KeywordLink({
      ...readV5WriteEnvelope(payload),
      keywordId: params.id,
      questionIds: Array.isArray(payload.questionIds) ? payload.questionIds.filter((item): item is string => typeof item === "string") : [],
      reason: readString(payload.reason) || ""
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
