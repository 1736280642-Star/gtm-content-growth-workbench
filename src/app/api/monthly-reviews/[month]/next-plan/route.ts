import { readRequestPayload } from "@/lib/api-utils";
import { createNextMonthlyPlanFromReview } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { month: string } }) {
  const payload = await readRequestPayload(request);
  return NextResponse.json(createNextMonthlyPlanFromReview(params.month, payload));
}
