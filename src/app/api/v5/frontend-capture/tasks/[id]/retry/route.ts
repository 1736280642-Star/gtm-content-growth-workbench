import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { retryCaptureTask } from "@/lib/v5/observation-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    return observationOk(await retryCaptureTask(params.id, (await readObservationPayload(request)) as unknown as V5MutationContext));
  } catch (error) {
    return observationError(error, "CAPTURE_TASK_RETRY_FAILED", "采集任务重试失败，请检查恢复动作后重试。");
  }
}
