import { readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const state = readWorkbenchState();
  const confidence = state.botVisits.some((item) => item.dataConfidence === "real")
    ? "real"
    : state.botVisits.some((item) => item.dataConfidence === "imported")
      ? "imported"
      : "demo";

  return NextResponse.json({
    dataConfidence: confidence,
    summaries: state.botVisits,
    message: "AI Bot 指标来自本地持久化状态；可通过日志导入接口替换为 CSV、Nginx 或 CDN 日志。"
  });
}
