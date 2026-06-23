import { readRequestPayload } from "@/lib/api-utils";
import { createPublishRecord } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = createPublishRecord(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
