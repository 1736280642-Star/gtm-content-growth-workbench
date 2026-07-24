import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getCaptureEnvironmentStatus } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return observationOk(await getCaptureEnvironmentStatus());
  } catch (error) {
    return observationError(error, "CAPTURE_ENVIRONMENT_READ_FAILED", "采集环境读取失败，请确认本地 Runner 状态。");
  }
}
