import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { publishV5ArticleExpressionProfile } from "@/lib/v5/article-expression-service";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(publishV5ArticleExpressionProfile({
      ...readV5WriteEnvelope(payload),
      profileId: params.id,
      profileVersionId: readString(payload.profileVersionId) || ""
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
