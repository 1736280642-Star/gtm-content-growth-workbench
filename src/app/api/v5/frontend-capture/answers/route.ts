import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getCaptureAnswers } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return observationOk(await getCaptureAnswers());
  } catch (error) {
    return observationError(error, "CAPTURE_ANSWERS_READ_FAILED", "回答与引用证据读取失败，请稍后重试。");
  }
}
