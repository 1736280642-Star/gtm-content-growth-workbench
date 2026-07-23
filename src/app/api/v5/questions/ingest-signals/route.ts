import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { ingestV5QuestionSignals } from "@/lib/v5/question-service";
import type { V5QuestionSignalInput } from "@/lib/v5/question-contracts";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const signals = Array.isArray(payload.signals) ? payload.signals as V5QuestionSignalInput[] : [];
    return NextResponse.json(ingestV5QuestionSignals({ ...readV5WriteEnvelope(payload), signals }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
