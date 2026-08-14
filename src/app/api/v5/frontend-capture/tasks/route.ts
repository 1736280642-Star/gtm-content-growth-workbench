import type { CreateCaptureTasksRequest, FrontendCaptureWorkspace } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { assertObservationMutationContext, getCaptureEnvironmentStatus, ObservationServiceError } from "@/lib/v5/observation-service";
import { createManualFormalCaptureTasks, listFormalCaptureObservations } from "@/lib/v5/capture-repository";
import { readObservationReferenceSnapshot } from "@/lib/v5/observation-reference-adapter";
import { listApprovedGeoMonitoringQuestions } from "@/lib/v5/question-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [records, reference, environment] = await Promise.all([
      listFormalCaptureObservations(), readObservationReferenceSnapshot(), getCaptureEnvironmentStatus()
    ]);
    const data: FrontendCaptureWorkspace = {
      source: records.length ? "persisted" : "empty", reference, environment,
      tasks: records.map((item) => item.task), artifacts: records.flatMap((item) => item.artifact ? [item.artifact] : []),
      answers: records.flatMap((item) => item.answer ? [item.answer] : []), gaps: records.flatMap((item) => item.gaps),
      reviews: records.flatMap((item) => item.reviews), comparisons: []
    };
    return observationOk(data);
  } catch (error) {
    return observationError(error, "CAPTURE_WORKSPACE_READ_FAILED", "AI 前台测试工作区读取失败，请稍后重试。");
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request) as unknown as CreateCaptureTasksRequest;
    assertObservationMutationContext(payload);
    if (payload.executionMode !== "immediate_once") throw new ObservationServiceError(422, "SCHEDULED_CAPTURE_NOT_ALLOWED", "只允许立即执行一次。");
    if (!payload.questionVersionId || payload.temporaryQuestionText) throw new ObservationServiceError(422, "FORMAL_QUESTION_REQUIRED", "正式链路只接受已绑定产品的问题；临时问题不写入正式任务源。");
    const reference = await readObservationReferenceSnapshot();
    const question = reference.questions.find((item) => item.questionVersionId === payload.questionVersionId);
    if (!question) throw new ObservationServiceError(404, "CAPTURE_QUESTION_NOT_FOUND", "未找到正式问题版本。");
    const approvedQuestion = listApprovedGeoMonitoringQuestions().find((item) => item.currentVersionId === payload.questionVersionId);
    if (!approvedQuestion) {
      throw new ObservationServiceError(422, "GEO_MONITORING_APPROVAL_REQUIRED", "该问题尚未在 GEO 调研结果中人工确认，不能创建监控任务。");
    }
    const created = await createManualFormalCaptureTasks({
      questionVersionId: question.questionVersionId, question: question.text, platforms: payload.platforms,
      captureCondition: payload.condition, idempotencyKey: payload.idempotencyKey
    });
    const records = await listFormalCaptureObservations();
    return observationOk(records.filter((item) => created.some((task) => task.taskId === item.task.id)).map((item) => item.task), 201);
  } catch (error) {
    return observationError(error, "CAPTURE_TASK_CREATE_FAILED", "单次采集任务创建失败，请检查环境后重试。");
  }
}
