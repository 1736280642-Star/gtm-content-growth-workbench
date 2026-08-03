import { listPublishCandidates } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ candidates: listPublishCandidates() });
}
