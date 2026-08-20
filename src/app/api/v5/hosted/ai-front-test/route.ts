import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createConnectedManualCaptureTask } from "@/lib/v5/capture-repository";
import { getV5GovernancePool } from "@/lib/v5/knowledge-governance-repository";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import { listApprovedGeoMonitoringQuestions } from "@/lib/v5/question-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readObservationPayload(request);
    const productId = String(payload.productId || "").trim();
    const connectionId = String(payload.connectionId || "").trim();
    const idempotencyKey = String(payload.idempotencyKey || `hosted-ai-test-${randomUUID()}`).trim();
    if (!productId || !connectionId) {
      throw new ObservationServiceError(400, "HOSTED_AI_TEST_INPUT_REQUIRED", "请选择推广产品和已绑定的 AI 账号。");
    }

    const approved = listApprovedGeoMonitoringQuestions();
    if (!approved.length) throw new ObservationServiceError(422, "HOSTED_AI_TEST_QUESTION_UNAVAILABLE", "当前没有经人工确认的 GEO 测试问题。");
    const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT question_version_id FROM content_matrix_item
       WHERE product_id = ? AND question_version_id IS NOT NULL ORDER BY created_at DESC`,
      [productId]
    );
    const boundQuestionIds = new Set(rows.map((row) => String(row.question_version_id)));
    const question = approved.find((item) => boundQuestionIds.has(item.currentVersionId));
    if (!question) {
      throw new ObservationServiceError(
        422,
        "HOSTED_AI_TEST_PRODUCT_QUESTION_MISSING",
        "当前产品还没有绑定已批准的 GEO 测试问题，请先完成问题确认和内容矩阵绑定。"
      );
    }

    const task = await createConnectedManualCaptureTask({
      productId,
      questionVersionId: question.currentVersionId,
      question: question.currentVersion.text,
      connectionId,
      idempotencyKey
    });
    return observationOk({
      taskId: task.taskId,
      status: task.status,
      connectionId,
      question: question.currentVersion.text,
      wakeMessage: { type: "JOTO_CAPTURE_POLL", taskId: task.taskId, connectionId }
    }, 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "HOSTED_AI_TEST_CREATE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
