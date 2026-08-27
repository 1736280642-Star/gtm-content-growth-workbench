import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk } from "@/lib/v5/observation-api";
import { listAiFrontendConnections, listCaptureDevices } from "@/lib/v5/capture-repository";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireHostedIdentity(request);
    const [devices, connections] = await Promise.all([
      listCaptureDevices({ executionScope: "deployment_shared" }),
      listAiFrontendConnections({ executionScope: "deployment_shared" })
    ]);
    const onlineDeviceIds = new Set(devices.filter((device) => device.status === "online").map((device) => device.deviceId));
    const platforms = connections
      .filter((connection) => connection.status !== "needs_login" && onlineDeviceIds.has(connection.deviceId))
      .map((connection) => connection.platform);
    return observationOk({
      serviceOnline: onlineDeviceIds.size > 0,
      availablePlatforms: Array.from(new Set(platforms))
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
