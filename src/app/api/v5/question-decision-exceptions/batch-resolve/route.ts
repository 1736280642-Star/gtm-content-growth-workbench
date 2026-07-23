import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { resolveV5QuestionDecisions } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

type Resolution = { exceptionId: string; action: "adopt_suggestion" | "correct" | "ignore"; correctedText?: string; expectedVersion?: number };

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const resolutions = Array.isArray(payload.resolutions) ? payload.resolutions as Resolution[] : [];
    return NextResponse.json(resolveV5QuestionDecisions({ ...readV5WriteEnvelope(payload), resolutions }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
