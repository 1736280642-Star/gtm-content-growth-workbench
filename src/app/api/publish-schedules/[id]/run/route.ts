import { runPublishJob } from "@/lib/publish-job-service";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = await runPublishJob(routeParams.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
