import type { CreateCaptureTasksRequest } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createCaptureTasks, getFrontendCaptureWorkspace } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return observationOk(await getFrontendCaptureWorkspace());
  } catch (error) {
    return observationError(error, "CAPTURE_WORKSPACE_READ_FAILED", "AI 前台测试工作区读取失败，请稍后重试。");
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    return observationOk(await createCaptureTasks(payload as unknown as CreateCaptureTasksRequest), 201);
  } catch (error) {
    return observationError(error, "CAPTURE_TASK_CREATE_FAILED", "单次采集任务创建失败，请检查环境后重试。");
  }
}
