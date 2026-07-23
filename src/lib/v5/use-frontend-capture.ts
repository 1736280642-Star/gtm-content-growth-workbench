"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@/lib/types";
import type {
  AiFrontendPlatform,
  CaptureComparison,
  CreateCaptureTasksRequest,
  FrontendCaptureCondition,
  FrontendCaptureTask,
  FrontendCaptureWorkspace,
  ObservationGapDestination,
  ReviewObservationRequest,
  V5MutationActor,
  V5ObservationApiEnvelope
} from "./observation-contracts";

function actorForRole(role: WorkspaceRole): V5MutationActor {
  const writableRole = role === "content_growth" || role === "workbench_operator" || role === "knowledge_manager" || role === "developer_admin"
    ? role
    : "workbench_operator";
  return { actorId: `local-${writableRole}`, actorRole: writableRole, actorType: "human" };
}

function idempotencyKey(scope: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${scope}-${crypto.randomUUID()}`;
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestObservation<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = (await response.json()) as V5ObservationApiEnvelope<T>;
  if (!response.ok || !body.ok) {
    if (!body.ok) throw new Error([body.error.message, body.error.recoveryAction].filter(Boolean).join(" "));
    throw new Error(`请求失败（HTTP ${response.status}）。`);
  }
  return body.data;
}

export function useFrontendCapture(role: WorkspaceRole) {
  const [workspace, setWorkspace] = useState<FrontendCaptureWorkspace>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestObservation<FrontendCaptureWorkspace>("/api/v5/frontend-capture/tasks");
      setWorkspace(data);
      setError(undefined);
      return data;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const createTasks = useCallback(
    async (input: {
      questionVersionId?: string;
      temporaryQuestionText?: string;
      platforms: AiFrontendPlatform[];
      condition: FrontendCaptureCondition;
    }) => {
      const payload: CreateCaptureTasksRequest = {
        ...input,
        executionMode: "immediate_once",
        actor: actorForRole(role),
        reason: "用户发起立即执行的单次 AI 前台测试",
        idempotencyKey: idempotencyKey("capture-task"),
        expectedVersion: 0
      };
      const data = await requestObservation<FrontendCaptureTask[]>("/api/v5/frontend-capture/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      await refresh();
      return data;
    },
    [refresh, role]
  );

  const analyzeGaps = useCallback(
    async (answerId: string, expectedVersion: number) => {
      await requestObservation(`/api/v5/frontend-capture/answers/${encodeURIComponent(answerId)}/analyze-gaps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: actorForRole(role),
          reason: "生成候选缺口供人工复核",
          idempotencyKey: idempotencyKey("gap-analysis"),
          expectedVersion
        })
      });
      await refresh();
    },
    [refresh, role]
  );

  const reviewGaps = useCallback(
    async (answerId: string, input: Omit<ReviewObservationRequest, keyof { actor: never; reason: never; idempotencyKey: never; expectedVersion: never }> & { expectedVersion: number }) => {
      const payload: ReviewObservationRequest = {
        selectedGapIds: input.selectedGapIds,
        decision: input.decision,
        destinations: input.destinations,
        note: input.note,
        actor: actorForRole(role),
        reason: "人工确认观察缺口的业务去向",
        idempotencyKey: idempotencyKey("gap-review"),
        expectedVersion: input.expectedVersion
      };
      await requestObservation(`/api/v5/frontend-capture/answers/${encodeURIComponent(answerId)}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      await refresh();
    },
    [refresh, role]
  );

  const compareTasks = useCallback(
    async (baselineTaskId: string, comparisonTaskId: string): Promise<CaptureComparison> => {
      const data = await requestObservation<CaptureComparison>("/api/v5/frontend-capture/comparisons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baselineTaskId,
          comparisonTaskId,
          actor: actorForRole(role),
          reason: "人工选择两次历史任务进行样本对比",
          idempotencyKey: idempotencyKey("capture-comparison"),
          expectedVersion: 0
        })
      });
      await refresh();
      return data;
    },
    [refresh, role]
  );

  const reviewAnswer = useCallback(
    async (answerId: string, expectedVersion: number, selectedGapIds: string[], destinations: ObservationGapDestination[], note: string) =>
      reviewGaps(answerId, { selectedGapIds, destinations, note, decision: "confirmed", expectedVersion }),
    [reviewGaps]
  );

  return { workspace, loading, error, refresh, createTasks, analyzeGaps, reviewAnswer, compareTasks };
}
