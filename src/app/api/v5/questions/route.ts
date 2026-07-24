import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { ingestV5QuestionSignals, listV5Questions } from "@/lib/v5/question-service";
import type { V5QuestionConflictType, V5QuestionSignalInput } from "@/lib/v5/question-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(listV5Questions());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const signal: V5QuestionSignalInput = {
      text: readString(payload.text) || "",
      source: "manual",
      sourceId: readString(payload.sourceId) || `manual-${Date.now()}`,
      confidence: typeof payload.confidence === "number" ? payload.confidence : 1,
      product: readString(payload.product),
      entities: Array.isArray(payload.entities) ? payload.entities.filter((item): item is string => typeof item === "string") : [],
      relationship: readString(payload.relationship),
      audience: readString(payload.audience),
      suggestedArticleTypes: Array.isArray(payload.suggestedArticleTypes) ? payload.suggestedArticleTypes.filter((item): item is string => typeof item === "string") : [],
      keywords: Array.isArray(payload.keywords) ? payload.keywords.filter((item): item is string => typeof item === "string") : [],
      conflicts: Array.isArray(payload.conflicts) ? payload.conflicts.filter((item): item is V5QuestionConflictType => typeof item === "string") : [],
      evidenceGap: payload.evidenceGap === true
    };
    return NextResponse.json(ingestV5QuestionSignals({ ...readV5WriteEnvelope(payload), signals: [signal] }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
