import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { getV5Question, updateV5Question } from "@/lib/v5/question-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(getV5Question(params.id));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(updateV5Question({
      ...readV5WriteEnvelope(payload),
      questionId: params.id,
      text: readString(payload.text) || "",
      product: readString(payload.product),
      entities: Array.isArray(payload.entities) ? payload.entities.filter((item): item is string => typeof item === "string") : undefined,
      relationship: readString(payload.relationship),
      audience: readString(payload.audience),
      suggestedArticleTypes: Array.isArray(payload.suggestedArticleTypes) ? payload.suggestedArticleTypes.filter((item): item is string => typeof item === "string") : undefined
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
