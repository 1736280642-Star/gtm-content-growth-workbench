import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { cancelCaptureTask } from "@/lib/v5/observation-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    return observationOk(await cancelCaptureTask(routeParams.id, (await readObservationPayload(request)) as unknown as V5MutationContext));
  } catch (error) {
    return observationError(error, "CAPTURE_TASK_CANCEL_FAILED", "采集任务取消失败，请刷新后重试。");
  }
}
