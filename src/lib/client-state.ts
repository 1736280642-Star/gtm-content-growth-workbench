"use client";

import { useCallback, useEffect, useState } from "react";
import {
  blogArticles,
  botVisits,
  drafts,
  knowledgeBases,
  publishRecords,
  tasks,
  monthlyPlan
} from "./demo-data";
import { getDashboardSummary as getSeedDashboardSummary } from "./metrics";
import type { WorkbenchState } from "./workbench-store";

export interface ClientWorkbenchSnapshot {
  state: WorkbenchState;
  summary: ReturnType<typeof getSeedDashboardSummary>;
}

const initialState: WorkbenchState = {
  runtime: {
    storage: "local_json",
    statePath: "data/workbench-state.json",
    initializedAt: ""
  },
  monthlyPlan,
  workspaceSetting: {
    id: "workspace-setting-default",
    defaultPublishDays: 5,
    defaultDailyCount: 3,
    enabledChannels: ["wechat", "csdn", "juejin", "zhihu_toutiao_general"],
    enabledProducts: ["joto_brand", "weike_guardrails"],
    finalReviewMode: "default_final",
    logMode: "demo_csv"
  },
  tasks,
  drafts,
  publishRecords,
  blogArticles,
  botVisits,
  knowledgeBases,
  pipelineRuns: [],
  auditLog: []
};

const initialSnapshot: ClientWorkbenchSnapshot = {
  state: initialState,
  summary: getSeedDashboardSummary()
};

export function useWorkbenchSnapshot() {
  const [snapshot, setSnapshot] = useState<ClientWorkbenchSnapshot>(initialSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [usingFallback, setUsingFallback] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/workbench-state", { cache: "no-store" });

      if (!response.ok) {
        setError(`运行态数据同步失败：${response.status} ${response.statusText || "接口异常"}`);
        return undefined;
      }

      const nextSnapshot = (await response.json()) as ClientWorkbenchSnapshot;
      setSnapshot(nextSnapshot);
      setError(undefined);
      setUsingFallback(false);
      return nextSnapshot;
    } catch (fetchError) {
      setError(fetchError instanceof Error ? `运行态数据同步失败：${fetchError.message}` : "运行态数据同步失败");
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...snapshot,
    loading,
    error,
    usingFallback,
    refresh
  };
}
