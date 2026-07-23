import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { reviewSiteAuditFinding } from "@/lib/v5/site-audit-service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    return observationOk(
      await reviewSiteAuditFinding(
        params.id,
        (await readObservationPayload(request)) as unknown as V5MutationContext & { decision: "resolved" | "ignored"; note: string }
      )
    );
  } catch (error) {
    return observationError(error, "SITE_AUDIT_FINDING_REVIEW_FAILED", "官网审计问题复审失败，请填写处理说明。");
  }
}
