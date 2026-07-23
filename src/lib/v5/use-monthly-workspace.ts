"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MonthlyPlanConfig,
  V5ApiEnvelope,
  V5MonthlyPlanRecord,
  V5MonthlyWorkspace
} from "./monthly-workspace-contracts";
import type { QuestionTypeMatchRun } from "./article-type-contracts";

const workspaceCache = new Map<string, V5MonthlyWorkspace>();
const inFlightRequests = new Map<string, Promise<V5MonthlyWorkspace>>();

function cacheKey(month?: string) {
  return month || "latest";
}

function createRequestError(envelope: Extract<V5ApiEnvelope<never>, { ok: false }>) {
  const details = envelope.error.details?.length ? ` ${envelope.error.details.join("；")}` : "";
  return new Error(`${envelope.error.message}${details}`);
}

async function fetchWorkspace(month?: string, force = false) {
  const key = cacheKey(month);
  if (!force && workspaceCache.has(key)) return workspaceCache.get(key)!;
  if (inFlightRequests.has(key)) return inFlightRequests.get(key)!;

  const request = fetch(`/api/v5/monthly-workspace${month ? `?month=${encodeURIComponent(month)}` : ""}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  })
    .then(async (response) => {
      const body = (await response.json()) as V5ApiEnvelope<V5MonthlyWorkspace>;
      if (!response.ok || !body.ok) {
        if (!body.ok) throw createRequestError(body);
        throw new Error(`V5 月度工作区读取失败（HTTP ${response.status}）。`);
      }
      workspaceCache.set(key, body.data);
      workspaceCache.set(cacheKey(body.data.month), body.data);
      const latest = workspaceCache.get("latest");
      if (!latest || body.data.month >= latest.month) workspaceCache.set("latest", body.data);
      return body.data;
    })
    .finally(() => inFlightRequests.delete(key));

  inFlightRequests.set(key, request);
  return request;
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `monthly-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useMonthlyWorkspace(requestedMonth?: string) {
  const key = cacheKey(requestedMonth);
  const [workspace, setWorkspace] = useState<V5MonthlyWorkspace | undefined>(() => workspaceCache.get(key));
  const [loading, setLoading] = useState(!workspaceCache.has(key));
  const [error, setError] = useState<string>();

  const refresh = useCallback(
    async (monthOverride?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const next = await fetchWorkspace(monthOverride || requestedMonth, true);
        setWorkspace(next);
        return next;
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        setError(message);
        throw requestError;
      } finally {
        setLoading(false);
      }
    },
    [requestedMonth]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWorkspace(requestedMonth)
      .then((next) => {
        if (!active) return;
        setWorkspace(next);
        setError(undefined);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestedMonth]);

  const saveMonthlyPlan = useCallback(
    async (config: MonthlyPlanConfig): Promise<V5MonthlyPlanRecord> => {
      const expectedVersion = workspace?.plan?.config.month === config.month ? workspace.plan.version : 0;
      const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(config.month)}`, {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-idempotency-key": createIdempotencyKey()
        },
        body: JSON.stringify({ config, expectedVersion })
      });
      const body = (await response.json()) as V5ApiEnvelope<V5MonthlyPlanRecord>;
      if (!response.ok || !body.ok) {
        if (!body.ok) throw createRequestError(body);
        throw new Error(`月度计划保存失败（HTTP ${response.status}）。`);
      }

      await refresh(config.month);
      return body.data;
    },
    [refresh, workspace]
  );

  const mutateStrategy = useCallback(
    async (action: "strategy-preview" | "strategy-approval") => {
      if (!workspace?.plan) throw new Error("请先保存月度计划。");
      const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(workspace.month)}/${action}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "x-idempotency-key": createIdempotencyKey() },
        body: JSON.stringify({
          expectedVersion: workspace.plan.version,
          auditReason: action === "strategy-preview" ? "运行内容策略包生产预检" : "批准本月内容策略包"
        })
      });
      const body = (await response.json()) as V5ApiEnvelope<V5MonthlyPlanRecord>;
      if (!response.ok || !body.ok) {
        if (!body.ok) throw createRequestError(body);
        throw new Error(`内容策略操作失败（HTTP ${response.status}）。`);
      }
      await refresh(workspace.month);
      return body.data;
    },
    [refresh, workspace]
  );

  const runTypeMatch = useCallback(async (month: string, questionVersionIds: string[]) => {
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(month)}/type-match`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-idempotency-key": createIdempotencyKey() },
      body: JSON.stringify({
        expectedVersion: workspace?.typeMatchRun?.month === month ? workspace.typeMatchRun.revision : 0,
        questionVersionIds,
        auditReason: "为月度目标问题运行内容类型语义匹配"
      })
    });
    const body = (await response.json()) as V5ApiEnvelope<QuestionTypeMatchRun>;
    if (!response.ok || !body.ok) {
      if (!body.ok) throw createRequestError(body);
      throw new Error(`内容类型匹配失败（HTTP ${response.status}）。`);
    }
    await refresh(month);
    return body.data;
  }, [refresh, workspace?.typeMatchRun?.month, workspace?.typeMatchRun?.revision]);

  const confirmTypeMatch = useCallback(async (
    month: string,
    selections: Array<{ questionVersionId: string; articleTypeProfileVersionId: string; selectionStatus: "accepted" | "rejected" | "manual_added" }>
  ) => {
    if (!workspace?.typeMatchRun) throw new Error("请先运行内容类型匹配。" );
    const response = await fetch(`/api/v5/monthly-plans/${encodeURIComponent(month)}/type-match/confirm`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-idempotency-key": createIdempotencyKey() },
      body: JSON.stringify({
        expectedVersion: workspace.typeMatchRun.revision,
        matchRunId: workspace.typeMatchRun.matchRunId,
        selections,
        auditReason: "人工确认月度内容类型组合"
      })
    });
    const body = (await response.json()) as V5ApiEnvelope<QuestionTypeMatchRun>;
    if (!response.ok || !body.ok) {
      if (!body.ok) throw createRequestError(body);
      throw new Error(`内容类型匹配确认失败（HTTP ${response.status}）。`);
    }
    await refresh(month);
    return body.data;
  }, [refresh, workspace?.typeMatchRun]);

  return {
    workspace,
    loading,
    error,
    refresh,
    saveMonthlyPlan,
    runTypeMatch,
    confirmTypeMatch,
    preflightStrategy: () => mutateStrategy("strategy-preview"),
    approveStrategy: () => mutateStrategy("strategy-approval")
  };
}
