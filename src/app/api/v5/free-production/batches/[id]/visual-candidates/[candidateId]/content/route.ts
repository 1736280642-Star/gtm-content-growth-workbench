import { freeProductionErrorResponse } from "@/lib/v5/free-production-api";
import { readWechatVisualCandidateContent } from "@/lib/v5/wechat-visual-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; candidateId: string }> }) {
  const routeParams = await params;
  try {
    const candidate = await readWechatVisualCandidateContent(routeParams.id, routeParams.candidateId);
    return new Response(new Uint8Array(candidate.data), {
      headers: {
        "content-type": candidate.mimeType,
        "content-length": String(candidate.data.length),
        "cache-control": "private, max-age=3600",
        etag: `"${candidate.contentHash}"`,
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return freeProductionErrorResponse(error);
  }
}
