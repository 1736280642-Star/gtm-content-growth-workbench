import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { updateV5ArticleExpressionProfile, type ProfileVersionInput } from "@/lib/v5/article-expression-service";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(updateV5ArticleExpressionProfile({
      ...readV5WriteEnvelope(payload),
      profileId: params.id,
      name: readString(payload.name),
      applicableArticleTypes: Array.isArray(payload.applicableArticleTypes) ? payload.applicableArticleTypes.filter((item): item is string => typeof item === "string") : undefined,
      applicableChannels: Array.isArray(payload.applicableChannels) ? payload.applicableChannels.filter((item): item is string => typeof item === "string") : undefined,
      version: payload.version as ProfileVersionInput
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
