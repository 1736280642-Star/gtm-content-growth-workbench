"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@/lib/types";
import type { MonthlyReview, NextMonthProposal } from "./monthly-review-contracts";
import type { V5ObservationApiEnvelope } from "./observation-contracts";

const TRANSIENT_NEXT_RESPONSE = "missing required error components";

function key(scope: string) {
  return `${scope}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now()}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readObservationResponse<T>(response: Response): Promise<V5ObservationApiEnvelope<T>> {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as V5ObservationApiEnvelope<T>;
    if (!body || typeof body !== "object" || typeof body.ok !== "boolean") throw new Error("invalid envelope");
    return body;
  } catch {
    if (text.toLowerCase().includes(TRANSIENT_NEXT_RESPONSE)) {
      throw new Error(TRANSIENT_NEXT_RESPONSE);
    }
    throw new Error(`接口返回了无法识别的响应（HTTP ${response.status}）。请重启当前端口的开发服务后重试。`);
  }
}

async function requestObservation<T>(input: RequestInfo | URL, init?: RequestInit) {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      return { response, body: await readObservationResponse<T>(response) };
    } catch (error) {
      const recoverable =
        error instanceof TypeError ||
        (error instanceof Error && error.message === TRANSIENT_NEXT_RESPONSE);
      if (!recoverable || attempt === attempts) {
        if (recoverable) throw new Error("开发服务刚刚完成更新，但月度复盘接口尚未恢复。请稍后点击重试。");
        throw error;
      }
      await wait(attempt * 500);
    }
  }

  throw new Error("月度复盘请求未完成，请稍后重试。");
}

export function useMonthlyObservationReview(month: string, role: WorkspaceRole) {
  const [review, setReview] = useState<MonthlyReview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const actorRole = role === "content_growth" || role === "workbench_operator" || role === "knowledge_manager" || role === "developer_admin" ? role : "workbench_operator";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { response, body } = await requestObservation<MonthlyReview>(
        `/api/v5/monthly-reviews/${encodeURIComponent(month)}`,
        { cache: "no-store" }
      );
      if (!response.ok || !body.ok) throw new Error(body.ok ? `读取失败（HTTP ${response.status}）` : body.error.message);
      setReview(body.data);
      setError(undefined);
      return body.data;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const createProposal = useCallback(async (questionReviewId: string, recommendation: string, rationale: string) => {
    const { response, body } = await requestObservation<NextMonthProposal>(
      `/api/v5/monthly-reviews/${encodeURIComponent(month)}/proposals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionReviewId,
          recommendation,
          rationale,
          actor: { actorId: `local-${actorRole}`, actorRole, actorType: "human" },
          reason: "人工确认问题级月度复盘的下月建议",
          idempotencyKey: key("next-month-proposal"),
          expectedVersion: 0
        })
      }
    );
    if (!response.ok || !body.ok) throw new Error(body.ok ? `创建失败（HTTP ${response.status}）` : body.error.message);
    await refresh();
    return body.data;
  }, [actorRole, month, refresh]);

  return { review, loading, error, refresh, createProposal };
}
