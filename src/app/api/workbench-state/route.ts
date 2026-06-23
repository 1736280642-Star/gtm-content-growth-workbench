import { getDashboardSummary, readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const state = readWorkbenchState();

  return NextResponse.json({
    state,
    summary: getDashboardSummary()
  });
}
