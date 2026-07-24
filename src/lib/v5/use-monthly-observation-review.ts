"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@/lib/types";
import type { MonthlyReview, NextMonthProposal } from "./monthly-review-contracts";
import type { V5ObservationApiEnvelope } from "./observation-contracts";

function key(scope: string) {
  return `${scope}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now()}`;
}

export function useMonthlyObservationReview(month: string, role: WorkspaceRole) {
  const [review, setReview] = useState<MonthlyReview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const actorRole = role === "content_growth" || role === "workbench_operator" || role === "knowledge_manager" || role === "developer_admin" ? role : "workbench_operator";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v5/monthly-reviews/${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = (await response.json()) as V5ObservationApiEnvelope<MonthlyReview>;
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
    const response = await fetch(`/api/v5/monthly-reviews/${encodeURIComponent(month)}/proposals`, {
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
    });
    const body = (await response.json()) as V5ObservationApiEnvelope<NextMonthProposal>;
    if (!response.ok || !body.ok) throw new Error(body.ok ? `创建失败（HTTP ${response.status}）` : body.error.message);
    await refresh();
    return body.data;
  }, [actorRole, month, refresh]);

  return { review, loading, error, refresh, createProposal };
}
