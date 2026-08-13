import { observationError, observationOk } from "@/lib/v5/observation-api";
import { listFormalCaptureObservations } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = await listFormalCaptureObservations();
    return observationOk(records.flatMap((item) => item.answer ? [item.answer] : []));
  } catch (error) {
    return observationError(error, "CAPTURE_ANSWERS_READ_FAILED", "回答与引用证据读取失败，请稍后重试。");
  }
}
