import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getCaptureAnswers } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    return observationOk(await getCaptureAnswers(params.id));
  } catch (error) {
    return observationError(error, "CAPTURE_ANSWER_READ_FAILED", "回答详情读取失败，请稍后重试。");
  }
}
