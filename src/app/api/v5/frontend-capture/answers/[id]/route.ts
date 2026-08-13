import { observationError, observationOk } from "@/lib/v5/observation-api";
import { listFormalCaptureObservations } from "@/lib/v5/capture-repository";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const records = await listFormalCaptureObservations({ answerId: routeParams.id });
    const record = records[0];
    return observationOk(record ? { answer: record.answer, task: record.task, artifact: record.artifact, gaps: record.gaps, reviews: record.reviews } : undefined);
  } catch (error) {
    return observationError(error, "CAPTURE_ANSWER_READ_FAILED", "回答详情读取失败，请稍后重试。");
  }
}
