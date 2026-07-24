import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getCaptureEnvironmentStatus } from "@/lib/v5/observation-service";

export async function POST() {
  try {
    return observationOk(await getCaptureEnvironmentStatus());
  } catch (error) {
    return observationError(error, "CAPTURE_ENVIRONMENT_DIAGNOSE_FAILED", "采集环境诊断失败，请先启动本地 Runner。");
  }
}
