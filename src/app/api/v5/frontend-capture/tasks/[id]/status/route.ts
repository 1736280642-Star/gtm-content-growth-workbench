import type { CaptureFailureDetail, FrontendCaptureTaskStatus, V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { updateCaptureTaskStatus } from "@/lib/v5/observation-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readObservationPayload(request);
    return observationOk(await updateCaptureTaskStatus(params.id, payload as unknown as V5MutationContext & {
      status: FrontendCaptureTaskStatus;
      note: string;
      failure?: CaptureFailureDetail;
      adapterVersion?: string;
      browserVersion?: string;
      manualIntervention?: boolean;
    }));
  } catch (error) {
    return observationError(error, "CAPTURE_TASK_STATUS_UPDATE_FAILED", "采集任务状态保存失败，请刷新 Runner 队列后重试。");
  }
}
