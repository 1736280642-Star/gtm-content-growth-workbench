import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { createV5ArticleExpressionProfile, listV5ArticleExpressionProfiles, type ProfileVersionInput } from "@/lib/v5/article-expression-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(listV5ArticleExpressionProfiles());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(createV5ArticleExpressionProfile({
      ...readV5WriteEnvelope(payload),
      name: readString(payload.name) || "",
      applicableArticleTypes: Array.isArray(payload.applicableArticleTypes) ? payload.applicableArticleTypes.filter((item): item is string => typeof item === "string") : [],
      applicableChannels: Array.isArray(payload.applicableChannels) ? payload.applicableChannels.filter((item): item is string => typeof item === "string") : [],
      version: payload.version as ProfileVersionInput
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
