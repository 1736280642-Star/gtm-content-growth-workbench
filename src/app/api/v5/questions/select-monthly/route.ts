import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { selectV5MonthlyQuestions } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(selectV5MonthlyQuestions({
      ...readV5WriteEnvelope(payload),
      month: readString(payload.month) || "",
      questionIds: Array.isArray(payload.questionIds) ? payload.questionIds.filter((item): item is string => typeof item === "string") : []
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
