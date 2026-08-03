import { getPublishJob } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const job = getPublishJob(context.params.id);
  return job ? Response.json(job) : Response.json({ message: "Publish job not found." }, { status: 404 });
}
