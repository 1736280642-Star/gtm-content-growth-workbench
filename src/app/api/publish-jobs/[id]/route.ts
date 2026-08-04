import { getPublishJob } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getPublishJob(id);
  return job ? Response.json(job) : Response.json({ message: "Publish job not found." }, { status: 404 });
}
