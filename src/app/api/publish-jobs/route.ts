import { createPublishJob, listPublishJobs } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({
    jobs: listPublishJobs({
      platform: url.searchParams.get("platform") || undefined,
      status: url.searchParams.get("status") || undefined
    })
  });
}

export async function POST(request: Request) {
  const result = await createPublishJob((await request.json().catch(() => ({}))) as Record<string, unknown>);
  return Response.json(result, { status: result.ok ? 201 : 400 });
}
