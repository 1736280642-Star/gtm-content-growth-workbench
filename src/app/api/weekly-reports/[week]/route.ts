import { getWeeklyReportForRole, readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { week: string } }) {
  const state = readWorkbenchState();

  return NextResponse.json(getWeeklyReportForRole(params.week, state.workspaceSetting.currentRole));
}
