import { readString, readStringArray } from "@/lib/api-utils";
import {
  readV5Actor,
  readV5GovernancePayload,
  v5GovernanceErrorResponse
} from "@/lib/v5/knowledge-governance-api";
import { listProductsWithGeoOverview, onboardProductForGeoResearch } from "@/lib/v5/product-registry-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await listProductsWithGeoOverview()) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim()
      || readString(payload.idempotencyKey)
      || "";
    const result = await onboardProductForGeoResearch({
      idempotencyKey,
      actor: readV5Actor(payload),
      product: {
        canonicalName: readString(payload.canonicalName) || "",
        displayName: readString(payload.displayName),
        brandName: readString(payload.brandName),
        officialEntity: readString(payload.officialEntity),
        officialUrl: readString(payload.officialUrl),
        productCategory: readString(payload.productCategory),
        entityRelationship: readString(payload.entityRelationship),
        aliases: readStringArray(payload.aliases)
      },
      research: {
        expressionFocus: readString(payload.expressionFocus) || "",
        forbiddenFocus: readStringArray(payload.forbiddenFocus),
        researchMarkets: readStringArray(payload.researchMarkets),
        languages: readStringArray(payload.languages),
        targetChannels: readStringArray(payload.targetChannels)
      }
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
