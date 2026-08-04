import { NextResponse } from "next/server";
import { readV5GovernancePayload, readV5Actor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5FoundationRepositoryError } from "@/lib/v5/foundation-repository";
import { V5FoundationServiceError, v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { importGeoResearchQuestionCatalog } from "@/lib/v5/geo-research-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; runId: string }> }
) {
  try {
    const { productId, runId } = await params;
    const payload = await readV5GovernancePayload(request);
    const data = await importGeoResearchQuestionCatalog({
      productId,
      runId,
      findingIds: Array.isArray(payload.findingIds)
        ? payload.findingIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : [],
      expectedQuestionPoolVersion: typeof payload.expectedQuestionPoolVersion === "number"
        ? payload.expectedQuestionPoolVersion
        : Number.NaN,
      idempotencyKey: String(request.headers.get("x-idempotency-key") || payload.idempotencyKey || "").trim(),
      actor: readV5Actor(payload)
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof V5FoundationServiceError || error instanceof V5FoundationRepositoryError) {
      return v5FoundationErrorResponse(error);
    }
    return v5GovernanceErrorResponse(error);
  }
}
