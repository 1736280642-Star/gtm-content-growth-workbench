import type { ReviewObservationRequest } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { reviewObservationGaps } from "@/lib/v5/observation-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    return observationOk(await reviewObservationGaps(params.id, (await readObservationPayload(request)) as unknown as ReviewObservationRequest), 201);
  } catch (error) {
    return observationError(error, "OBSERVATION_REVIEW_FAILED", "缺口复核与分流失败，请检查去向后重试。");
  }
}
