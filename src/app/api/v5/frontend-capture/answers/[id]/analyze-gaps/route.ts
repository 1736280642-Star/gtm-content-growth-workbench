import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { assertObservationMutationContext } from "@/lib/v5/observation-service";
import { listFormalCaptureObservations } from "@/lib/v5/capture-repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = (await readObservationPayload(request)) as unknown as V5MutationContext;
    assertObservationMutationContext(payload);
    const record = (await listFormalCaptureObservations({ answerId: routeParams.id }))[0];
    return observationOk(record?.gaps || [], 200);
  } catch (error) {
    return observationError(error, "OBSERVATION_GAP_ANALYSIS_FAILED", "候选缺口分析失败，请检查证据映射状态后重试。");
  }
}
