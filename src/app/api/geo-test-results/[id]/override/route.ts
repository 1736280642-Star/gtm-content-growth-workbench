import { readRequestPayload } from "@/lib/api-utils";
import { overrideGeoResult } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = overrideGeoResult(params.id, payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
