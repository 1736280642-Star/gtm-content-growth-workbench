import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { recordCaptureTaskFailure } from "@/lib/v5/capture-repository";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await readObservationPayload(request);
    return observationOk(await recordCaptureTaskFailure({
      taskId: id,
      deviceId: String(payload.deviceId || "").trim(),
      status: String(payload.status || "").trim(),
      note: payload.note ? String(payload.note) : undefined
    }));
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "CAPTURE_TASK_STATUS_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
