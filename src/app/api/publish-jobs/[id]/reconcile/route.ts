import { reconcilePublishJob } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await reconcilePublishJob(id);
  return Response.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 409 : 400 });
}
