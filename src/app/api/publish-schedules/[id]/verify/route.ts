import { reconcilePublishJob } from "@/lib/publish-job-service";
import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = await reconcilePublishJob(routeParams.id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 409 : 400 });
}
