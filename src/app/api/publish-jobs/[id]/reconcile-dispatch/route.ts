import { dispatchPublishJobReconciliation } from "@/lib/publish-job-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: { id: string } }) {
  const result = await dispatchPublishJobReconciliation(context.params.id);
  return Response.json(result, { status: result.ok ? 202 : result.status === "pending_input" ? 409 : 400 });
}
