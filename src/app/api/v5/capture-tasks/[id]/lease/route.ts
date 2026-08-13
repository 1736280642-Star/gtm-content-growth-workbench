import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { leaseCaptureTask } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Capture tasks - lease / renew lease
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await params;
  try {
    const payload = await readObservationPayload(_request);
    const deviceId = String(payload.deviceId || "").trim();
    const durationMs = Number(payload.durationMs) || 300_000; // default 5 minutes
    if (!deviceId) return observationOk({ message: "deviceId 为必填项。" }, 400);
    return observationOk(await leaseCaptureTask({
      taskId: routeParams.id,
      deviceId,
      durationMs
    }));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
