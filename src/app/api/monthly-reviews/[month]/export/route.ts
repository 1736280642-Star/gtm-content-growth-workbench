import { exportMonthlyReviewMarkdown } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { month: string } }) {
  return NextResponse.json(exportMonthlyReviewMarkdown(params.month));
}
