import { reconcilePublishJob } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: { id: string } }) {
  const result = await reconcilePublishJob(context.params.id);
  return Response.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 409 : 400 });
}
