import type { CreateComparisonRequest } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createCaptureComparison } from "@/lib/v5/observation-service";

export async function POST(request: Request) {
  try {
    return observationOk(await createCaptureComparison((await readObservationPayload(request)) as unknown as CreateComparisonRequest), 201);
  } catch (error) {
    return observationError(error, "CAPTURE_COMPARISON_FAILED", "任务对比生成失败，请确认两次任务属于同一问题。");
  }
}
