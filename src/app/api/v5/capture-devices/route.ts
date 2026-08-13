import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { listCaptureDevices, registerCaptureDevice } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Phase 1: Capture devices - list all devices
export async function GET() {
  try {
    return observationOk({ devices: await listCaptureDevices() });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

// Phase 1: Capture devices - register/pair a new device
export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const deviceId = String(payload.deviceId || "").trim();
    const workspaceId = String(payload.workspaceId || "").trim();
    const userId = String(payload.userId || "").trim();
    const pairingCode = String(payload.pairingCode || "").trim();
    const platforms = Array.isArray(payload.platforms)
      ? [...new Set(payload.platforms.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];

    if (!deviceId || (!pairingCode && (!workspaceId || !userId)) || !platforms.length) {
      throw new ObservationServiceError(400, "INVALID_DEVICE_PAYLOAD", "deviceId、platforms 以及 pairingCode（或可信服务端 workspaceId/userId）为必填项。");
    }
    return observationOk(await registerCaptureDevice({ deviceId, workspaceId, userId, pairingCode, platforms }), 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "CAPTURE_DEVICE_REGISTER_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
