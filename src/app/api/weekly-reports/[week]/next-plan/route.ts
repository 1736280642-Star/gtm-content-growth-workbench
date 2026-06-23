import { readRequestPayload } from "@/lib/api-utils";
import { createNextWeeklyPlanFromReport } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { week: string } }) {
  const payload = await readRequestPayload(request);
  return NextResponse.json(createNextWeeklyPlanFromReport(params.week, payload));
}
