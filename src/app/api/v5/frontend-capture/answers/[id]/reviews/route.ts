import type { ReviewObservationRequest } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { assertObservationMutationContext } from "@/lib/v5/observation-service";
import { reviewFormalCaptureGaps } from "@/lib/v5/capture-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = (await readObservationPayload(request)) as unknown as ReviewObservationRequest;
    assertObservationMutationContext(payload);
    return observationOk(await reviewFormalCaptureGaps(routeParams.id, payload), 201);
  } catch (error) {
    return observationError(error, "OBSERVATION_REVIEW_FAILED", "缺口复核与分流失败，请检查去向后重试。");
  }
}
