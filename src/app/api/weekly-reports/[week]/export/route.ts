import { exportWeeklyReportMarkdown } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { week: string } }) {
  return NextResponse.json(exportWeeklyReportMarkdown(params.week));
}
