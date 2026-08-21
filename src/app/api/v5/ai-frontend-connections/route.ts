import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import type { AiFrontendIsolationPolicy, AiFrontendPlatform } from "@/lib/v5/observation-contracts";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { listAiFrontendConnections, registerAiFrontendConnection } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId")?.trim();
    return observationOk({ connections: await listAiFrontendConnections({ deviceId }) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const deviceId = String(payload.deviceId || "").trim();
    const platform = String(payload.platform || "").trim() as AiFrontendPlatform;
    const accountAlias = String(payload.accountAlias || "").trim();
    const browserProfileSlot = String(payload.browserProfileSlot || "default").trim();
    const isolationPolicy = payload.isolationPolicy && typeof payload.isolationPolicy === "object" && !Array.isArray(payload.isolationPolicy)
      ? payload.isolationPolicy as Partial<AiFrontendIsolationPolicy>
      : undefined;
    if (!deviceId || !platform || !accountAlias) {
      throw new ObservationServiceError(400, "AI_FRONTEND_CONNECTION_PAYLOAD_INVALID", "deviceId、platform 和 accountAlias 为必填项。");
    }
    return observationOk(await registerAiFrontendConnection({ deviceId, platform, accountAlias, browserProfileSlot, isolationPolicy }), 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "AI_FRONTEND_CONNECTION_CREATE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
