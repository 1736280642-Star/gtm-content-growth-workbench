import { readRequestPayload } from "@/lib/api-utils";
import { createDistributionTargetsForPublishRecord } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const payload = await readRequestPayload(request);
  const result = createDistributionTargetsForPublishRecord(routeParams.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
