import { readRequestPayload } from "@/lib/api-utils";
import { runDuePublishJobs } from "@/lib/publish-job-service";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = await runDuePublishJobs(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
