import { readString } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope } from "@/lib/v5/knowledge-governance-api";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { createV5KnowledgeBase, listV5KnowledgeBases } from "@/lib/v5/knowledge-workspace-service";
import type { V5KnowledgeVisibility } from "@/lib/v5/knowledge-workspace-contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(listV5KnowledgeBases());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    return NextResponse.json(createV5KnowledgeBase({
      ...readV5WriteEnvelope(payload),
      name: readString(payload.name) || "",
      focus: readString(payload.focus) || "",
      defaultVisibility: readString(payload.defaultVisibility) as V5KnowledgeVisibility | undefined
    }));
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
