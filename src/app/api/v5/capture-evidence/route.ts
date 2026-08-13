import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { uploadCaptureEvidence } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Capture evidence - upload desensitized evidence (idempotent)
export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const taskId = String(payload.taskId || "").trim();
    const artifactHash = String(payload.artifactHash || "").trim();
    const deviceId = String(payload.deviceId || "").trim();
    const collectedBy = String(payload.collectedBy || "").trim();

    if (!taskId || !artifactHash || !deviceId || !payload.payload || typeof payload.payload !== "object" || Array.isArray(payload.payload)) {
      throw new ObservationServiceError(400, "INVALID_EVIDENCE_PAYLOAD", "taskId、artifactHash、deviceId 和 payload 为必填项。");
    }
    return observationOk(await uploadCaptureEvidence({
      taskId,
      artifactHash,
      deviceId,
      collectedBy,
      payload: payload.payload as Record<string, unknown>
    }), 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "CAPTURE_EVIDENCE_UPLOAD_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
