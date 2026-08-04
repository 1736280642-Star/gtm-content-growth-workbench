import type { CreateSiteRemediationRequest } from "@/lib/v5/site-audit-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createSiteRemediation } from "@/lib/v5/site-audit-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    return observationOk(await createSiteRemediation(routeParams.id, (await readObservationPayload(request)) as unknown as CreateSiteRemediationRequest), 201);
  } catch (error) {
    return observationError(error, "SITE_REMEDIATION_CREATE_FAILED", "官网整改任务创建失败，请检查负责人和截止日期。");
  }
}
