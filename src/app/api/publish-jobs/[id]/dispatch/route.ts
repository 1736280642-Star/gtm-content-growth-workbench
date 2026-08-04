import { dispatchPublishJob } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await dispatchPublishJob(id);
  return Response.json(result, { status: result.ok ? 202 : result.status === "pending_input" ? 409 : 400 });
}
