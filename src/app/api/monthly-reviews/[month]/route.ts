import { getMonthlyReview } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { month: string } }) {
  return NextResponse.json(getMonthlyReview(params.month));
}
