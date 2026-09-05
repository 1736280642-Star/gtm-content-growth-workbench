"use client";
import { useCallback, useEffect, useState } from "react";
import { createDemoState } from "./fixtures/core";
import { legacySnapshot } from "./legacy-snapshot";
const initial = legacySnapshot(createDemoState());
export function useWorkbenchSnapshot() {
    const [snapshot, setSnapshot] = useState(initial), [loading, setLoading] = useState(true), [error, setError] = useState<string>();
    const refresh = useCallback(async () => { setLoading(true); try {
        const response = await fetch("/api/workbench-state", { cache: "no-store" });
        if (!response.ok)
            throw new Error("演示状态读取失败");
        const data = await response.json();
        setSnapshot(data);
        setError(undefined);
        return data;
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
    }
    finally {
        setLoading(false);
    } }, []);
    useEffect(() => { void refresh(); }, [refresh]);
    return { ...snapshot, loading, error, usingFallback: false, refresh };
}
