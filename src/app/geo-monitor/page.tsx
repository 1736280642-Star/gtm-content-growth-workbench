"use client";

import { Segmented } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import PublishingPage from "@/app/publishing/page";
import PublishLedgerPage from "@/app/publish/page";
import BlogMonitorPage from "@/app/blog-monitor/page";
import MonthlyReviewPage from "@/app/monthly-review/page";
import AiFrontTestPage from "@/app/ai-front-test/page";

type MonitorTab = "publishing" | "ledger" | "site" | "review" | "ai";
const monitorOptions = [
  { label: "发布状态", value: "publishing" },
  { label: "数据回传", value: "ledger" },
  { label: "官网监控", value: "site" },
  { label: "数据复盘", value: "review" },
  { label: "AI 前台测试", value: "ai" }
];

function GeoMonitorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab = monitorOptions.some((item) => item.value === requestedTab) ? requestedTab as MonitorTab : "publishing";
  return (
    <>
      <div className="unified-workspace-nav is-monitor">
        <Segmented block value={tab} options={monitorOptions} onChange={(value) => router.push(`/geo-monitor?tab=${value}`)} />
      </div>
      {tab === "publishing" ? <PublishingPage /> : null}
      {tab === "ledger" ? <PublishLedgerPage /> : null}
      {tab === "site" ? <BlogMonitorPage /> : null}
      {tab === "review" ? <MonthlyReviewPage /> : null}
      {tab === "ai" ? <AiFrontTestPage /> : null}
    </>
  );
}

export default function GeoMonitorPage() {
  return <Suspense fallback={null}><GeoMonitorWorkspace /></Suspense>;
}
