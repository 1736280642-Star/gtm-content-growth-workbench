import { readString, readStringArray } from "@/lib/api-utils";
import { readV5GovernancePayload, readV5WriteEnvelope, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { upsertV5ProductEntity } from "@/lib/v5/knowledge-governance-material-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await upsertV5ProductEntity({
      ...readV5WriteEnvelope(payload),
      productId: readString(payload.productId) || "",
      canonicalName: readString(payload.canonicalName) || "",
      displayName: readString(payload.displayName) || "",
      brandName: readString(payload.brandName),
      officialEntity: readString(payload.officialEntity),
      officialUrl: readString(payload.officialUrl),
      productCategory: readString(payload.productCategory),
      aliases: readStringArray(payload.aliases) || [],
      knowledgeBaseIds: readStringArray(payload.knowledgeBaseIds) || []
    });
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
