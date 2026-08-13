import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { recordAttributionEvent } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Attribution chain - write attribution event
export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const sourceEventId = String(payload.sourceEventId || "").trim();
    const platform = String(payload.platform || "").trim();
    const changeType = String(payload.changeType || "").trim();

    if (!sourceEventId || !platform || !changeType) {
      throw new ObservationServiceError(400, "INVALID_ATTRIBUTION_PAYLOAD", "sourceEventId、platform 和 changeType 为必填项。");
    }

    return observationOk(await recordAttributionEvent({
      sourceEventId,
      platform,
      changeType,
      evidenceIds: Array.isArray(payload.evidenceIds) ? payload.evidenceIds.map(String) : [],
      strategyAdjustmentId: typeof payload.strategyAdjustmentId === "string" ? payload.strategyAdjustmentId : undefined,
      articleIds: Array.isArray(payload.articleIds) ? payload.articleIds.map(String) : [],
      outcome: typeof payload.outcome === "string" ? payload.outcome : undefined
    }), 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "ATTRIBUTION_CHAIN_WRITE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
