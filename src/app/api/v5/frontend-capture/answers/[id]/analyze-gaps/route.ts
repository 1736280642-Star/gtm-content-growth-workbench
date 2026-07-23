import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { analyzeObservationGaps } from "@/lib/v5/observation-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    return observationOk(await analyzeObservationGaps(params.id, (await readObservationPayload(request)) as unknown as V5MutationContext), 201);
  } catch (error) {
    return observationError(error, "OBSERVATION_GAP_ANALYSIS_FAILED", "候选缺口分析失败，请检查证据映射状态后重试。");
  }
}
