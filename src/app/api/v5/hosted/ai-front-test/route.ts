import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createDeploymentSharedCaptureTask } from "@/lib/v5/capture-repository";
import { getV5GovernancePool } from "@/lib/v5/knowledge-governance-repository";
import { ObservationServiceError } from "@/lib/v5/observation-service";
import type { AiFrontendPlatform } from "@/lib/v5/observation-contracts";
import { listApprovedGeoMonitoringQuestions } from "@/lib/v5/question-service";
import { assertWorkspaceProductAccess, requireHostedIdentity } from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const hostedCapturePlatforms = new Set<AiFrontendPlatform>(["chatgpt", "doubao", "deepseek", "qwen"]);

export async function GET(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
    if (!taskId) throw new ObservationServiceError(400, "HOSTED_AI_TEST_TASK_REQUIRED", "缺少 AI 前台测试任务编号。");
    const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT task_id, platform, status, created_at, completed_at
       FROM capture_tasks
       WHERE task_id = ? AND requested_workspace_id = ? AND requested_user_id = ? LIMIT 1`,
      [taskId, identity.workspaceId, identity.userId]
    );
    if (!rows[0]) throw new ObservationServiceError(404, "HOSTED_AI_TEST_TASK_NOT_FOUND", "任务不存在或不属于当前用户。");
    return observationOk({
      taskId: String(rows[0].task_id),
      platform: String(rows[0].platform),
      status: String(rows[0].status),
      createdAt: new Date(String(rows[0].created_at)).toISOString(),
      completedAt: rows[0].completed_at ? new Date(String(rows[0].completed_at)).toISOString() : undefined
    });
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "HOSTED_AI_TEST_STATUS_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    const payload = await readObservationPayload(request);
    const productId = String(payload.productId || "").trim();
    const platform = String(payload.platform || "").trim() as AiFrontendPlatform;
    const idempotencyKey = String(payload.idempotencyKey || `hosted-ai-test-${randomUUID()}`).trim();
    if (!productId || !hostedCapturePlatforms.has(platform)) {
      throw new ObservationServiceError(400, "HOSTED_AI_TEST_INPUT_REQUIRED", "请选择推广产品和 AI 测试平台。");
    }
    await assertWorkspaceProductAccess(identity.workspaceId, productId);

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

    const task = await createDeploymentSharedCaptureTask({
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      productId,
      questionVersionId: question.currentVersionId,
      question: question.currentVersion.text,
      platform,
      idempotencyKey
    });
    return observationOk({
      taskId: task.taskId,
      status: task.status,
      platform,
      question: question.currentVersion.text,
      message: "请求已进入部署级 24 小时采集服务器队列。"
    }, 201);
  } catch (error) {
    return error instanceof ObservationServiceError
      ? observationError(error, "HOSTED_AI_TEST_CREATE_FAILED", error.message)
      : v5GovernanceErrorResponse(error);
  }
}
